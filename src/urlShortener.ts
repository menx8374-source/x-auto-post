/**
 * アフィリエイトリンクの短縮(TinyURL経由)。
 *
 * 実際にX APIへの投稿テストで、`px.a8.net`(A8.netのアフィリエイトトラッキング/リダイレクトドメイン)を
 * 含むツイートが、Xから「The Tweet contains an invalid URL」として一律拒否されることを確認した
 * (URLエンコードの問題ではなく、ドメイン自体が拒否されている)。この対策として、アフィリエイトリンクは
 * 投稿直前にTinyURL(アカウント登録・APIキー不要の無料URL短縮サービス)を経由させ、
 * 短縮後のURL(`https://tinyurl.com/...`)をツイートに含める。
 */
import { fetchWithTimeout } from "./http.js";
import { log } from "./logger.js";
import { isHttpUrl } from "./ogpImage.js";

const TINYURL_API_BASE = "https://tinyurl.com/api-create.php";
const TINYURL_TIMEOUT_MS = 8000;
const TINYURL_RESULT_PREFIX = "https://tinyurl.com/";

/** テスト用に差し替え可能なfetch関数の型(既定は`src/http.ts`のタイムアウト付きfetch) */
export type ShortenFetchLike = typeof fetchWithTimeout;

/**
 * TinyURLの無料API(`https://tinyurl.com/api-create.php?url=...`、GET・認証不要)を使い、
 * 長いURLを`https://tinyurl.com/...`形式の短縮URLに変換する。
 *
 * 通信失敗・タイムアウト・不正なレスポンス(TinyURL側がエラーメッセージをプレーンテキストで
 * 返す場合がある)のいずれでも、例外を投げず`null`を返す(既存のOGP画像取得等と同じ
 * 「失敗を許容し処理継続」の設計方針)。呼び出し側が`null`をどう扱うか(投稿を中止する等)を決める。
 */
export async function shortenUrl(
  longUrl: string,
  fetchImpl: ShortenFetchLike = fetchWithTimeout
): Promise<string | null> {
  if (!isHttpUrl(longUrl)) {
    log.warn("refusing to shorten url with disallowed scheme", { longUrl });
    return null;
  }

  const apiUrl = `${TINYURL_API_BASE}?url=${encodeURIComponent(longUrl)}`;

  let response: Response;
  try {
    response = await fetchImpl(apiUrl, {}, TINYURL_TIMEOUT_MS);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("tinyurl shorten request failed; continuing without shortened url", { longUrl, message });
    return null;
  }

  let body: string;
  try {
    body = (await response.text()).trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("failed to read tinyurl response body; continuing without shortened url", { longUrl, message });
    return null;
  }

  if (!body.startsWith(TINYURL_RESULT_PREFIX)) {
    // TinyURLはエラー時にHTTP 200のまま「Error」等のプレーンテキストを返すことがあるため、
    // ステータスコードだけでなく本文の形式も検証する。
    log.warn("tinyurl returned an unexpected response; continuing without shortened url", { longUrl, body });
    return null;
  }

  return body;
}
