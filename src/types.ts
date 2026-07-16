/** F1: 収集したAIニュース候補の構造化データ */
export interface NewsCandidate {
  /** 記事タイトル */
  title: string;
  /** 元記事URL */
  url: string;
  /** 情報源名(例: "Hacker News", "TechCrunch AI") */
  source: string;
  /** 推定公開時刻(ISO8601文字列)。真の公開時刻が取得できない場合はプレースホルダ値が入る */
  publishedAt: string;
  /**
   * trueの場合、publishedAtは情報源から取得できなかったためのプレースホルダであり、
   * 実際の公開時刻ではないことを示す。スコアリング時に鮮度で有利に扱ってはならない。
   */
  publishedAtUnknown?: boolean;
  /** 急上昇スコア(スコアリング後に付与。収集直後は未計算の場合がある) */
  score?: number;
  /** スコア内訳(デバッグ・検証用) */
  scoreBreakdown?: {
    freshness: number;
    buzz: number;
    mentionCount: number;
    engagement: number;
  };
  /** AI関連判定用の概要テキスト(任意。最終出力には不要だが判定精度向上に使う) */
  summary?: string;
}

/** ソース単位の収集結果。一部ソースの失敗を許容するための型 */
export interface SourceFetchResult {
  source: string;
  candidates: NewsCandidate[];
  error?: string;
}

/** 収集ソース1件分の定義。fetchが失敗しても呼び出し側が個別にcatchできる単位 */
export interface SourceFetcher {
  name: string;
  fetch: () => Promise<import("./scoring.js").ScorableCandidate[]>;
}

/**
 * F2/F9: 投稿(選定)履歴1件分。
 *
 * Sprint 2時点では「投稿対象として確定した」タイミングで記録される最小限の履歴。
 * Sprint 7(F9: 冪等性・不発リカバリ)でslot(投稿枠)・status(成功/失敗)・tweetIds等を
 * 拡張する前提のため、キーの追加だけで済むようフラットな形にしてある。
 */
export interface PostHistoryEntry {
  /** 元記事URL(そのまま) */
  url: string;
  /** normalizeUrl()済みのURL。既出判定の照合に使う */
  normalizedUrl: string;
  /** 記事タイトル(実質同一記事の判定・ログ確認用) */
  title: string;
  /** 選定時点の急上昇スコア */
  score?: number;
  /** この記事が投稿対象として選定された日時(ISO8601) */
  selectedAt: string;
}
