/**
 * 複数Xアカウント対応の基盤: アカウントプロファイルの定義とレジストリ。
 *
 * 設計方針(後方互換最優先):
 * - 既存のデフォルトアカウント(AIニュース, id:"ai-news")は、既存の情報源・言語/トーン・
 *   認証情報の環境変数名(サフィックス無し)・履歴ファイルパス(data/history/post-history.json)を
 *   そのまま使う。このモジュール追加によって既存の動作は一切変わらない。
 * - 新規アカウントを追加する場合のみ、`credentialsEnvSuffix`を指定することで
 *   `X_API_KEY__<SUFFIX>`のような別名の環境変数(GitHub Secrets)・別の履歴ファイルを使う。
 * - accountId省略時は常にデフォルトアカウント(DEFAULT_ACCOUNT_ID)を使う(全パイプライン共通)。
 *
 * 新規アカウントの追加方法は README.md「複数Xアカウント対応」節、GitHub Secrets命名規則・
 * cron-job.org側の設定は docs/cron-setup.md を参照。
 */
import { hackerNewsSource } from "./sources/hackerNews.js";
import { redditSources } from "./sources/reddit.js";
import { rssSources } from "./sources/rss.js";
import { filterAiRelated } from "./aiFilter.js";
import { DEFAULT_LANGUAGE, DEFAULT_TONE, getGenerationStyle, type GenerationStyle } from "./config.js";
import { DEFAULT_HISTORY_FILE } from "./postHistory.js";
import type { SourceFetcher } from "./types.js";

/** 収集した候補リストをアカウントのジャンルに応じて絞り込むフィルタ関数の型 */
export type CandidateFilterFn = <T extends { title: string; summary?: string }>(items: T[]) => T[];

export interface AccountProfile {
  /** アカウント識別子。既存のデフォルトアカウントは"ai-news"固定(後方互換のため変更しない) */
  id: string;
  /** 表示名(ログ・ドキュメント用) */
  label: string;
  /** ジャンルの説明(生成プロンプトの「あなたは○○を紹介するXアカウントの編集者です」に使う) */
  genre: string;
  /**
   * 既定の生成言語("ja"等)。デフォルトアカウントのみ、既存のPOST_LANGUAGE環境変数による
   * 上書きを引き続き受け付ける({@link getGenerationStyleForAccount}参照、後方互換)。
   */
  language: string;
  /** 既定のトーン。デフォルトアカウントのみPOST_TONE環境変数で上書き可(後方互換) */
  tone: string;
  /** このアカウントが使う情報源のリスト */
  sources: SourceFetcher[];
  /** 収集した候補をこのアカウントのジャンルに絞り込むフィルタ(デフォルトアカウントは既存のfilterAiRelatedをそのまま使う) */
  filterCandidates: CandidateFilterFn;
  /**
   * 認証情報系環境変数(ANTHROPIC_API_KEY/X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET)の
   * 名前サフィックス。未設定(デフォルトアカウント)の場合は既存の変数名をそのまま使う。
   * 設定した場合は`<変数名>__<サフィックス>`という名前の環境変数を使う({@link resolveCredentialEnvVarName}参照)。
   */
  credentialsEnvSuffix?: string;
  /** 投稿履歴ファイルの絶対パス(デフォルトアカウントは既存のdata/history/post-history.jsonをそのまま使う) */
  historyFilePath: string;
}

export const DEFAULT_ACCOUNT_ID = "ai-news";

// 既存の情報源(Sprint1〜9で追加されたもの)。デフォルトアカウント("ai-news")専用として維持し、動作を変えない。
const AI_NEWS_SOURCES: SourceFetcher[] = [hackerNewsSource, ...redditSources, ...rssSources];

export const ACCOUNT_PROFILES: AccountProfile[] = [
  {
    id: DEFAULT_ACCOUNT_ID,
    label: "AIニュース",
    genre: "AIニュース",
    language: DEFAULT_LANGUAGE,
    tone: DEFAULT_TONE,
    sources: AI_NEWS_SOURCES,
    filterCandidates: filterAiRelated,
    credentialsEnvSuffix: undefined,
    historyFilePath: DEFAULT_HISTORY_FILE,
  },
];

/**
 * accountIdからAccountProfileを解決する唯一の取得口。省略/空文字の場合はデフォルトアカウントを返す。
 * 未登録のidが指定された場合は例外を投げる(壊れた/存在しないアカウントとしてパイプラインを進めない)。
 */
export function getAccountProfile(accountId?: string): AccountProfile {
  const id = accountId && accountId.trim() ? accountId.trim() : DEFAULT_ACCOUNT_ID;
  const found = ACCOUNT_PROFILES.find((a) => a.id === id);
  if (!found) {
    throw new Error(
      `未知のアカウントID "${id}" が指定されました(登録済み: ${ACCOUNT_PROFILES.map((a) => a.id).join(", ")})`
    );
  }
  return found;
}

/**
 * アカウントの生成スタイル(言語/トーン)を返す。デフォルトアカウントのみ、既存の
 * POST_LANGUAGE/POST_TONE環境変数による上書きを引き続き受け付ける(後方互換)。
 * それ以外のアカウントはプロファイルに登録された固定値を使う。
 */
export function getGenerationStyleForAccount(account: AccountProfile): GenerationStyle {
  if (account.id === DEFAULT_ACCOUNT_ID) {
    return getGenerationStyle();
  }
  return { language: account.language, tone: account.tone };
}

/**
 * 認証情報系環境変数名を、アカウントのcredentialsEnvSuffixに応じて解決する。
 * デフォルトアカウント(credentialsEnvSuffix未設定)は`baseName`をそのまま返す(後方互換)。
 */
export function resolveCredentialEnvVarName(baseName: string, account: AccountProfile): string {
  return account.credentialsEnvSuffix ? `${baseName}__${account.credentialsEnvSuffix}` : baseName;
}
