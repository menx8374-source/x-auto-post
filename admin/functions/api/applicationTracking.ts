/**
 * GET  /api/applicationTracking : 認証必須。data/affiliate-application-tracking.json の内容を
 *                                  GitHub Contents API経由で取得して返す。
 * POST /api/applicationTracking : 認証必須。
 *   - `{ productName, officialUrl, a8NetHint, status }` (idを含まない): 新規トラッキングエントリを
 *     作成する。idはサーバー側で`crypto.randomUUID()`により発行する。
 *   - `{ id, status }`: 既存エントリのステータス更新のみ("applying"→"approved"の一方向遷移を想定するが、
 *     厳密な状態遷移バリデーションは行わない)。
 *
 * 【重要】提携申請が実際に受理されたかどうかはユーザー本人がA8.netにログインしないと分からないため、
 * statusの更新はここでは検知せず、ユーザーがadmin管理ページ上で手動で切り替える(A8.netへの自動ログイン・
 * 自動検索・自動提携申請は一切行わない)。
 *
 * `admin/functions/api/products.ts`と同じsha楽観ロックパターンでGitHub Contents API経由でコミットする。
 */
import type { Env, ApplicationTrackingEntry } from "../_lib/types";
import { getSessionFromRequest } from "../_lib/session";
import { validateApplicationTrackingInput } from "../_lib/validate";
import { getFileContent, putFileContent, GitHubApiError } from "../_lib/github";

const TRACKING_PATH = "data/affiliate-application-tracking.json";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseTrackingEntries(file: { content: string } | null): ApplicationTrackingEntry[] {
  if (!file) return [];
  const parsed: unknown = JSON.parse(file.content);
  if (!Array.isArray(parsed)) {
    throw new Error(`${TRACKING_PATH} はJSON配列である必要があります`);
  }
  return parsed as ApplicationTrackingEntry[];
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSessionFromRequest(request, env);
  if (!session) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const file = await getFileContent(env, TRACKING_PATH);
    return jsonResponse({ entries: parseTrackingEntries(file) });
  } catch (err) {
    return jsonResponse({ error: `提携申請の進捗データの取得に失敗しました: ${errorMessage(err)}` }, 502);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSessionFromRequest(request, env);
  if (!session) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "リクエストボディがJSONとして解釈できません" }, 400);
  }

  const validation = validateApplicationTrackingInput(body);
  if (!validation.valid) {
    return jsonResponse({ error: "バリデーションエラー", details: validation.errors }, 400);
  }
  const input = body as Record<string, unknown>;

  let file;
  let currentEntries: ApplicationTrackingEntry[];
  try {
    file = await getFileContent(env, TRACKING_PATH);
    currentEntries = parseTrackingEntries(file);
  } catch (err) {
    return jsonResponse({ error: `提携申請の進捗データの取得に失敗しました: ${errorMessage(err)}` }, 502);
  }

  let updatedEntries: ApplicationTrackingEntry[];
  let resultEntry: ApplicationTrackingEntry;

  if (validation.mode === "update") {
    const index = currentEntries.findIndex((entry) => entry.id === input.id);
    if (index === -1) {
      return jsonResponse({ error: "指定されたidの提携申請エントリが見つかりません" }, 404);
    }
    resultEntry = {
      ...currentEntries[index],
      status: input.status as ApplicationTrackingEntry["status"],
      updatedAt: new Date().toISOString(),
    };
    updatedEntries = [...currentEntries];
    updatedEntries[index] = resultEntry;
  } else {
    const now = new Date().toISOString();
    // officialUrlは任意項目("known_brand"ヒントはofficialUrlGuessが無くても成立するため)。
    // 未指定/null/空文字列はnullに正規化して統一する(空文字列のまま保存しない)。
    const officialUrl =
      typeof input.officialUrl === "string" && input.officialUrl.length > 0 ? input.officialUrl : null;
    resultEntry = {
      id: crypto.randomUUID(),
      productName: input.productName as string,
      officialUrl,
      a8NetHint: input.a8NetHint as ApplicationTrackingEntry["a8NetHint"],
      status: input.status as ApplicationTrackingEntry["status"],
      createdAt: now,
      updatedAt: now,
    };
    updatedEntries = [...currentEntries, resultEntry];
  }

  try {
    // 直前に取得した最新のsha(他プロセスがこの間に更新していた場合409で検知)を必ず渡す。
    await putFileContent(
      env,
      TRACKING_PATH,
      `${JSON.stringify(updatedEntries, null, 2)}\n`,
      file?.sha,
      `chore(admin): ${validation.mode === "update" ? "update" : "add"} affiliate application tracking entry ${resultEntry.id}`
    );
  } catch (err) {
    if (err instanceof GitHubApiError && err.status === 409) {
      return jsonResponse(
        {
          error:
            "提携申請の進捗データの更新に失敗しました(他の変更と競合しました。ページを再読み込みしてもう一度お試しください)",
        },
        409
      );
    }
    return jsonResponse({ error: `提携申請の進捗データの更新に失敗しました: ${errorMessage(err)}` }, 502);
  }

  return jsonResponse({ ok: true, entry: resultEntry });
};
