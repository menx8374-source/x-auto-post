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
import { assertValidConfig, getMaxBodyTweets, getLinkTweetConfig } from "./config.js";
import {
  loadHistory,
  appendHistoryEntry,
  updateHistoryEntry,
  hasPostedSlotOnDate,
  isWithinRecoveryWindow,
  getConfiguredRecoveryWindowHours,
  type PostHistoryUpdate,
} from "./postHistory.js";
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
  appendHistory: (entry: Omit<PostHistoryEntry, "normalizedUrl" | "id">) => Promise<PostHistoryEntry>;
  /** F9: 投稿完了後、選定時に書き込んだ履歴エントリへ実際の投稿結果を反映する */
  updateHistory: (id: string, updates: PostHistoryUpdate) => Promise<PostHistoryEntry | null>;
}

/**
 * F12: 呼び出しのたびに設定(最大ツイート本数・リンクツイート有無/位置)を読み直してから
 * composeThreadへ渡す。`.env`側の変更を実行のたびに反映するため、モジュール読み込み時点の
 * 値をキャプチャして固定しない。
 */
export function buildThreadWithConfig(text: string, url: string): ThreadTweet[] {
  const linkTweetConfig = getLinkTweetConfig();
  return composeThread(text, url, {
    maxBodyTweets: getMaxBodyTweets(),
    includeLinkTweet: linkTweetConfig.enabled,
    linkPosition: linkTweetConfig.position,
  });
}

const defaultDeps: PipelineDependencies = {
  collect: (opts) => collectAndScoreNews(opts),
  loadHistory: () => loadHistory(),
  select: (candidates, history) => selectNextPost(candidates, history),
  generate: (candidate) => generatePostText(candidate),
  buildThread: buildThreadWithConfig,
  appendHistory: (entry) => appendHistoryEntry(entry),
  updateHistory: (id, updates) => updateHistoryEntry(id, updates),
};

export type PipelineStage = "select" | "generate" | "thread" | "publish" | "skipped" | "done";

export interface PipelineResult {
  success: boolean;
  /** パイプラインが最後に到達した/停止した段階 */
  stage: PipelineStage;
  /** success:falseの場合の理由(ログ・出力用) */
  error?: string;
  /** stage:"skipped"の場合の理由の種別(F9: 冪等性/不発リカバリの許容範囲外) */
  skipReason?: "already-posted" | "outside-recovery-window";
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
  /**
   * F7/F9: 投稿枠識別子(通常はsrc/postSchedule.tsのPOST_SLOTS[].id="morning"|"noon"|"evening"だが、
   * このパイプライン自体は任意の文字列として受け取る)。
   * 指定すると、同一枠・同一日の二重投稿防止(冪等性)チェックが有効になる。
   */
  slot?: string;
  /**
   * F9: slot指定時、その枠の本来の予定時刻(ISO8601)。指定すると、不発リカバリの許容範囲チェックが
   * 有効になる(範囲外ならstage:"skipped"で停止する)。省略時はこのチェックをスキップする。
   * CLIから`--auto-slot`で自動判定した場合はsrc/postSchedule.tsのresolveCurrentSlot()が返す値が渡る。
   */
  scheduledAt?: string;
  /** F9: 不発リカバリの許容範囲(時間)。省略時はpostHistory.DEFAULT_RECOVERY_WINDOW_HOURS(環境変数上書き可)を使う */
  recoveryWindowHours?: number;
  /**
   * テスト用: 「現在時刻」を注入する。省略時は`new Date()`(実際の壁時計時刻)を使う。
   * F9の不発リカバリ判定(isWithinRecoveryWindow)はこの時刻を基準にするため、テストでこれを
   * 固定すれば実行タイミングに依存しない決定論的なテストが書ける(Sprint 10で
   * test/pipeline.test.tsのflakyだったF9回帰テストをこの注入口を使って修正した)。
   */
  now?: Date;
}

/**
 * 収集→選定→生成→分割→リンク付与→(投稿 or ドライラン)を1本で実行する共通パイプライン。
 * 収集・選定・生成・分割・リンク付与の処理は、本番投稿でもドライランでも完全に同じコードパスを通る。
 * 唯一の差異は最後に呼ばれる `options.publish` が実際にXへ送信するかどうかだけ。
 */
export async function runPostingPipeline(options: RunPipelineOptions): Promise<PipelineResult> {
  // F12: 挙動系設定の不正値(未設定の必須項目・不正な時刻形式など)を実行の最初に検知する。
  // 壊れた設定のまま収集・生成・投稿処理へ進めない(呼び出し側のCLIエントリポイントは
  // 未catchの例外としてこれを受け取り、わかりやすいエラーとしてログに残しexitCode=1で終了する)。
  assertValidConfig();

  const deps = { ...defaultDeps, ...options.deps };

  // F10: 各実行の開始をログに残す(実行ログ)。
  log.info("posting pipeline started", {
    slot: options.slot,
    scheduledAt: options.scheduledAt,
    writeHistory: options.writeHistory,
    injectDecoy: options.injectDecoy,
  });

  // F9: slot指定時は、収集(外部API呼び出し)より前に冪等性・不発リカバリの許容範囲をチェックし、
  // 不要な収集・生成・API呼び出しを避ける。
  const history = await deps.loadHistory();

  if (options.slot) {
    const now = options.now ?? new Date();
    // F9: 冪等性判定(hasPostedSlotOnDate)は「実行時点の暦日」ではなく、resolveCurrentSlotが
    // 解決した「その枠の予定時刻(scheduledAt)」の暦日を基準にする。深夜跨ぎのルックバック
    // (例: JST 00:30に実行され、前日21:00の夜枠として解決された場合)で素の現在時刻を使うと、
    // 前日分の投稿履歴が見つからず冪等性チェックをすり抜けて二重投稿してしまうため
    // (実害確認済み、Sprint 8で修正)。scheduledAt未指定時は従来通りnowにフォールバックする。
    const referenceDate = options.scheduledAt ? new Date(options.scheduledAt) : now;

    if (hasPostedSlotOnDate(history, options.slot, referenceDate)) {
      const reason = `本日「${options.slot}」枠は既に投稿済みのためスキップします(1枠1投稿の冪等性)`;
      log.warn("pipeline stopped: slot already posted today (idempotency)", { slot: options.slot });
      return { success: false, stage: "skipped", skipReason: "already-posted", error: reason, historyWritten: false };
    }

    if (options.scheduledAt) {
      const scheduled = new Date(options.scheduledAt);
      const toleranceHours = options.recoveryWindowHours ?? getConfiguredRecoveryWindowHours();
      if (!isWithinRecoveryWindow(scheduled, now, toleranceHours)) {
        const reason = `「${options.slot}」枠の予定時刻(${options.scheduledAt})から許容範囲(${toleranceHours}時間)を超えているため、不発リカバリとしての投稿は行いません`;
        log.warn("pipeline stopped: outside recovery window for missed slot trigger", {
          slot: options.slot,
          scheduledAt: options.scheduledAt,
          toleranceHours,
        });
        return {
          success: false,
          stage: "skipped",
          skipReason: "outside-recovery-window",
          error: reason,
          historyWritten: false,
        };
      }
    }
  }

  const { scored } = await deps.collect({ injectDecoy: options.injectDecoy });
  // F10: 実行ログに候補件数を残す。
  log.info("candidates collected for this run", { candidateCount: scored.length });

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

  // F10: 実行ログに選定記事を残す。
  log.info("selected candidate for posting", {
    title: selection.selected.title,
    url: selection.selected.url,
    score: selection.selected.score,
    reason: selection.reason,
    consideredCount: selection.consideredCount,
  });

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
  let historyEntryId: string | undefined;
  if (options.writeHistory) {
    const entry = await deps.appendHistory({
      url: selection.selected.url,
      title: selection.selected.title,
      score: selection.selected.score,
      selectedAt: new Date().toISOString(),
      slot: options.slot,
    });
    historyWritten = true;
    historyEntryId = entry.id;
  } else {
    log.info("not recording selection into post history (writeHistory=false)");
  }

  const publishResult = await options.publish(tweets, selection.selected);

  // F10: 実行ログに投稿結果(成功/失敗/未送信)を残す。1回の実行につき必ず1行、結論だけが分かる形で出す。
  if (publishResult.posted) {
    log.info("pipeline finished: posted successfully", {
      url: selection.selected.url,
      tweetIds: publishResult.tweetIds,
      postedAt: publishResult.postedAt,
    });
  } else if (publishResult.error) {
    log.error("pipeline finished: posting failed", {
      url: selection.selected.url,
      error: publishResult.error,
      detail: publishResult.detail,
    });
  } else {
    log.info("pipeline finished: not posted (dry run)", {
      url: selection.selected.url,
      detail: publishResult.detail,
    });
  }

  // F9: 実際にXへ投稿が完了した(または明確に失敗した)場合のみ、選定時に書き込んだ履歴エントリへ
  // 投稿結果(投稿日時・ツイートID・状態)を反映する。ドライラン(意図的に未送信、error未設定)では
  // 反映せず、"selected"のままにしておく。
  if (historyWritten && historyEntryId) {
    if (publishResult.posted) {
      await deps.updateHistory(historyEntryId, {
        status: "posted",
        postedAt: publishResult.postedAt ?? new Date().toISOString(),
        tweetIds: publishResult.tweetIds ?? [],
        slot: options.slot,
      });
    } else if (publishResult.error) {
      await deps.updateHistory(historyEntryId, {
        status: "failed",
        slot: options.slot,
      });
    }
  }

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
