/**
 * URL正規化ユーティリティ。
 *
 * F1(候補の重複排除)とF2(既出投稿URLの除外)の両方で、
 * 「同じURLとみなす」判定基準を一致させる必要があるため共通化する。
 */
export function normalizeUrl(url: string): string {
  return url.trim().replace(/\/$/, "").toLowerCase();
}
