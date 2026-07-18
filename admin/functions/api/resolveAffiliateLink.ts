/**
 * POST /api/resolveAffiliateLink : 認証必須。
 *
 * ユーザー要望「A8.netの広告リンク作成画面で『リンク先URLをコピー』したリンク
 * (例: https://px.a8.net/svt/ejp?a8mat=...)だけ貼れば、商品ID・商品名・公式サイトURL・
 * 画像・事実情報が自動入力されるようにしてほしい」に対応する。
 *
 * アフィリエイトトラッキングリンクは本質的にリダイレクトを経由して最終的な商品ページ
 * (officialUrl)へ転送されるため、この処理では:
 *   1. リダイレクトを手動で1ホップずつ追跡する(`redirect: "manual"`)。
 *   2. 各ホップの遷移先URLを`isSafeExternalUrl`で「fetchする前に」検証する
 *      (`suggestFacts.ts`のようなfetch後の`res.url`事後検証より一段厳格な事前検証方式)。
 *   3. 検証に失敗した時点で即座に中断し、それ以上先には絶対に進まない。
 *   4. 最大ホップ数は5。超えたらエラーとして扱う。
 * 最終的に到達した(200 OKでこれ以上リダイレクトしない)ページのURLをofficialUrlとし、
 * そのHTMLからOGPメタデータ(商品名・画像)を抽出し、本文テキストをClaudeへ渡して
 * 事実情報(facts)候補を抽出する(`suggestFacts.ts`と同じAnthropic API呼び出しロジック・
 * プロンプトインジェクション対策を共有する)。
 *
 * 【重要】貼り付けられた元のaffiliateUrl自体は、A8.netの成果計測用トラッキングパラメータ
 * (`a8mat=`等)を含むため絶対に書き換えない。このエンドポイントはaffiliateUrlをレスポンスに
 * 一切含めない(呼び出し元フロントエンドがユーザー入力値をそのまま保持して使う)。
 */
import type { Env } from "../_lib/types";
import { getSessionFromRequest } from "../_lib/session";
import { isHttpUrl } from "../_lib/validate";
import { isSafeExternalUrl } from "../_lib/ssrf";
import { extractTextFromHtml } from "../_lib/htmlText";
import { readTextWithLimit } from "../_lib/fetchLimited";
import { extractOgpMetadata } from "../_lib/ogpMeta";
import {
  FACTS_SUGGESTION_MODEL,
  MAX_FACTS_OUTPUT_TOKENS,
  buildFactsSuggestionPrompt,
  parseFactsSuggestionResponse,
  extractTextFromAnthropicMessage,
  truncatePageText,
} from "../_lib/factsPrompt";

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_REDIRECT_HOPS = 5;
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type RedirectResolution =
  | { ok: true; response: Response; finalUrl: string }
  | { ok: false; status: number; error: string };

/**
 * リダイレクトを手動で1ホップずつ追跡する。各ホップのURLをfetchする「前」に
 * `isSafeExternalUrl`で検証し、失敗したら即座に中断する(SSRF対策の本体)。
 * 最終的に到達した非リダイレクトのレスポンスが200 OKでない場合もエラー扱いとする。
 */
async function followRedirectsSafely(startUrl: string): Promise<RedirectResolution> {
  let currentUrl = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
    if (!isSafeExternalUrl(currentUrl)) {
      return {
        ok: false,
        status: 400,
        error: "リンク先URLが安全でないため取得できません(内部向けホストは許可されていません)",
      };
    }

    let res: Response;
    try {
      res = await fetchWithTimeout(currentUrl, { redirect: "manual" }, FETCH_TIMEOUT_MS);
    } catch (err) {
      return { ok: false, status: 502, error: `リンク先の取得に失敗しました: ${errorMessage(err)}` };
    }

    const location = res.headers.get("location");
    const isRedirect = res.status >= 300 && res.status < 400 && !!location;

    if (!isRedirect) {
      if (!res.ok) {
        try {
          await res.body?.cancel();
        } catch {
          // ストリームキャンセルの失敗は無視してよい
        }
        return { ok: false, status: 502, error: `リンク先ページの取得に失敗しました(status: ${res.status})` };
      }
      return { ok: true, response: res, finalUrl: currentUrl };
    }

    // リダイレクトレスポンスのボディは使わないため読まずに破棄する
    try {
      await res.body?.cancel();
    } catch {
      // 無視してよい
    }

    if (hop === MAX_REDIRECT_HOPS) {
      return { ok: false, status: 502, error: "リダイレクトの回数が上限を超えました" };
    }

    let nextUrl: string;
    try {
      nextUrl = new URL(location as string, currentUrl).href;
    } catch {
      return { ok: false, status: 502, error: "リダイレクト先URLの解決に失敗しました" };
    }
    currentUrl = nextUrl;
  }

  return { ok: false, status: 502, error: "リダイレクトの回数が上限を超えました" };
}

/**
 * 本文テキストからClaudeへ事実抽出を依頼する。`suggestFacts.ts`と同じAnthropic API呼び出し
 * ロジック(プロンプト・レスポンス解析)を再利用する。ANTHROPIC_API_KEY未設定・AI呼び出し自体の
 * 失敗(ネットワークエラー・タイムアウト・非200応答)のいずれも例外を投げず空配列を返す
 * (このエンドポイントの主目的である officialUrl/name/imageUrl の自動入力は、facts抽出が
 * 失敗しても引き続き価値があるため、facts抽出の失敗だけでレスポンス全体を失敗にはしない)。
 */
async function suggestFactsGracefully(env: Env, pageText: string): Promise<string[]> {
  if (!env.ANTHROPIC_API_KEY) return [];
  if (pageText.trim().length === 0) return [];

  const prompt = buildFactsSuggestionPrompt(pageText);
  try {
    const res = await fetchWithTimeout(
      ANTHROPIC_API_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: FACTS_SUGGESTION_MODEL,
          max_tokens: MAX_FACTS_OUTPUT_TOKENS,
          system: prompt.system,
          messages: [{ role: "user", content: prompt.user }],
        }),
      },
      FETCH_TIMEOUT_MS
    );
    if (!res.ok) return [];
    const aiJson = await res.json();
    const rawText = extractTextFromAnthropicMessage(aiJson);
    return parseFactsSuggestionResponse(rawText);
  } catch {
    return [];
  }
}

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

  const affiliateUrl = (body as Record<string, unknown> | null)?.affiliateUrl;
  if (typeof affiliateUrl !== "string" || !isHttpUrl(affiliateUrl)) {
    return jsonResponse({ error: "affiliateUrlはhttp:またはhttps:のURLである必要があります" }, 400);
  }

  const resolution = await followRedirectsSafely(affiliateUrl);
  if (!resolution.ok) {
    return jsonResponse({ error: resolution.error }, resolution.status);
  }

  const officialUrl = resolution.finalUrl;

  let html: string;
  try {
    const { text } = await readTextWithLimit(resolution.response, MAX_RESPONSE_BYTES);
    html = text;
  } catch (err) {
    return jsonResponse({ error: `リンク先ページの取得に失敗しました: ${errorMessage(err)}` }, 502);
  }

  const ogp = extractOgpMetadata(html, officialUrl);
  const pageText = truncatePageText(extractTextFromHtml(html));
  const facts = await suggestFactsGracefully(env, pageText);

  return jsonResponse({
    officialUrl,
    name: ogp.title,
    imageUrl: ogp.image,
    facts,
  });
};
