/**
 * A8.netのプログラム詳細ページURL(例:
 * `https://media-console.a8.net/program/detail-not-partnered?programId=s00000024524003&fromSearch=true`)を
 * 扱う純粋関数群。
 *
 * 【重要】このURL自体はA8.netのログイン後管理画面内のページのため、サーバー側からfetchで内容を
 * 取得することはできない・しない。ここではURL文字列からのクエリパラメータ抽出・ドメイン検証のみを
 * 行い、ネットワークアクセスは一切発生させない(`new URL()`によるパースのみ)。
 */
/** http:/https:のURLのみ許可する(validate.tsのisHttpUrlと同じロジックだが、循環import回避のためここで独立定義する) */
function isHttpUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/**
 * URLの`programId`クエリパラメータの値を抽出する。存在しない・パース不能な場合はnullを返す。
 * ネットワークアクセスは行わない。
 */
export function parseA8ProgramId(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const programId = parsed.searchParams.get("programId");
  return programId && programId.length > 0 ? programId : null;
}

/**
 * `isHttpUrl`を満たし、かつホスト名が`a8.net`またはそのサブドメインであるかを判定する。
 * `admin/functions/_lib/ssrf.ts`の`isSafeExternalUrl`とは別物(fetchはしないためSSRF対策は不要だが、
 * 明らかに無関係なURLの貼り付けミスを弾くための入力検証として使う)。
 */
export function isA8ProgramDetailUrl(url: string): boolean {
  if (!isHttpUrl(url)) return false;
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return hostname === "a8.net" || hostname.endsWith(".a8.net");
}
