/**
 * アフィリエイト投稿のスレッド(ThreadTweet[])を実際にX API v2へ投稿する。
 *
 * X認証・レート制限リトライ・スレッド連結のロジックは既存のsrc/xPublish.tsの実装
 * (createXClient/postWithRateLimitRetry/DEFAULT_RATE_LIMIT_RETRY_POLICY)をそのまま再利用し、
 * このファイルはアフィリエイト投稿の型(AffiliatePublishFn)への薄い適合層のみを持つ
 * (OGP画像添付はアフィリエイト投稿では行わないため、その分だけ既存のxApiPublishより単純)。
 */
import { log } from "./logger.js";
import type { ThreadTweet } from "./threadSplit.js";
import type { PublishResult } from "./pipeline.js";
import type { AffiliateProduct } from "./affiliateProducts.js";
import type { AffiliatePublishFn } from "./affiliatePipeline.js";
import {
  createXClient,
  postWithRateLimitRetry,
  DEFAULT_RATE_LIMIT_RETRY_POLICY,
  XApiError,
  type RateLimitRetryPolicy,
  type XPostClient,
} from "./xPublish.js";
import { getAccountProfile, type AccountProfile } from "./accounts.js";

type SleepFn = (ms: number) => Promise<void>;
const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * AffiliatePublishFn(src/affiliatePipeline.tsの差し替え点)を、指定したXクライアント・リトライ方針で
 * 組み立てる。引数省略時は環境変数から構築した実クライアント(未設定ならnull)・既定のリトライ方針を使う。
 * テストではモッククライアントとno-opのsleepを注入して、実ネットワーク・実待機なしで検証する。
 */
export function createXApiPublishForAffiliate(
  client: XPostClient | null = createXClient(),
  retryPolicy: RateLimitRetryPolicy = DEFAULT_RATE_LIMIT_RETRY_POLICY,
  sleep: SleepFn = defaultSleep
): AffiliatePublishFn {
  return async (tweets: ThreadTweet[], product: AffiliateProduct): Promise<PublishResult> => {
    if (!client) {
      const error =
        "X API認証情報(X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET)が未設定のため投稿できません";
      log.error(error, { productId: product.id });
      return { posted: false, detail: error, tweetIds: [], error };
    }

    const postedIds: string[] = [];
    let previousTweetId: string | undefined;

    for (const tweet of tweets) {
      const replyToTweetId = previousTweetId;
      try {
        const posted = await postWithRateLimitRetry(
          client,
          tweet.text,
          replyToTweetId,
          tweet.index,
          retryPolicy,
          sleep
        );
        postedIds.push(posted.id);
        previousTweetId = posted.id;
        log.info("posted affiliate tweet to X", {
          index: tweet.index,
          total: tweets.length,
          tweetId: posted.id,
          replyTo: replyToTweetId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const apiErrorDetail = err instanceof XApiError ? err.apiErrorDetail : undefined;
        log.error("failed to post affiliate tweet to X; stopping thread here", {
          failedAtIndex: tweet.index,
          total: tweets.length,
          postedSoFar: postedIds.length,
          postedTweetIds: postedIds,
          productId: product.id,
          message,
          apiErrorDetail,
        });
        return {
          posted: false,
          detail: `${tweet.index}/${tweets.length}件目のツイート投稿に失敗しました(${postedIds.length}件は投稿済み): ${message}`,
          tweetIds: postedIds,
          failedAtIndex: tweet.index,
          error: message,
        };
      }
    }

    const postedAt = new Date().toISOString();
    log.info("posted full affiliate thread to X", {
      tweetCount: postedIds.length,
      tweetIds: postedIds,
      productId: product.id,
    });
    return {
      posted: true,
      detail: `${postedIds.length}件のツイートをスレッドとして投稿しました`,
      tweetIds: postedIds,
      postedAt,
    };
  };
}

/**
 * 指定したアカウントの認証情報でクライアントを構築し、本番投稿用のAffiliatePublishFnを組み立てる。
 * account省略時はデフォルトアカウント(既存のAIニュースアカウントと同じXアカウント)。
 */
export function createXApiPublishForAffiliateAccount(
  account: AccountProfile = getAccountProfile(),
  retryPolicy: RateLimitRetryPolicy = DEFAULT_RATE_LIMIT_RETRY_POLICY,
  sleep: SleepFn = defaultSleep
): AffiliatePublishFn {
  return createXApiPublishForAffiliate(createXClient(account), retryPolicy, sleep);
}
