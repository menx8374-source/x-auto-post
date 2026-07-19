/**
 * SSRF対策用の簡易ホスト名チェック。
 *
 * Cloudflare WorkersのfetchはNode.jsサーバーとは異なりCloudflareのエッジネットワーク経由で
 * DNS解決・接続されるため、Node版(`src/ogpImage.ts`)のようなカスタムDNS pinningは
 * 実装できない/不要。ただし、明白に内部向けなホスト名文字列の入力は多層防御として弾く
 * (`/api/suggestFacts`が外部から辿ってきたURL(管理者の任意入力等)を`fetch()`する前に必ず通すこと)。
 */
import { isHttpUrl } from "./validate";

/** 明らかにローカル/内部向けと分かるホスト名のパターン */
const BLOCKED_HOSTNAME_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127(\.\d{1,3}){3}$/,
  /^0\.0\.0\.0$/,
  /^0$/,
  /^169\.254(\.\d{1,3}){2}$/,
  /^\[?::1\]?$/,
  /^\[?::\]?$/,
];

/** ホスト名(URL.hostname)が明らかにローカル/内部向けかどうかを判定する */
export function isBlockedHostname(hostname: string): boolean {
  if (typeof hostname !== "string" || hostname.length === 0) return true;
  const normalized = hostname.toLowerCase();
  return BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * 外部サイトへのfetch対象として安全か(http/httpsであり、かつ明らかな内部向けホストでないか)を判定する。
 * 例外は投げず、不正な値・パースできない値は安全側(false)に倒す。
 */
export function isSafeExternalUrl(url: string): boolean {
  if (!isHttpUrl(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return !isBlockedHostname(parsed.hostname);
}
