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
 * Sprint 2時点では「投稿対象として確定した」タイミングで記録される最小限の履歴だった。
 * Sprint 7(F9: 冪等性・不発リカバリ)でslot(投稿枠)・status・postedAt・tweetIds を追加し、
 * 正式な投稿状態・履歴管理へ拡張した。追加フィールドはすべて任意(optional)のため、
 * Sprint 2形式の既存データ(これらのフィールドを持たない)もそのまま読み込める。
 */
export interface PostHistoryEntry {
  /**
   * エントリの一意識別子(Sprint 7で追加)。選定時に発行し、投稿完了後に同じidで
   * updateHistoryEntry()から結果(postedAt/tweetIds/status)を反映するために使う。
   * Sprint 2以前に書き込まれたエントリには存在しない。
   */
  id?: string;
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
  /**
   * 投稿枠(通常はsrc/postSchedule.tsのPOST_SLOTS[].id="morning"|"noon"|"evening")。
   * 同一枠・同一日の冪等性判定(hasPostedSlotOnDate)のキーに使う。
   */
  slot?: string;
  /** 実際に投稿(全ツイート送信)が完了した日時(ISO8601)。status:"posted"のときのみ設定される */
  postedAt?: string;
  /** 投稿できたツイートIDの配列(投稿順)。1件も投稿できていない場合は未設定または空配列 */
  tweetIds?: string[];
  /**
   * エントリの状態。
   * - "selected": 投稿対象として選定されたのみ(未設定/Sprint2形式の既存データもこれと同義)
   * - "posted": 実際にXへの投稿が完了した
   * - "failed": 投稿を試みたが失敗した(既出判定には引き続き使われるが、slot冪等性判定はブロックしない)
   */
  status?: "selected" | "posted" | "failed";
}
