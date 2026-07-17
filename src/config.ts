/**
 * F12: 運用パラメータ(投稿時刻・言語/トーン・最大ツイート本数・リンクツイート有無/位置・許容遅延)を
 * 1箇所で管理する設定モジュール。
 *
 * 設計方針:
 * - 挙動系の設定(このファイル)と認証情報系の設定(ANTHROPIC_API_KEY/X_API_KEY等。generatePost.ts/
 *   xPublish.tsが個別にprocess.envから直接読み込む、既存の設計を踏襲)を分離する。このファイルは
 *   認証情報の実値を一切保持・出力しない({@link getCredentialsStatus}は真偽値のみを返す)。
 * - 各値は「.envの変更が処理に反映される」ことを保証するため、モジュール読み込み時ではなく
 *   呼び出し時にprocess.envを読む関数として実装する(src/postHistory.tsのgetConfiguredRecoveryWindowHours
 *   と同じ方式)。CLIエントリポイントは各`main()`内で`.env`を読み込んだ「後」にパイプラインを実行するため、
 *   モジュールトップレベルの定数として一度だけ読むと`.env`側の変更が反映されない。
 * - {@link assertValidConfig}は起動時(パイプライン実行の最初)に一度呼ばれ、不正値をまとめて検知して
 *   例外にする(壊れた設定のまま投稿処理へ進ませないため)。個別のgetter関数群は運用継続性を優先し、
 *   不正値があれば警告ログを残してデフォルト値にフォールバックする(既存のgetConfiguredRecoveryWindowHours
 *   と同じ方針。cronでの自動実行が、軽微な設定ミス1つで全面停止しないようにするため)。
 */
import { log } from "./logger.js";

export type SlotId = "morning" | "noon" | "evening";

export interface PostSlotTime {
  id: SlotId;
  label: string;
  hourJst: number;
  minuteJst: number;
}

export type LinkTweetPosition = "start" | "end";

export interface GenerationStyle {
  language: string;
  tone: string;
}

export interface LinkTweetConfig {
  enabled: boolean;
  position: LinkTweetPosition;
}

interface SlotTimeSpec {
  id: SlotId;
  label: string;
  envVar: string;
  defaultTime: string; // "HH:MM"
}

const SLOT_SPECS: SlotTimeSpec[] = [
  { id: "morning", label: "朝", envVar: "POST_SLOT_MORNING_TIME", defaultTime: "07:30" },
  { id: "noon", label: "昼", envVar: "POST_SLOT_NOON_TIME", defaultTime: "12:15" },
  { id: "evening", label: "夜", envVar: "POST_SLOT_EVENING_TIME", defaultTime: "21:00" },
];

const TIME_FORMAT = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseTimeString(raw: string): { hourJst: number; minuteJst: number } | undefined {
  const match = TIME_FORMAT.exec(raw.trim());
  if (!match) {
    return undefined;
  }
  return { hourJst: Number(match[1]), minuteJst: Number(match[2]) };
}

export const DEFAULT_LANGUAGE = "ja";
export const DEFAULT_TONE =
  "AIニュースを紹介するXアカウントとして中立的・正確で、煽りすぎない自然なトーン。";
export const DEFAULT_MAX_BODY_TWEETS = 6;
export const DEFAULT_LINK_TWEET_ENABLED = true;
export const DEFAULT_LINK_TWEET_POSITION: LinkTweetPosition = "end";
export const DEFAULT_RECOVERY_WINDOW_HOURS = 3;

interface ParsedField<T> {
  value: T;
  error?: string;
}

function parseSlotTime(spec: SlotTimeSpec, env: NodeJS.ProcessEnv): ParsedField<PostSlotTime> {
  const fallback = { id: spec.id, label: spec.label, ...parseTimeString(spec.defaultTime)! };
  const raw = env[spec.envVar];
  if (!raw) {
    return { value: fallback };
  }
  const parsed = parseTimeString(raw);
  if (!parsed) {
    return {
      value: fallback,
      error: `${spec.envVar} の値 "${raw}" は不正な時刻形式です("HH:MM"、00:00〜23:59で指定してください)`,
    };
  }
  return { value: { id: spec.id, label: spec.label, ...parsed } };
}

/**
 * F7/F12: 投稿枠(朝/昼/夜)の目安時刻を返す唯一の取得口。呼び出しのたびにprocess.envを読み直すため、
 * `POST_SLOT_MORNING_TIME`等の`.env`設定が実行のたびに反映される。
 */
export function getPostSlots(env: NodeJS.ProcessEnv = process.env): PostSlotTime[] {
  return SLOT_SPECS.map((spec) => {
    const { value, error } = parseSlotTime(spec, env);
    if (error) {
      log.warn(`invalid ${spec.envVar}; falling back to default (${spec.defaultTime})`, { raw: env[spec.envVar] });
    }
    return value;
  });
}

function parseLanguage(env: NodeJS.ProcessEnv): ParsedField<string> {
  const raw = env.POST_LANGUAGE?.trim();
  if (!raw) {
    return { value: DEFAULT_LANGUAGE };
  }
  return { value: raw };
}

function parseTone(env: NodeJS.ProcessEnv): ParsedField<string> {
  const raw = env.POST_TONE?.trim();
  if (!raw) {
    return { value: DEFAULT_TONE };
  }
  return { value: raw };
}

/** F3/F12: 生成する投稿文面の言語・トーンを返す唯一の取得口(`POST_LANGUAGE`/`POST_TONE`で上書き可)。 */
export function getGenerationStyle(env: NodeJS.ProcessEnv = process.env): GenerationStyle {
  const language = parseLanguage(env);
  const tone = parseTone(env);
  if (language.error) log.warn(language.error);
  if (tone.error) log.warn(tone.error);
  return { language: language.value, tone: tone.value };
}

function parseMaxBodyTweets(env: NodeJS.ProcessEnv): ParsedField<number> {
  const raw = env.POST_MAX_BODY_TWEETS;
  if (!raw) {
    return { value: DEFAULT_MAX_BODY_TWEETS };
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return {
      value: DEFAULT_MAX_BODY_TWEETS,
      error: `POST_MAX_BODY_TWEETS の値 "${raw}" は不正です(1以上の整数を指定してください)`,
    };
  }
  return { value: parsed };
}

/** F4/F12: 1スレッドに含める本文ツイートの上限本数を返す唯一の取得口(`POST_MAX_BODY_TWEETS`で上書き可)。 */
export function getMaxBodyTweets(env: NodeJS.ProcessEnv = process.env): number {
  const { value, error } = parseMaxBodyTweets(env);
  if (error) log.warn(error);
  return value;
}

function parseLinkTweetEnabled(env: NodeJS.ProcessEnv): ParsedField<boolean> {
  const raw = env.POST_LINK_TWEET_ENABLED;
  if (!raw) {
    return { value: DEFAULT_LINK_TWEET_ENABLED };
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true") return { value: true };
  if (normalized === "false") return { value: false };
  return {
    value: DEFAULT_LINK_TWEET_ENABLED,
    error: `POST_LINK_TWEET_ENABLED の値 "${raw}" は不正です("true"または"false"を指定してください)`,
  };
}

function parseLinkTweetPosition(env: NodeJS.ProcessEnv): ParsedField<LinkTweetPosition> {
  const raw = env.POST_LINK_TWEET_POSITION;
  if (!raw) {
    return { value: DEFAULT_LINK_TWEET_POSITION };
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === "start" || normalized === "end") {
    return { value: normalized };
  }
  return {
    value: DEFAULT_LINK_TWEET_POSITION,
    error: `POST_LINK_TWEET_POSITION の値 "${raw}" は不正です("start"または"end"を指定してください)`,
  };
}

/** F5/F12: リンクツイートの有無・位置を返す唯一の取得口(`POST_LINK_TWEET_ENABLED`/`POST_LINK_TWEET_POSITION`で上書き可)。 */
export function getLinkTweetConfig(env: NodeJS.ProcessEnv = process.env): LinkTweetConfig {
  const enabled = parseLinkTweetEnabled(env);
  const position = parseLinkTweetPosition(env);
  if (enabled.error) log.warn(enabled.error);
  if (position.error) log.warn(position.error);
  return { enabled: enabled.value, position: position.value };
}

function parseRecoveryWindowHours(env: NodeJS.ProcessEnv): ParsedField<number> {
  const raw = env.POST_RECOVERY_WINDOW_HOURS;
  if (!raw) {
    return { value: DEFAULT_RECOVERY_WINDOW_HOURS };
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return {
      value: DEFAULT_RECOVERY_WINDOW_HOURS,
      error: `POST_RECOVERY_WINDOW_HOURS の値 "${raw}" は不正です(0以上の数値を指定してください)`,
    };
  }
  return { value: parsed };
}

/** F9/F12: 不発リカバリの許容範囲(時間)を返す唯一の取得口(`POST_RECOVERY_WINDOW_HOURS`で上書き可)。 */
export function getRecoveryWindowHours(env: NodeJS.ProcessEnv = process.env): number {
  const { value, error } = parseRecoveryWindowHours(env);
  if (error) log.warn(error);
  return value;
}

/** 認証情報系設定の「設定済みかどうか」だけを返す(実値は一切保持・出力しない) */
export interface CredentialsStatus {
  anthropicApiKeyConfigured: boolean;
  /** X API認証情報4つ(X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET)すべてが設定されている */
  xCredentialsConfigured: boolean;
  /** X API認証情報が1〜3個だけ設定されている(設定ミスの疑いが強い状態) */
  xCredentialsPartiallyConfigured: boolean;
}

export function getCredentialsStatus(env: NodeJS.ProcessEnv = process.env): CredentialsStatus {
  const xVars = [env.X_API_KEY, env.X_API_SECRET, env.X_ACCESS_TOKEN, env.X_ACCESS_SECRET];
  const xSetCount = xVars.filter((v) => !!v).length;
  return {
    anthropicApiKeyConfigured: !!env.ANTHROPIC_API_KEY,
    xCredentialsConfigured: xSetCount === 4,
    xCredentialsPartiallyConfigured: xSetCount > 0 && xSetCount < 4,
  };
}

export class ConfigError extends Error {
  errors: string[];
  constructor(errors: string[]) {
    super(`設定に不正な値があります:\n- ${errors.join("\n- ")}`);
    this.name = "ConfigError";
    this.errors = errors;
  }
}

/**
 * 起動時(パイプライン実行の最初)に一度だけ呼ぶ厳格な検証。
 * 不正値があればすべてまとめて{@link ConfigError}として投げる(壊れた挙動のまま投稿処理へ
 * 進ませないため)。個別のgetter関数と異なりフォールバックしない。
 */
export function assertValidConfig(env: NodeJS.ProcessEnv = process.env): void {
  const errors: string[] = [];

  for (const spec of SLOT_SPECS) {
    const { error } = parseSlotTime(spec, env);
    if (error) errors.push(error);
  }

  const language = parseLanguage(env);
  if (language.error) errors.push(language.error);

  const tone = parseTone(env);
  if (tone.error) errors.push(tone.error);

  const maxBodyTweets = parseMaxBodyTweets(env);
  if (maxBodyTweets.error) errors.push(maxBodyTweets.error);

  const linkEnabled = parseLinkTweetEnabled(env);
  if (linkEnabled.error) errors.push(linkEnabled.error);

  const linkPosition = parseLinkTweetPosition(env);
  if (linkPosition.error) errors.push(linkPosition.error);

  const recovery = parseRecoveryWindowHours(env);
  if (recovery.error) errors.push(recovery.error);

  const credentials = getCredentialsStatus(env);
  if (credentials.xCredentialsPartiallyConfigured) {
    errors.push(
      "X API認証情報が一部だけ設定されています(X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRETは" +
        "4つとも設定するか、4つとも未設定にしてください)"
    );
  }

  if (errors.length > 0) {
    throw new ConfigError(errors);
  }
}
