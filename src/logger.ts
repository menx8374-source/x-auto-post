/**
 * 構造化ログの簡易ユーティリティ。
 *
 * 想定内のソース通信失敗は `warn` を使う(仕様上「コンソールエラー」に数えないため)。
 * `error` は想定外の致命的な失敗にのみ使う。
 */
function timestamp(): string {
  return new Date().toISOString();
}

export const log = {
  info(message: string, meta?: Record<string, unknown>): void {
    console.log(`[${timestamp()}] [INFO] ${message}`, meta ?? "");
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(`[${timestamp()}] [WARN] ${message}`, meta ?? "");
  },
  error(message: string, meta?: Record<string, unknown>): void {
    console.error(`[${timestamp()}] [ERROR] ${message}`, meta ?? "");
  },
};
