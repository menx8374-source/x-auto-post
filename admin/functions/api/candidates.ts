/**
 * GET /api/candidates : 認証必須。data/affiliate-candidate-hints.json
 * (src/generateCandidateHints.tsが生成する読み取り専用の参考情報ファイル)を
 * GitHub Contents API経由で取得して返すだけ(このエンドポイント自体は生成を行わない)。
 */
import type { Env } from "../_lib/types";
import { getSessionFromRequest } from "../_lib/session";
import { getFileContent } from "../_lib/github";

const CANDIDATES_PATH = "data/affiliate-candidate-hints.json";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSessionFromRequest(request, env);
  if (!session) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const file = await getFileContent(env, CANDIDATES_PATH);
    if (!file) {
      return jsonResponse({ generatedAt: null, items: [] });
    }
    const parsed = JSON.parse(file.content);
    return jsonResponse(parsed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: `候補データの取得に失敗しました: ${message}` }, 502);
  }
};
