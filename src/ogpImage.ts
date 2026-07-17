/**
 * 元記事のOGP画像(og:image)を取得し、スレッドの1件目(本文ツイート)に添付するために使う。
 *
 * 処理の流れ(いずれの段階が失敗しても例外を投げず、`null`を返して呼び出し側が
 * 「画像なしで投稿処理を継続」できるようにする。既存のソース通信失敗時と同じ設計方針):
 *   1. 記事URLのHTMLを取得する(SSRF対策付きの安全なfetchでホストを検証してから取得)。
 *   2. HTML中の`<meta property="og:image" ...>`等から画像URLを抽出する。
 *   3. 画像URLがhttp:/https:のみであることを検証する(それ以外のスキームは拒否)。
 *   4. 画像をダウンロードする(同じくSSRF対策付き)。Content-Typeが`image/*`であること・
 *      サイズが上限以内であることを検証する。
 *
 * SSRF対策(記事URL・og:image URLはいずれも第三者が投稿したコンテンツ由来のため、
 * 内部/クラウドメタデータ等のアドレスへ誘導されないよう以下を行う):
 *   - フェッチ前にホスト名をDNS解決し、解決先IPアドレスがプライベート/ループバック/
 *     リンクローカル/マルチキャスト等の内部向けアドレス範囲に該当する場合は拒否する。
 *   - リダイレクト(3xx)は`redirect: "manual"`で検知し、リダイレクト先URLに対しても
 *     同じホスト検証を行ってから追跡する(DNSリバインディング対策)。追跡ホップ数には上限を設ける。
 */
import { promises as dns } from "node:dns";
import net from "node:net";
import { log } from "./logger.js";

/** ダウンロードを許容する画像サイズの上限(バイト) */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

/** 記事HTML取得を許容するサイズの上限(バイト) */
export const MAX_ARTICLE_HTML_BYTES = 2 * 1024 * 1024; // 2MB

/** 記事HTML取得・画像ダウンロードのタイムアウト(ミリ秒、1ホップあたり) */
export const OGP_FETCH_TIMEOUT_MS = 8000;

/** リダイレクトを追跡する最大ホップ数(DNSリバインディング・無限リダイレクト対策) */
const MAX_REDIRECTS = 5;

export interface OgpImage {
  /** 実際にダウンロードした画像の絶対URL(記事HTML中の相対URL・リダイレクトは解決済み) */
  url: string;
  /** 画像データ本体 */
  buffer: Buffer;
  /** レスポンスのContent-Type(例: "image/png") */
  contentType: string;
}

/** テスト用に差し替え可能なfetch関数の型(既定はタイムアウト付きの素のfetch) */
export type FetchLike = (url: string, init?: RequestInit, timeoutMs?: number) => Promise<Response>;

/** テスト用に差し替え可能なDNS lookup関数の型(既定は`dns.promises.lookup`) */
export type LookupLike = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

/**
 * タイムアウト付きの素のfetch。`src/http.ts`の`fetchWithTimeout`と異なり、
 * `!response.ok`でも例外を投げない(リダイレクト(3xx)レスポンスを`redirect: "manual"`で
 * 受け取って検証するため、呼び出し側でステータスを判定する必要がある)。
 */
async function rawFetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = OGP_FETCH_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

const defaultFetch: FetchLike = rawFetchWithTimeout;
const defaultLookup: LookupLike = (hostname) => dns.lookup(hostname, { all: true });

/** タグ文字列から指定した属性の値を取り出す(属性の順序は問わない) */
function extractAttr(tag: string, attr: string): string | undefined {
  // 単語境界(直前が英数字・ハイフン・アンダースコアでない/直後が英数字・ハイフン・
  // アンダースコアでない)を要求し、`data-property`のような別属性名の末尾に誤マッチしないようにする。
  const re = new RegExp(`(?<![\\w-])${attr}(?![\\w-])\\s*=\\s*["']([^"']*)["']`, "i");
  return re.exec(tag)?.[1];
}

/**
 * HTML文字列からOGP画像のURL(未解決、相対URLの可能性あり)を抽出する。
 * `og:image:secure_url` > `og:image:url` > `og:image` の優先順で、最初に見つかったものを返す。
 * 属性の順序(property/content どちらが先か)・`property`/`name`どちらの属性名かは問わない。
 */
export function extractOgImageUrl(html: string): string | undefined {
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  const priority = ["og:image:secure_url", "og:image:url", "og:image"];
  const found: Record<string, string> = {};

  for (const tag of metaTags) {
    const property = (extractAttr(tag, "property") ?? extractAttr(tag, "name"))?.toLowerCase();
    if (!property || !priority.includes(property) || found[property]) {
      continue;
    }
    const content = extractAttr(tag, "content");
    if (content) {
      found[property] = content;
    }
  }

  for (const key of priority) {
    if (found[key]) {
      return found[key];
    }
  }
  return undefined;
}

/** URLのスキームがhttp:/https:のみであることを検証する(それ以外は拒否) */
export function isHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** 記事HTML中で見つかった(相対の可能性がある)画像URLを、記事URLを基準に絶対URLへ解決する */
export function resolveImageUrl(raw: string, baseUrl: string): string | undefined {
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return undefined;
  }
}

/** IPv4アドレスがプライベート/ループバック/リンクローカル/マルチキャスト等の内部向け範囲かを判定する */
function isPrivateIPv4(ip: string): boolean {
  const octets = ip.split(".").map((part) => Number(part));
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // 不正な形式は安全側に倒して拒否する
  }
  const [a, b] = octets;
  if (a === 0) return true; // "このネットワーク" (0.0.0.0/8)
  if (a === 10) return true; // プライベート(10.0.0.0/8)
  if (a === 100 && b >= 64 && b <= 127) return true; // キャリアグレードNAT(100.64.0.0/10)
  if (a === 127) return true; // ループバック(127.0.0.0/8)
  if (a === 169 && b === 254) return true; // リンクローカル(169.254.0.0/16、クラウドメタデータ含む)
  if (a === 172 && b >= 16 && b <= 31) return true; // プライベート(172.16.0.0/12)
  if (a === 192 && b === 168) return true; // プライベート(192.168.0.0/16)
  if (a >= 224) return true; // マルチキャスト(224-239)・予約(240-255)・ブロードキャスト
  return false;
}

/** IPv6アドレスがループバック/ユニークローカル/リンクローカル等の内部向け範囲かを判定する */
function isPrivateIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true; // ループバック・未指定アドレス

  // IPv4-mapped(::ffff:a.b.c.d)はIPv4として判定する(DNSリバインディングの迂回経路防止)
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (mapped) {
    return isPrivateIPv4(mapped[1]);
  }

  const firstGroup = parseInt(normalized.split(":")[0] || "0", 16);
  if (Number.isNaN(firstGroup)) return true; // 不正形式は安全側に倒して拒否する
  if (firstGroup >= 0xfc00 && firstGroup <= 0xfdff) return true; // fc00::/7 ユニークローカル
  if (firstGroup >= 0xfe80 && firstGroup <= 0xfebf) return true; // fe80::/10 リンクローカル
  return false;
}

/** IPアドレス(v4/v6いずれか)が内部/予約向けアドレス範囲かを判定する */
function isPrivateOrReservedIp(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIPv4(address);
  if (family === 6) return isPrivateIPv6(address);
  return true; // 不正なアドレス形式は安全側に倒して拒否する
}

/** ホスト名を解決し、解決先アドレスがすべて内部/予約向けでないことを検証する */
async function isHostSafe(hostname: string, lookupImpl: LookupLike): Promise<boolean> {
  let results: Array<{ address: string; family: number }>;
  try {
    results = await lookupImpl(hostname);
  } catch {
    return false; // 名前解決に失敗した場合は安全側に倒して拒否する
  }
  if (!results || results.length === 0) return false;
  return results.every((r) => !isPrivateOrReservedIp(r.address));
}

/** URLがスキーム・ホストともにフェッチしてよい相手かを検証する(SSRF対策の中核) */
async function isUrlSafeToFetch(rawUrl: string, lookupImpl: LookupLike): Promise<boolean> {
  if (!isHttpUrl(rawUrl)) return false;
  let hostname: string;
  try {
    // IPv6リテラルの場合`URL#hostname`は`[::1]`のように角括弧付きで返るため、
    // `dns.lookup`やIPアドレス判定にそのまま渡せるよう取り除く。
    hostname = new URL(rawUrl).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  return isHostSafe(hostname, lookupImpl);
}

/**
 * SSRF対策付きでURLをフェッチする。各ホップでホストの安全性を検証してから`fetchImpl`を呼び、
 * リダイレクト(3xx + Location)は手動で追跡してリダイレクト先も同様に検証する
 * (DNSリバインディング・オープンリダイレクト経由での内部ホストアクセスを防ぐため)。
 * どの段階で拒否・失敗しても例外を投げず`null`を返す。
 */
async function fetchSafely(
  initialUrl: string,
  fetchImpl: FetchLike,
  lookupImpl: LookupLike,
  timeoutMs: number
): Promise<{ response: Response; finalUrl: string } | null> {
  let currentUrl = initialUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const safe = await isUrlSafeToFetch(currentUrl, lookupImpl);
    if (!safe) {
      log.warn("blocked request to disallowed host (private/reserved IP, invalid URL, or DNS failure)", {
        url: currentUrl,
      });
      return null;
    }

    let response: Response;
    try {
      response = await fetchImpl(currentUrl, { redirect: "manual" }, timeoutMs);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn("fetch failed", { url: currentUrl, message });
      return null;
    }

    const location = response.headers.get("location");
    const status = response.status;
    const isRedirect = typeof status === "number" && status >= 300 && status < 400 && !!location;

    if (!isRedirect) {
      return { response, finalUrl: currentUrl };
    }

    if (hop === MAX_REDIRECTS) {
      log.warn("too many redirects; aborting", { url: currentUrl, maxRedirects: MAX_REDIRECTS });
      return null;
    }

    const nextUrl = resolveImageUrl(location, currentUrl);
    if (!nextUrl) {
      log.warn("failed to resolve redirect location; aborting", { url: currentUrl, location });
      return null;
    }
    currentUrl = nextUrl;
  }

  return null;
}

/**
 * レスポンスボディを上限バイト数まで読み込む。`response.body`がReadableStreamとして
 * 提供されている場合は逐次読み込み、累積サイズが上限を超えた時点で中断する
 * (全バイトをメモリにバッファしてからサイズを検知する問題への対策)。
 * ストリームを提供しない環境/モックの場合は`undefined`を返し、呼び出し側でフォールバックする。
 */
async function readStreamWithLimit(response: Response, maxBytes: number): Promise<Buffer | null | undefined> {
  const body = response.body as ReadableStream<Uint8Array> | null | undefined;
  if (!body || typeof body.getReader !== "function") {
    return undefined;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          return null;
        }
        chunks.push(value);
      }
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

/** 画像バイナリを上限バイト数まで読み込む(ストリーミング優先、非対応時はarrayBuffer()にフォールバック) */
async function readImageBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer | null> {
  const streamed = await readStreamWithLimit(response, maxBytes);
  if (streamed !== undefined) return streamed;

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > maxBytes) return null;
  return Buffer.from(arrayBuffer);
}

/** HTMLテキストを上限バイト数まで読み込む(ストリーミング優先、非対応時はtext()にフォールバック) */
async function readTextBodyWithLimit(response: Response, maxBytes: number): Promise<string | null> {
  const streamed = await readStreamWithLimit(response, maxBytes);
  if (streamed !== undefined) {
    return streamed === null ? null : streamed.toString("utf-8");
  }

  const text = await response.text();
  if (Buffer.byteLength(text, "utf-8") > maxBytes) return null;
  return text;
}

/**
 * 画像URLをダウンロードする。
 * - スキーム・ホストの安全性を検証してから取得する(SSRF対策。プライベート/予約IPは拒否)。
 * - リダイレクトは各ホップでホストを再検証しながら追跡する。
 * - Content-Typeが`image/*`でない場合は拒否する。
 * - Content-Length(判明していれば)・実際のダウンロードサイズ(ストリーミング検知)の
 *   いずれかが上限を超える場合は中断する。
 * 失敗時は例外を投げず`null`を返す(呼び出し側が画像なしで処理を継続できるようにするため)。
 */
export async function downloadOgpImage(
  imageUrl: string,
  fetchImpl: FetchLike = defaultFetch,
  lookupImpl: LookupLike = defaultLookup
): Promise<OgpImage | null> {
  const fetched = await fetchSafely(imageUrl, fetchImpl, lookupImpl, OGP_FETCH_TIMEOUT_MS);
  if (!fetched) return null;
  const { response, finalUrl } = fetched;

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("image/")) {
    log.warn("ogp image response was not an image content-type; skipping image attachment", {
      imageUrl: finalUrl,
      contentType,
    });
    return null;
  }

  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader && Number(contentLengthHeader) > MAX_IMAGE_BYTES) {
    log.warn("ogp image exceeds size limit (content-length); skipping image attachment", {
      imageUrl: finalUrl,
      contentLength: contentLengthHeader,
      maxBytes: MAX_IMAGE_BYTES,
    });
    return null;
  }

  let buffer: Buffer | null;
  try {
    buffer = await readImageBodyWithLimit(response, MAX_IMAGE_BYTES);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("failed to read ogp image body; continuing without image", { imageUrl: finalUrl, message });
    return null;
  }

  if (buffer === null) {
    log.warn("ogp image exceeds size limit (actual size); skipping image attachment", {
      imageUrl: finalUrl,
      maxBytes: MAX_IMAGE_BYTES,
    });
    return null;
  }

  return { url: finalUrl, buffer, contentType };
}

/**
 * 選定記事のURLから、OGP画像を取得する(HTML取得→抽出→検証→ダウンロードまでを一括で行う)。
 * どの段階で失敗しても(通信失敗・内部ホスト拒否・og:imageタグ無し・スキーム不正・
 * Content-Type不正・サイズ超過)例外を投げず`null`を返す。呼び出し側(パイプライン)は
 * これを「画像なしで投稿処理を継続する」判断に使う。
 */
export async function fetchOgpImageForArticle(
  articleUrl: string,
  fetchImpl: FetchLike = defaultFetch,
  lookupImpl: LookupLike = defaultLookup
): Promise<OgpImage | null> {
  const fetched = await fetchSafely(articleUrl, fetchImpl, lookupImpl, OGP_FETCH_TIMEOUT_MS);
  if (!fetched) return null;
  const { response, finalUrl } = fetched;

  let html: string | null;
  try {
    html = await readTextBodyWithLimit(response, MAX_ARTICLE_HTML_BYTES);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("failed to fetch article HTML for ogp image extraction; continuing without image", {
      articleUrl: finalUrl,
      message,
    });
    return null;
  }

  if (html === null) {
    log.warn("article HTML exceeds size limit; skipping image extraction", {
      articleUrl: finalUrl,
      maxBytes: MAX_ARTICLE_HTML_BYTES,
    });
    return null;
  }

  const rawImageUrl = extractOgImageUrl(html);
  if (!rawImageUrl) {
    log.info("no og:image found for article; continuing without image", { articleUrl: finalUrl });
    return null;
  }

  const resolvedUrl = resolveImageUrl(rawImageUrl, finalUrl);
  if (!resolvedUrl) {
    log.warn("failed to resolve og:image url; continuing without image", { articleUrl: finalUrl, rawImageUrl });
    return null;
  }

  return downloadOgpImage(resolvedUrl, fetchImpl, lookupImpl);
}
