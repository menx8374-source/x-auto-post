/**
 * F11(+ Sprint1〜4統合): 収集→選定→生成→分割→リンク付与を1本のパイプラインとして実行する。
 *
 * このモジュールが「投稿予定を組み立てる」共通処理のすべてを持つ。ドライラン(このスプリント)と
 * 本番投稿(Sprint 6)の違いは、最後に呼ばれる `publish` 関数(PublishFn)を差し替えるだけ。
 * - ドライラン: `dryRunPublish`(このファイル。Xへ送信せずログに残すだけ)
 * - 本番投稿: Sprint 6で追加される、実際にX APIへ送信する関数を同じ型で渡す
 * それ以外の収集・選定・生成・文字数計算・分割・リンク付与のロジックは完全に共通で、
 * どちらのモードでも同じコードパスを通る。
 */
import { log } from "./logger.js";
import { collectAndScoreNews } from "./collectNews.js";
import { selectNextPost, type SelectionResult } from "./selectPost.js";
import { generatePostText, type PostGenerationResult } from "./generatePost.js";
import { composeThread, type ThreadTweet } from "./threadSplit.js";
import { loadHistory, appendHistoryEntry } from "./postHistory.js";
import type { NewsCandidate, PostHistoryEntry } from "./types.js";

/** 投稿予定ツイート配列を実際に送信する(または送信しない)役目を持つ関数。本番/ドライランの唯一の差し替え点 */
export type PublishFn = (
  tweets: ThreadTweet[],
  candidate: NewsCandidate
) => Promise<PublishResult>;

export interface PublishResult {
  /** 実際にXへ送信したかどうか。ドライランでは常にfalse。スレッド途中で失敗した場合もfalse(部分投稿はtweetIdsで確認する) */
  posted: boolean;
  /** 人間可読な結果の説明(ログ・出力用) */
  detail: string;
  /** 実際に投稿できたツイートIDの配列(投稿順)。1件も投稿できなかった/送信していない場合は空配列 */
  tweetIds?: string[];
  /** 全ツイートの投稿が完了した時刻(ISO8601)。全件成功時のみ設定される */
  postedAt?: string;
  /** スレッド途中で投稿が失敗した場合の失敗箇所(ThreadTweet.indexに対応、1始まり) */
  failedAtIndex?: number;
  /** 失敗時のエラー内容(ログ・出力用) */
  error?: string;
}

/** ドライラン用のpublish実装: 何も送信せず、送信しなかった旨だけを返す */
export const dryRunPublish: PublishFn = async (tweets, candidate) => {
  log.info("dry run: not sending tweets to X", { tweetCount: tweets.length, url: candidate.url });
  return { posted: false, detail: "ドライランのためXへは送信していません" };
};

/**
 * パイプライン各段が使う外部依存。デフォルトは実I/O(実収集・実API・実ファイル)だが、
 * テストではこの一部/全部をモックに差し替えて、ネットワーク・外部APIなしで検証できる。
 */
export interface PipelineDependencies {
  collect: (opts: { injectDecoy?: boolean }) => Promise<{ scored: NewsCandidate[] }>;
  loadHistory: () => Promise<PostHistoryEntry[]>;
  select: (candidates: NewsCandidate[], history: PostHistoryEntry[]) => SelectionResult;
  generate: (candidate: NewsCandidate) => Promise<PostGenerationResult>;
  buildThread: (text: string, url: string) => ThreadTweet[];
  appendHistory: (entry: Omit<PostHistoryEntry, "normalizedUrl">) => Promise<PostHistoryEntry>;
}

const defaultDeps: PipelineDependencies = {
  collect: (opts) => collectAndScoreNews(opts),
  loadHistory: () => loadHistory(),
  select: (candidates, history) => selectNextPost(candidates, history),
  generate: (candidate) => generatePostText(candidate),
  buildThread: (text, url) => composeThread(text, url),
  appendHistory: (entry) => appendHistoryEntry(entry),
};

export type PipelineStage = "select" | "generate" | "thread" | "publish" | "done";

export interface PipelineResult {
  success: boolean;
  /** パイプラインが最後に到達した/停止した段階 */
  stage: PipelineStage;
  /** success:falseの場合の理由(ログ・出力用) */
  error?: string;
  candidate?: NewsCandidate;
  selectionReason?: string;
  consideredCount?: number;
  text?: string;
  tweets?: ThreadTweet[];
  /** 投稿履歴(既出判定用)に書き込んだかどうか */
  historyWritten: boolean;
  publishResult?: PublishResult;
}

export interface RunPipelineOptions {
  /** 検証用: 「古く話題も伸びていない」ダミー候補を混ぜる(collectAndScoreNewsに委譲) */
  injectDecoy?: boolean;
  /**
   * 選定結果を投稿履歴(既出判定用)に書き込むかどうか。
   * ドライランでは既定でfalseにすることで、繰り返し検証しても履歴を汚さない。
   */
  writeHistory: boolean;
  /** 投稿予定ツイートを実際に送信する(またはしない)関数。本番/ドライランの差し替え点 */
  publish: PublishFn;
  /** テスト用の依存差し替え(省略時は実I/Oを使う) */
  deps?: Partial<PipelineDependencies>;
}

/**
 * 収集→選定→生成→分割→リンク付与→(投稿 or ドライラン)を1本で実行する共通パイプライン。
 * 収集・選定・生成・分割・リンク付与の処理は、本番投稿でもドライランでも完全に同じコードパスを通る。
 * 唯一の差異は最後に呼ばれる `options.publish` が実際にXへ送信するかどうかだけ。
 */
export async function runPostingPipeline(options: RunPipelineOptions): Promise<PipelineResult> {
  const deps = { ...defaultDeps, ...options.deps };

  const { scored } = await deps.collect({ injectDecoy: options.injectDecoy });
  const history = await deps.loadHistory();
  const selection = deps.select(scored, history);

  if (!selection.selected) {
    log.warn("pipeline stopped: no eligible candidate to post", { reason: selection.reason });
    return {
      success: false,
      stage: "select",
      error: selection.reason,
      consideredCount: selection.consideredCount,
      historyWritten: false,
    };
  }

  const generation = await deps.generate(selection.selected);
  if (!generation.success) {
    log.error("pipeline stopped: post text generation failed", { error: generation.error });
    return {
      success: false,
      stage: "generate",
      error: generation.error,
      candidate: selection.selected,
      selectionReason: selection.reason,
      consideredCount: selection.consideredCount,
      historyWritten: false,
    };
  }

  const tweets = deps.buildThread(generation.text, selection.selected.url);

  let historyWritten = false;
  if (options.writeHistory) {
    await deps.appendHistory({
      url: selection.selected.url,
      title: selection.selected.title,
      score: selection.selected.score,
      selectedAt: new Date().toISOString(),
    });
    historyWritten = true;
  } else {
    log.info("not recording selection into post history (writeHistory=false)");
  }

  const publishResult = await options.publish(tweets, selection.selected);

  return {
    success: true,
    stage: "done",
    candidate: selection.selected,
    selectionReason: selection.reason,
    consideredCount: selection.consideredCount,
    text: generation.text,
    tweets,
    historyWritten,
    publishResult,
  };
}
