/**
 * POST /api/suggestFacts : 認証必須。
 *
 * ユーザー要望「factsもなるべく自動化したい」に対応。公式サイトURLを取得し、
 * 実際にページ本文に書かれている事実のみを抽出したfacts候補(下書き)を返す。
 * あくまで「提案」であり、ユーザーが確認・編集して保存するまで確定させない
 * (このエンドポイント自体は`data/affiliate-products.json`を一切更新しない)。
 *
 * 【SSRF対策】この取得先URL(officialUrl)は外部から辿ってきた値(候補ヒントの
 * officialUrlGuessや管理者が任意に入力したURL)であり、信頼できない。
 * - スキームはhttp/https以外拒否(isHttpUrl)。
 * - 明らかにローカル/内部向けと分かるホスト名を拒否(isSafeExternalUrl)。
 * - レスポンスボディサイズに上限を設ける(readTextWithLimit)。
 * - タイムアウトを設ける(AbortController)。
 * 詳細はdocs/spec/x-ai-news-autopost-spec.mdの本スプリント仕様を参照。
 */
import type { Env } from "../_lib/types";
import { getSessionFromRequest } from "../_lib/session";
import { isHttpUrl } from "../_lib/validate";
import { isSafeExternalUrl } from "../_lib/ssrf";
import { extractTextFromHtml } from "../_lib/htmlText";
import { readTextWithLimit } from "../_lib/fetchLimited";
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

  const officialUrl = (body as Record<string, unknown> | null)?.officialUrl;
  if (typeof officialUrl !== "string" || !isHttpUrl(officialUrl)) {
    return jsonResponse({ error: "officialUrlはhttp:またはhttps:のURLである必要があります" }, 400);
  }
  if (!isSafeExternalUrl(officialUrl)) {
    return jsonResponse({ error: "指定されたURLは取得できません(内部向けホストは許可されていません)" }, 400);
  }

  if (!env.ANTHROPIC_API_KEY) {
    return jsonResponse(
      { error: "ANTHROPIC_API_KEYが未設定のため事実情報の提案機能は利用できません" },
      503
    );
  }

  // 1) 公式サイトの取得(タイムアウト・サイズ上限つき)
  let pageText: string;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(officialUrl, { signal: controller.signal, redirect: "follow" });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      return jsonResponse({ error: `公式サイトの取得に失敗しました(status: ${res.status})` }, 502);
    }
    // SSRF対策(追加検証): officialUrl自体は`isSafeExternalUrl`を通過していても、
    // `redirect: "follow"`はリダイレクト先のホストを一切検証しないため、外部から辿ってきた
    // officialUrl(候補ヒントのofficialUrlGuess等)が302等で内部/ブロック対象ホストへ誘導する
    // レスポンスを返すだけでSSRFガードが無意味化する。`res.url`(最終的に到達したURL)を
    // 必ず再検証し、安全でない場合はボディを一切読まずに拒否する(読んでから捨てても
    // 既に内部ネットワークへの到達自体は発生してしまっているため、最低限ボディの内容が
    // AIプロンプト・レスポンスに混入する経路だけは確実に断つ)。
    if (!res.url || !isSafeExternalUrl(res.url)) {
      try {
        await res.body?.cancel();
      } catch {
        // ストリームキャンセルの失敗は無視してよい(既に閉じている等)
      }
      return jsonResponse(
        { error: "指定されたURLはリダイレクト先が内部向けホストのため取得できません" },
        400
      );
    }
    const { text: html } = await readTextWithLimit(res, MAX_RESPONSE_BYTES);
    pageText = truncatePageText(extractTextFromHtml(html));
  } catch (err) {
    return jsonResponse({ error: `公式サイトの取得に失敗しました: ${errorMessage(err)}` }, 502);
  }

  if (pageText.trim().length === 0) {
    // 本文らしきテキストが取得できなかった場合は、安全側に倒して空配列を返す(エラーにはしない)
    return jsonResponse({ facts: [] });
  }

  // 2) Claude(Anthropic API)へ事実抽出を依頼
  const prompt = buildFactsSuggestionPrompt(pageText);
  let aiJson: unknown;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(ANTHROPIC_API_URL, {
        method: "POST",
        signal: controller.signal,
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
      });
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      return jsonResponse({ error: `AI呼び出しに失敗しました(status: ${res.status})` }, 502);
    }
    aiJson = await res.json();
  } catch (err) {
    return jsonResponse({ error: `AI呼び出しに失敗しました: ${errorMessage(err)}` }, 502);
  }

  // レスポンスのJSON配列パースに失敗した場合も例外を投げず空配列を返す(安全側に倒す)
  const rawText = extractTextFromAnthropicMessage(aiJson);
  const facts = parseFactsSuggestionResponse(rawText);

  return jsonResponse({ facts });
};
