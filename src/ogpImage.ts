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
 *     リンクローカル/マルチキャスト等の内部向けアドレス範囲に該当する場合は拒否する
 *     (`isUrlSafeToFetch`。ただし早期リジェクトのための補助的なチェックであり、下記の
 *     接続時検証が唯一の安全境界)。
 *   - **接続時の名前解決そのものを検証する(DNSリバインディング対策の本体)**: 実際に
 *     ソケットを張る際にNode標準fetch(undici)が独自にDNS解決を行うと、事前チェックとは
 *     別のタイミング・別の呼び出しになるため、TTL=0のDNSレコード操作等でTOCTOUの
 *     すき間を突かれうる(検証時は公開IPを返し、接続時にだけ内部IPを返す)。これを防ぐため、
 *     `undici`の`Agent`に`connect.lookup`としてカスタムlookup関数(`createSafeLookup`)を
 *     渡し、「実際に接続で使う名前解決」の内部でその場で安全性を検証する。これにより
 *     「検証に使った解決結果」と「接続に使う解決結果」が構造的に同一の呼び出しになり、
 *     両者がズレる余地(TOCTOU)が無くなる。
 *   - リダイレクト(3xx)は`redirect: "manual"`で検知し、リダイレクト先URLに対しても
 *     同じホスト検証を行ってから追跡する。追跡ホップ数には上限を設ける。
 *   - DNS解決自体にもタイムアウトを設け、応答しないリゾルバによる無期限ハングを防ぐ。
 *   - レスポンスボディの読み取り(ストリーミング)にもヘッダ受信とは別にタイムアウトを設け、
 *     ヘッダだけ即座に返しボディを意図的に停滞させる悪意あるホストによるハングを防ぐ。
 */
import { promises as dns } from "node:dns";
import type { LookupAddress, LookupOptions } from "node:dns";
import net from "node:net";
import { Agent as UndiciAgent, fetch as undiciFetch } from "undici";
import { log } from "./logger.js";

/** ダウンロードを許容する画像サイズの上限(バイト) */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB

/** 記事HTML取得を許容するサイズの上限(バイト) */
export const MAX_ARTICLE_HTML_BYTES = 2 * 1024 * 1024; // 2MB

/** 記事HTML取得・画像ダウンロードのタイムアウト(ミリ秒、1ホップあたり)。ボディ読み取りにも同じ値を適用する */
export const OGP_FETCH_TIMEOUT_MS = 8000;

/** DNS解決自体のタイムアウト(ミリ秒)。応答しないリゾルバによる無期限ハングを防ぐ */
export const DNS_LOOKUP_TIMEOUT_MS = 5000;

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

/** テスト用に差し替え可能なfetch関数の型(既定はタイムアウト・SSRF対策付きの素のfetch) */
export type FetchLike = (
  url: string,
  init?: RequestInit,
  timeoutMs?: number,
  lookupImpl?: LookupLike
) => Promise<Response>;

/** テスト用に差し替え可能なDNS lookup関数の型(既定は`dns.promises.lookup`) */
export type LookupLike = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

/** Promiseにタイムアウトを適用する。超過時は`message`を持つErrorでrejectする */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

type NodeLookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number
) => void;

/**
 * undiciの`Agent`(`connect.lookup`)に渡すカスタムDNS lookup関数を生成する。
 * これが「実際に接続する際に使う名前解決」そのものであり、その場で解決結果の安全性を
 * 検証する。これにより「検証用の解決」と「接続用の解決」が同一の呼び出しになり、
 * DNSリバインディングによるTOCTOUのすき間が構造的に無くなる(ここが唯一の安全境界)。
 */
function createSafeLookup(
  lookupImpl: LookupLike
): (hostname: string, options: LookupOptions, callback: NodeLookupCallback) => void {
  return (hostname, options, callback) => {
    withTimeout(lookupImpl(hostname), DNS_LOOKUP_TIMEOUT_MS, "dns lookup timed out")
      .then((results) => {
        if (!results || results.length === 0) {
          callback(new Error(`DNS lookup returned no results for host: ${hostname}`), "");
          return;
        }
        const unsafe = results.find((r) => isPrivateOrReservedIp(r.address));
        if (unsafe) {
          callback(
            new Error(
              `refusing to connect to disallowed host (private/reserved IP): ${hostname} -> ${unsafe.address}`
            ),
            ""
          );
          return;
        }
        if (options?.all) {
          callback(null, results.map((r) => ({ address: r.address, family: r.family })) as LookupAddress[]);
          return;
        }
        const wantedFamily = options?.family;
        const chosen = (wantedFamily ? results.find((r) => r.family === wantedFamily) : undefined) ?? results[0];
        callback(null, chosen.address, chosen.family);
      })
      .catch((err) => {
        callback(err instanceof Error ? err : new Error(String(err)), "");
      });
  };
}

/**
 * タイムアウト・SSRF対策付きの素のfetch。`src/http.ts`の`fetchWithTimeout`と異なり、
 * `!response.ok`でも例外を投げない(リダイレクト(3xx)レスポンスを`redirect: "manual"`で
 * 受け取って検証するため、呼び出し側でステータスを判定する必要がある)。
 * 実接続には`undici`の`Agent`を使い、`connect.lookup`に`createSafeLookup`を渡すことで
 * 実際に接続で使う名前解決そのものを検証する(DNSリバインディング対策)。
 */
async function rawFetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = OGP_FETCH_TIMEOUT_MS,
  lookupImpl: LookupLike = defaultLookup
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const dispatcher = new UndiciAgent({ connect: { lookup: createSafeLookup(lookupImpl) } });
  try {
    const response = await undiciFetch(url, { ...init, signal: controller.signal, dispatcher } as never);
    return response as unknown as Response;
  } finally {
    clearTimeout(timer);
  }
}

// export: src/a8NetHint.ts連携(src/generateCandidateHints.ts)がfetchSafely()をそのまま呼び出す際の
// 既定のfetchImpl/lookupImplとして再利用するため(ロジック変更なし、exportキーワードの追加のみ)。
export const defaultFetch: FetchLike = rawFetchWithTimeout;
export const defaultLookup: LookupLike = (hostname) => dns.lookup(hostname, { all: true });

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

/**
 * ホスト名を解決し、解決先アドレスがすべて内部/予約向けでないことを検証する。
 * これは早期リジェクトのための補助チェック(無駄なソケット確立を避けるだけ)であり、
 * 実際の安全境界は`createSafeLookup`(接続時の名前解決そのものの検証)にある。
 */
async function isHostSafe(hostname: string, lookupImpl: LookupLike): Promise<boolean> {
  let results: Array<{ address: string; family: number }>;
  try {
    results = await withTimeout(lookupImpl(hostname), DNS_LOOKUP_TIMEOUT_MS, "dns lookup timed out");
  } catch {
    return false; // 名前解決に失敗・タイムアウトした場合は安全側に倒して拒否する
  }
  if (!results || results.length === 0) return false;
  return results.every((r) => !isPrivateOrReservedIp(r.address));
}

/** URLがスキーム・ホストともにフェッチしてよい相手かを検証する(早期リジェクト用の補助チェック) */
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
 * SSRF対策付きでURLをフェッチする。各ホップで(早期リジェクト用の)ホスト安全性チェックを
 * 行ってから`fetchImpl`を呼び、リダイレクト(3xx + Location)は手動で追跡してリダイレクト先も
 * 同様に検証する。`fetchImpl`(既定は`rawFetchWithTimeout`)には`lookupImpl`をそのまま渡し、
 * 実際の接続時の名前解決でも同じ検証を行わせる(DNSリバインディング対策の本体)。
 * どの段階で拒否・失敗しても例外を投げず`null`を返す。
 */
export async function fetchSafely(
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
      response = await fetchImpl(currentUrl, { redirect: "manual" }, timeoutMs, lookupImpl);
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

/** ボディ読み取りの結果種別。呼び出し側がサイズ超過・タイムアウト・読み取りエラーを区別できるようにする */
type ReadOutcome<T> =
  | { status: "ok"; value: T }
  | { status: "too-large" }
  | { status: "timeout" }
  | { status: "error"; message: string };

/** ストリーミング読み取りの内部結果種別(ストリーム非対応の場合の`unsupported`を含む) */
type StreamOutcome =
  | { status: "ok"; buffer: Buffer }
  | { status: "unsupported" }
  | { status: "too-large" }
  | { status: "timeout" }
  | { status: "error"; message: string };

function toErrorOutcome<T>(err: unknown): ReadOutcome<T> {
  const message = err instanceof Error ? err.message : String(err);
  if (message === "body read timed out") return { status: "timeout" };
  return { status: "error", message };
}

/**
 * レスポンスボディを上限バイト数まで読み込む。`response.body`がReadableStreamとして
 * 提供されている場合は逐次読み込み、累積サイズが上限を超えた時点で中断する
 * (全バイトをメモリにバッファしてからサイズを検知する問題への対策)。
 * 読み取り開始時刻から`timeoutMs`を超えても完了しない場合は中断し`timeout`を返す
 * (ヘッダだけ即座に返しボディを意図的に停滞させる悪意あるホスト対策)。
 * ストリームを提供しない環境/モックの場合は`unsupported`を返し、呼び出し側でフォールバックする。
 */
export async function readStreamWithLimit(
  response: Response,
  maxBytes: number,
  timeoutMs: number
): Promise<StreamOutcome> {
  const body = response.body as ReadableStream<Uint8Array> | null | undefined;
  if (!body || typeof body.getReader !== "function") {
    return { status: "unsupported" };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = Date.now() + timeoutMs;
  const TIMEOUT = Symbol("readStreamWithLimit:timeout");

  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        reader.cancel().catch(() => {});
        return { status: "timeout" };
      }

      // `reader.read()`が呼び出し側の期待どおりcancel()で必ず解決するとは限らない
      // (悪意あるホスト・ストリーム実装に依存させない)ため、cancel()を呼ぶだけでなく
      // `Promise.race`で強制的にタイムアウト側を勝たせて制御を返す。
      // 未解決のまま残る`pendingRead`は、後で解決/棄却してもunhandled rejectionに
      // ならないよう空のcatchハンドラを付けておく。
      let timer: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT), remaining);
      });
      const pendingRead = reader.read();
      pendingRead.catch(() => {});

      const raced = await Promise.race([pendingRead, timeoutPromise]);
      clearTimeout(timer!);

      if (raced === TIMEOUT) {
        reader.cancel().catch(() => {});
        return { status: "timeout" };
      }

      const { done, value } = raced as { done: boolean; value?: Uint8Array };
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          return { status: "too-large" };
        }
        chunks.push(value);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { status: "error", message };
  }

  return { status: "ok", buffer: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))) };
}

/** 画像バイナリを上限バイト数まで読み込む(ストリーミング優先、非対応時はarrayBuffer()にフォールバック) */
async function readImageBodyWithLimit(
  response: Response,
  maxBytes: number,
  timeoutMs: number
): Promise<ReadOutcome<Buffer>> {
  const streamed = await readStreamWithLimit(response, maxBytes, timeoutMs);
  if (streamed.status === "ok") return { status: "ok", value: streamed.buffer };
  if (streamed.status !== "unsupported") return streamed;

  try {
    const arrayBuffer = await withTimeout(response.arrayBuffer(), timeoutMs, "body read timed out");
    if (arrayBuffer.byteLength > maxBytes) return { status: "too-large" };
    return { status: "ok", value: Buffer.from(arrayBuffer) };
  } catch (err) {
    return toErrorOutcome(err);
  }
}

/** HTMLテキストを上限バイト数まで読み込む(ストリーミング優先、非対応時はtext()にフォールバック) */
export async function readTextBodyWithLimit(
  response: Response,
  maxBytes: number,
  timeoutMs: number
): Promise<ReadOutcome<string>> {
  const streamed = await readStreamWithLimit(response, maxBytes, timeoutMs);
  if (streamed.status === "ok") return { status: "ok", value: streamed.buffer.toString("utf-8") };
  if (streamed.status !== "unsupported") return streamed;

  try {
    const text = await withTimeout(response.text(), timeoutMs, "body read timed out");
    if (Buffer.byteLength(text, "utf-8") > maxBytes) return { status: "too-large" };
    return { status: "ok", value: text };
  } catch (err) {
    return toErrorOutcome(err);
  }
}

/**
 * 画像URLをダウンロードする。
 * - スキーム・ホストの安全性を検証してから取得する(SSRF対策。プライベート/予約IPは拒否)。
 * - リダイレクトは各ホップでホストを再検証しながら追跡する。
 * - Content-Typeが`image/*`でない場合は拒否する。
 * - Content-Length(判明していれば)・実際のダウンロードサイズ(ストリーミング検知)の
 *   いずれかが上限を超える場合は中断する。ボディ読み取りがタイムアウトした場合も中断する。
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

  let bodyResult: ReadOutcome<Buffer>;
  try {
    bodyResult = await readImageBodyWithLimit(response, MAX_IMAGE_BYTES, OGP_FETCH_TIMEOUT_MS);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("failed to read ogp image body; continuing without image", { imageUrl: finalUrl, message });
    return null;
  }

  if (bodyResult.status === "too-large") {
    log.warn("ogp image exceeds size limit (actual size); skipping image attachment", {
      imageUrl: finalUrl,
      maxBytes: MAX_IMAGE_BYTES,
    });
    return null;
  }
  if (bodyResult.status === "timeout") {
    log.warn("ogp image body read timed out; skipping image attachment", {
      imageUrl: finalUrl,
      timeoutMs: OGP_FETCH_TIMEOUT_MS,
    });
    return null;
  }
  if (bodyResult.status === "error") {
    log.warn("failed to read ogp image body; continuing without image", {
      imageUrl: finalUrl,
      message: bodyResult.message,
    });
    return null;
  }

  return { url: finalUrl, buffer: bodyResult.value, contentType };
}

/**
 * 選定記事のURLから、OGP画像を取得する(HTML取得→抽出→検証→ダウンロードまでを一括で行う)。
 * どの段階で失敗しても(通信失敗・内部ホスト拒否・og:imageタグ無し・スキーム不正・
 * Content-Type不正・サイズ超過・タイムアウト)例外を投げず`null`を返す。呼び出し側(パイプライン)は
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

  let htmlResult: ReadOutcome<string>;
  try {
    htmlResult = await readTextBodyWithLimit(response, MAX_ARTICLE_HTML_BYTES, OGP_FETCH_TIMEOUT_MS);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("failed to fetch article HTML for ogp image extraction; continuing without image", {
      articleUrl: finalUrl,
      message,
    });
    return null;
  }

  if (htmlResult.status === "too-large") {
    log.warn("article HTML exceeds size limit; skipping image extraction", {
      articleUrl: finalUrl,
      maxBytes: MAX_ARTICLE_HTML_BYTES,
    });
    return null;
  }
  if (htmlResult.status === "timeout") {
    log.warn("article HTML read timed out; skipping image extraction", {
      articleUrl: finalUrl,
      timeoutMs: OGP_FETCH_TIMEOUT_MS,
    });
    return null;
  }
  if (htmlResult.status === "error") {
    log.warn("failed to read article HTML for ogp image extraction; continuing without image", {
      articleUrl: finalUrl,
      message: htmlResult.message,
    });
    return null;
  }

  const html = htmlResult.value;
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
