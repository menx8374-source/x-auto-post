/**
 * アフィリエイト投稿の共通パイプライン: 商品選定→紹介文生成→分割→リンク付与→(投稿 or ドライラン)。
 *
 * 設計はAIニュースの共通パイプライン(src/pipeline.ts)を踏襲しつつ、完全に独立したモジュールとして
 * 実装する(既存のrunPostingPipelineは一切変更しない)。差し替え点(publish関数)の考え方も同じ:
 * - ドライラン: `dryRunAffiliatePublish`(送信せずログに残すだけ)
 * - 本番投稿: `createXApiPublishForAffiliateAccount`(src/affiliateXPublish.ts)
 */
import { log } from "./logger.js";
import { loadAffiliateProducts, type AffiliateProduct } from "./affiliateProducts.js";
import { selectAffiliateProduct, type AffiliateSelectionResult } from "./selectAffiliateProduct.js";
import { generateAffiliatePostText, type AffiliatePostGenerationResult } from "./generateAffiliatePost.js";
import { composeAffiliateThread } from "./affiliateThread.js";
import { assertValidConfig } from "./config.js";
import { fetchOgpImageForArticle, type OgpImage } from "./ogpImage.js";
import { getAccountProfile, type AccountProfile } from "./accounts.js";
import {
  loadAffiliateHistory,
  appendAffiliateHistoryEntry,
  updateAffiliateHistoryEntry,
  hasPostedAffiliateSlotOnDate,
  type AffiliatePostHistoryEntry,
  type AffiliateHistoryUpdate,
} from "./affiliateHistory.js";
import { isWithinRecoveryWindow, getConfiguredRecoveryWindowHours } from "./postHistory.js";
import type { ThreadTweet } from "./threadSplit.js";
import type { PublishResult } from "./pipeline.js";

/**
 * 投稿予定ツイート配列を実際に送信する(または送信しない)役目を持つ関数。本番/ドライランの唯一の差し替え点。
 * `ogpImage`(取得できた場合のみ)はスレッド1件目の本文ツイートに添付するために渡す。取得できなかった
 * 場合は`null`が渡り、実装側は画像なしで投稿処理を継続する(ブロッキングしない)。
 */
export type AffiliatePublishFn = (
  tweets: ThreadTweet[],
  product: AffiliateProduct,
  ogpImage?: OgpImage | null
) => Promise<PublishResult>;

/** ドライラン用のpublish実装: 何も送信せず、送信しなかった旨だけを返す */
export const dryRunAffiliatePublish: AffiliatePublishFn = async (tweets, product, ogpImage) => {
  log.info("dry run: not sending affiliate tweets to X", {
    tweetCount: tweets.length,
    productId: product.id,
    ogpImageUrl: ogpImage?.url,
  });
  return { posted: false, detail: "ドライランのためXへは送信していません" };
};

/**
 * パイプライン各段が使う外部依存。デフォルトは実I/O(実ファイル・実API)だが、
 * テストではこの一部/全部をモックに差し替えて、外部APIなしで検証できる。
 */
export interface AffiliatePipelineDependencies {
  loadProducts: () => Promise<AffiliateProduct[]>;
  loadHistory: () => Promise<AffiliatePostHistoryEntry[]>;
  select: (
    products: AffiliateProduct[],
    history: AffiliatePostHistoryEntry[]
  ) => AffiliateSelectionResult | Promise<AffiliateSelectionResult>;
  generate: (product: AffiliateProduct) => Promise<AffiliatePostGenerationResult>;
  /**
   * 本文と商品IDから投稿予定のツイート配列(本文+リンク)を組み立てる。リンクツイートには
   * `src/generateAffiliateRedirects.ts`が事前生成したGitHub Pages上の自前リダイレクトページ
   * (productIdから機械的に組み立てられる固定URL)を使うため、実行時のネットワーク呼び出しは不要。
   */
  buildThread: (text: string, productId: string) => ThreadTweet[];
  /**
   * 選定商品の公式サイトURL(officialUrl)からOGP画像を取得する。取得できない場合はnullを返す(例外を投げない)。
   * アフィリエイト側は商品リストが少数精鋭のため、選定条件には含めず(選定は既存のselectAffiliateProduct
   * のまま)、選定後にベストエフォートで取得する。
   */
  fetchOgpImage: (url: string) => Promise<OgpImage | null>;
  appendHistory: (entry: Omit<AffiliatePostHistoryEntry, "id">) => Promise<AffiliatePostHistoryEntry>;
  updateHistory: (id: string, updates: AffiliateHistoryUpdate) => Promise<AffiliatePostHistoryEntry | null>;
}

function buildDefaultDeps(account: AccountProfile): AffiliatePipelineDependencies {
  return {
    loadProducts: () => loadAffiliateProducts(),
    loadHistory: () => loadAffiliateHistory(),
    select: (products, history) => selectAffiliateProduct(products, history),
    generate: (product) => generateAffiliatePostText(product, undefined, account),
    buildThread: (text, productId) => composeAffiliateThread(text, productId),
    fetchOgpImage: (url) => fetchOgpImageForArticle(url),
    appendHistory: (entry) => appendAffiliateHistoryEntry(entry),
    updateHistory: (id, updates) => updateAffiliateHistoryEntry(id, updates),
  };
}

export type AffiliatePipelineStage = "select" | "generate" | "thread" | "publish" | "skipped" | "done";

export interface AffiliatePipelineResult {
  success: boolean;
  /** パイプラインが最後に到達した/停止した段階 */
  stage: AffiliatePipelineStage;
  /** success:falseの場合の理由(ログ・出力用) */
  error?: string;
  /** stage:"skipped"の場合の理由の種別 */
  skipReason?: "already-posted" | "outside-recovery-window" | "no-eligible-product";
  product?: AffiliateProduct;
  selectionReason?: string;
  text?: string;
  tweets?: ThreadTweet[];
  /** 取得できたOGP画像のURL(プレビュー・ログ用途。画像本体は結果に含めない)。取得できなかった場合は未設定 */
  ogpImageUrl?: string;
  /** 投稿履歴(ローテーション・冪等性判定用)に書き込んだかどうか */
  historyWritten: boolean;
  publishResult?: PublishResult;
  /** 実際に使用したアカウントID(省略指定時に解決されたデフォルトアカウントも含む) */
  accountId: string;
}

export interface RunAffiliatePipelineOptions {
  /**
   * 選定結果を投稿履歴(ローテーション・冪等性判定用)に書き込むかどうか。
   * ドライランでは既定でfalseにすることで、繰り返し検証しても履歴を汚さない。
   */
  writeHistory: boolean;
  /** 投稿予定ツイートを実際に送信する(またはしない)関数。本番/ドライランの差し替え点 */
  publish: AffiliatePublishFn;
  /** テスト用の依存差し替え(省略時は実I/Oを使う) */
  deps?: Partial<AffiliatePipelineDependencies>;
  /**
   * 投稿枠識別子(通常はsrc/config.tsのAFFILIATE_SLOT_ID="affiliate")。
   * 指定すると、同一枠・同一日の二重投稿防止(冪等性)チェックが有効になる。
   */
  slot?: string;
  /**
   * slot指定時、その枠の本来の予定時刻(ISO8601)。指定すると、不発リカバリの許容範囲チェックが
   * 有効になる(範囲外ならstage:"skipped"で停止する)。省略時はこのチェックをスキップする。
   */
  scheduledAt?: string;
  /** 不発リカバリの許容範囲(時間)。省略時はpostHistory.DEFAULT_RECOVERY_WINDOW_HOURS(環境変数上書き可)を使う */
  recoveryWindowHours?: number;
  /** 使用するアカウントのid(src/accounts.tsに登録済みのもの)。省略時はデフォルトアカウント */
  accountId?: string;
  /** テスト用: 「現在時刻」を注入する。省略時は`new Date()`(実際の壁時計時刻)を使う */
  now?: Date;
}

/**
 * 商品選定→紹介文生成→分割→リンク付与→(投稿 or ドライラン)を1本で実行する共通パイプライン。
 * AIニュースの共通パイプライン(src/pipeline.ts)とは完全に独立しており、投稿履歴ファイルも別のため、
 * 互いの冪等性判定・ローテーション状態に影響しない。
 */
export async function runAffiliatePostingPipeline(
  options: RunAffiliatePipelineOptions
): Promise<AffiliatePipelineResult> {
  const account = getAccountProfile(options.accountId);

  // 挙動系設定(AIニュース分も含む)の不正値を実行の最初に検知する(壊れた設定のまま進めない)。
  assertValidConfig();

  const deps = { ...buildDefaultDeps(account), ...options.deps };

  log.info("affiliate posting pipeline started", {
    accountId: account.id,
    slot: options.slot,
    scheduledAt: options.scheduledAt,
    writeHistory: options.writeHistory,
  });

  const history = await deps.loadHistory();

  if (options.slot) {
    const now = options.now ?? new Date();
    // AIニュース側と同じ理由(深夜跨ぎのルックバック時のJST暦日ずれ)で、referenceDateは
    // scheduledAt(枠の予定時刻)を優先する。scheduledAt未指定時はnowにフォールバックする。
    const referenceDate = options.scheduledAt ? new Date(options.scheduledAt) : now;

    if (hasPostedAffiliateSlotOnDate(history, options.slot, referenceDate)) {
      const reason = `本日「${options.slot}」枠は既に投稿済みのためスキップします(1日1投稿の冪等性)`;
      log.warn("affiliate pipeline stopped: slot already posted today (idempotency)", { slot: options.slot });
      return {
        success: false,
        stage: "skipped",
        skipReason: "already-posted",
        error: reason,
        historyWritten: false,
        accountId: account.id,
      };
    }

    if (options.scheduledAt) {
      const scheduled = new Date(options.scheduledAt);
      const toleranceHours = options.recoveryWindowHours ?? getConfiguredRecoveryWindowHours();
      if (!isWithinRecoveryWindow(scheduled, now, toleranceHours)) {
        const reason = `「${options.slot}」枠の予定時刻(${options.scheduledAt})から許容範囲(${toleranceHours}時間)を超えているため、不発リカバリとしての投稿は行いません`;
        log.warn("affiliate pipeline stopped: outside recovery window for missed slot trigger", {
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
          accountId: account.id,
        };
      }
    }
  }

  const products = await deps.loadProducts();
  const selection = await deps.select(products, history);

  if (!selection.selected) {
    log.warn("affiliate pipeline stopped: no eligible product to post", { reason: selection.reason });
    return {
      success: false,
      stage: "select",
      skipReason: "no-eligible-product",
      error: selection.reason,
      historyWritten: false,
      accountId: account.id,
    };
  }

  log.info("selected affiliate product for posting", {
    productId: selection.selected.id,
    name: selection.selected.name,
    reason: selection.reason,
  });

  const generation = await deps.generate(selection.selected);
  if (!generation.success) {
    log.error("affiliate pipeline stopped: post text generation failed", { error: generation.error });
    return {
      success: false,
      stage: "generate",
      error: generation.error,
      product: selection.selected,
      selectionReason: selection.reason,
      historyWritten: false,
      accountId: account.id,
    };
  }

  const tweets = deps.buildThread(generation.text, selection.selected.id);

  // 商品の公式サイトURL(officialUrl)からOGP画像を取得する(ベストエフォート、失敗しても投稿処理を
  // ブロックしない)。deps.fetchOgpImageは自身の内部で失敗をnullとして返す設計だが、想定外の例外が
  // 飛んできた場合の安全網としてここでもcatchしておく。
  let ogpImage: OgpImage | null = null;
  try {
    ogpImage = await deps.fetchOgpImage(selection.selected.officialUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn("unexpected error while fetching ogp image for affiliate product; continuing without image", {
      officialUrl: selection.selected.officialUrl,
      message,
    });
    ogpImage = null;
  }
  log.info(
    ogpImage
      ? "ogp image available for this affiliate post"
      : "no ogp image available for this affiliate post; continuing without image",
    { officialUrl: selection.selected.officialUrl, imageUrl: ogpImage?.url }
  );

  let historyWritten = false;
  let historyEntryId: string | undefined;
  if (options.writeHistory) {
    const entry = await deps.appendHistory({
      productId: selection.selected.id,
      productName: selection.selected.name,
      selectedAt: new Date().toISOString(),
      slot: options.slot,
    });
    historyWritten = true;
    historyEntryId = entry.id;
  } else {
    log.info("not recording selection into affiliate post history (writeHistory=false)");
  }

  const publishResult = await options.publish(tweets, selection.selected, ogpImage);

  if (publishResult.posted) {
    log.info("affiliate pipeline finished: posted successfully", {
      productId: selection.selected.id,
      tweetIds: publishResult.tweetIds,
      postedAt: publishResult.postedAt,
    });
  } else if (publishResult.error) {
    log.error("affiliate pipeline finished: posting failed", {
      productId: selection.selected.id,
      error: publishResult.error,
      detail: publishResult.detail,
    });
  } else {
    log.info("affiliate pipeline finished: not posted (dry run)", {
      productId: selection.selected.id,
      detail: publishResult.detail,
    });
  }

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
    product: selection.selected,
    selectionReason: selection.reason,
    text: generation.text,
    tweets,
    ogpImageUrl: ogpImage?.url,
    historyWritten,
    publishResult,
    accountId: account.id,
  };
}
