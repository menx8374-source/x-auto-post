/**
 * 構造化ログの簡易ユーティリティ。
 *
 * 想定内のソース通信失敗は `warn` を使う(仕様上「コンソールエラー」に数えないため)。
 * `error` は想定外の致命的な失敗にのみ使う。
 *
 * F10: 認証情報系の環境変数(ANTHROPIC_API_KEY/X_API_KEY等)の実値がメッセージ・meta経由で
 * うっかり出力されても、既知の値と一致する部分文字列をマスクする多層防御をここに実装する。
 * 呼び出し側のコードが誤って実値を渡してしまっても、最終的な出力はマスクされる。
 */
function timestamp(): string {
  return new Date().toISOString();
}

/**
 * ログに実値が出力されてはならない認証情報系の環境変数のベース名。
 * 複数アカウント対応(src/accounts.ts)により、新規アカウントは`<ベース名>__<サフィックス>`
 * (例: X_API_KEY__SUB2)という名前の環境変数を使うため、ベース名との完全一致だけでなく
 * `<ベース名>__`で始まる変数名もすべて対象にする({@link isSensitiveEnvVarName}参照)。
 * accounts.tsを直接importしない(config.ts経由の循環import回避、かつ将来アカウントが
 * 増減しても常に実際にprocess.envへ設定されている変数だけを対象にできるため)。
 */
const SENSITIVE_ENV_VAR_BASE_NAMES = ["ANTHROPIC_API_KEY", "X_API_KEY", "X_API_SECRET", "X_ACCESS_TOKEN", "X_ACCESS_SECRET"];

const MASK = "***MASKED***";

function isSensitiveEnvVarName(name: string): boolean {
  return SENSITIVE_ENV_VAR_BASE_NAMES.some((base) => name === base || name.startsWith(`${base}__`));
}

/** 文字列中に現在設定されている認証情報の実値が含まれていれば置換する。短すぎる値(誤爆防止)は対象外 */
function maskString(value: string): string {
  let masked = value;
  for (const key of Object.keys(process.env)) {
    if (!isSensitiveEnvVarName(key)) continue;
    const secret = process.env[key];
    if (secret && secret.trim().length >= 4 && masked.includes(secret)) {
      masked = masked.split(secret).join(MASK);
    }
  }
  return masked;
}

/**
 * meta(ログの付加情報)を再帰的に走査し、文字列の葉ノードだけをマスクする。
 *
 * `seen`は「現在の探索パス(祖先ノード)」を表すWeakSetで、真の循環参照(自分自身を
 * 祖先に持つ)のみを検出する。同じオブジェクトへの単なる重複参照(兄弟・別枝からの
 * 参照)は循環ではないため、そのノードの処理を終えて再帰から戻る際に必ず
 * `seen.delete(...)`し、他の枝からは通常通り実際の値としてマスク処理させる。
 */
function maskValue(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === "string") {
    return maskString(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return "[circular]";
    }
    seen.add(value);
    const out = value.map((v) => maskValue(v, seen));
    seen.delete(value);
    return out;
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) {
      return "[circular]";
    }
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = maskValue(v, seen);
    }
    seen.delete(value);
    return out;
  }
  return value;
}

function maskMeta(meta?: Record<string, unknown>): unknown {
  return meta ? maskValue(meta) : "";
}

export const log = {
  info(message: string, meta?: Record<string, unknown>): void {
    console.log(`[${timestamp()}] [INFO] ${maskString(message)}`, maskMeta(meta));
  },
  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(`[${timestamp()}] [WARN] ${maskString(message)}`, maskMeta(meta));
  },
  error(message: string, meta?: Record<string, unknown>): void {
    console.error(`[${timestamp()}] [ERROR] ${maskString(message)}`, maskMeta(meta));
  },
};
