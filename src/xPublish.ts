/**
 * F6: 生成・分割済みのスレッド(ThreadTweet[])を実際にX API v2へ投稿する。
 *
 * `pipeline.ts` の `PublishFn` と同じシグネチャで実装しており、`dryRunPublish` の代わりに
 * `xApiPublish` (またはテスト用にクライアントを注入した `createXApiPublish(mockClient)`) を渡すだけで
 * ドライランと本番投稿を差し替えられる。
 *
 * - 2件目以降のツイートは直前のツイートIDへの返信として投稿し、1本のスレッドに連結する。
 * - 途中のツイートが投稿に失敗した場合、そこまでの投稿済みID(tweetIds)と失敗箇所(failedAtIndex)を
 *   PublishResultに記録し、以降のツイートは送信しない(不完全なスレッドを無理に続けない)。
 * - レート制限(HTTP 429)は規約の範囲内で限定的にリトライし(既定: 最大2回、待機上限あり)、
 *   上限を超える待機が必要な場合はリトライを諦めてエラーとして記録する(無制限リトライ・連投回避はしない)。
 * - X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET が未設定の場合は、
 *   API呼び出し自体を行わず安全にエラーとして終了する。
 */
import { TwitterApi, ApiResponseError, type SendTweetV2Params } from "twitter-api-v2";
import { log } from "./logger.js";
import type { PublishFn, PublishResult } from "./pipeline.js";
import type { ThreadTweet } from "./threadSplit.js";
import type { NewsCandidate } from "./types.js";
import type { OgpImage } from "./ogpImage.js";

/** postTweet失敗時に投げられるエラー。レート制限判定に必要な情報だけを保持する最小限の形 */
export class XApiError extends Error {
  /** HTTPステータスコード(判別できた場合) */
  status?: number;
  /** レート制限エラーの場合、リセット時刻(UNIX秒)。取得できない場合は未設定 */
  rateLimitResetAt?: number;

  constructor(message: string, opts?: { status?: number; rateLimitResetAt?: number }) {
    super(message);
    this.name = "XApiError";
    this.status = opts?.status;
    this.rateLimitResetAt = opts?.rateLimitResetAt;
  }
}

/**
 * xApiPublish()が依存するXクライアントの最小インターフェース。
 * テストではこの形を満たすモックオブジェクトを注入し、実SDK/実APIを呼ばずに
 * 「正しい順序・返信連結で呼ばれるか」「途中失敗・レート制限時の挙動」を検証する。
 */
export interface XPostClient {
  /**
   * 1件ツイートを投稿する。replyToTweetId指定時はそのツイートへの返信として投稿する(スレッド連結)。
   * mediaIds指定時は、そのツイートにメディア(画像)を添付する。
   */
  postTweet: (text: string, replyToTweetId?: string, mediaIds?: string[]) => Promise<{ id: string }>;
  /**
   * OGP画像をアップロードし、投稿に添付できるmedia_idを返す(F: OGP画像添付)。
   * テスト用モックでは省略可能(未定義の場合、呼び出し側は画像添付をスキップする)。
   */
  uploadMedia?: (image: OgpImage) => Promise<string>;
}

/** 環境変数からX API認証情報を読み込みクライアントを構築する。いずれか未設定ならnullを返す(呼び出し側でエラー扱い) */
export function createXClient(): XPostClient | null {
  const appKey = process.env.X_API_KEY;
  const appSecret = process.env.X_API_SECRET;
  const accessToken = process.env.X_ACCESS_TOKEN;
  const accessSecret = process.env.X_ACCESS_SECRET;

  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    return null;
  }

  const client = new TwitterApi({ appKey, appSecret, accessToken, accessSecret });
  const v2 = client.readWrite.v2;

  return {
    postTweet: async (text, replyToTweetId, mediaIds) => {
      try {
        const options: Partial<SendTweetV2Params> = {};
        if (replyToTweetId) {
          options.reply = { in_reply_to_tweet_id: replyToTweetId };
        }
        if (mediaIds && mediaIds.length > 0) {
          options.media = { media_ids: [mediaIds[0]] };
        }
        const res = await v2.tweet(text, options);
        return { id: res.data.id };
      } catch (err) {
        if (err instanceof ApiResponseError) {
          throw new XApiError(err.message, {
            status: err.code,
            rateLimitResetAt: err.rateLimitError ? err.rateLimit?.reset : undefined,
          });
        }
        throw err;
      }
    },
    uploadMedia: async (image) => {
      return client.v1.uploadMedia(image.buffer, { mimeType: image.contentType });
    },
  };
}

/** レート制限(429)検知時のリトライ方針。規約違反の連投を避けるため、回数・待機時間とも上限を設ける */
export interface RateLimitRetryPolicy {
  /** 429検知時の最大リトライ回数(初回試行は含まない) */
  maxRetries: number;
  /** 1回の待機として許容する最大ミリ秒数。これを超える待機が必要な場合はリトライせず諦める */
  maxWaitMs: number;
}

export const DEFAULT_RATE_LIMIT_RETRY_POLICY: RateLimitRetryPolicy = {
  maxRetries: 2,
  maxWaitMs: 60_000,
};

/** レート制限エラーから、次の試行までに待つべきミリ秒数を見積もる(reset情報が無ければ短い固定バックオフ) */
function estimateWaitMs(err: XApiError, attempt: number): number {
  if (typeof err.rateLimitResetAt === "number") {
    const waitMs = err.rateLimitResetAt * 1000 - Date.now();
    return Math.max(waitMs, 0);
  }
  return 1000 * 2 ** attempt;
}

type SleepFn = (ms: number) => Promise<void>;
const defaultSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 1件のツイートをレート制限に配慮しつつ投稿する。
 * 429以外のエラー、またはリトライ上限・待機上限を超える429は即座にエラーとして投げる(呼び出し側でtry/catch)。
 */
async function postWithRateLimitRetry(
  client: XPostClient,
  text: string,
  replyToTweetId: string | undefined,
  tweetIndex: number,
  policy: RateLimitRetryPolicy,
  sleep: SleepFn,
  mediaIds?: string[]
): Promise<{ id: string }> {
  let attempt = 0;
  for (;;) {
    try {
      return await client.postTweet(text, replyToTweetId, mediaIds);
    } catch (err) {
      const isRateLimit = err instanceof XApiError && err.status === 429;
      if (!isRateLimit) {
        throw err;
      }
      const waitMs = estimateWaitMs(err, attempt);
      if (attempt >= policy.maxRetries || waitMs > policy.maxWaitMs) {
        log.warn("rate limited by X API; giving up without further retry (respecting policy limits)", {
          tweetIndex,
          attempt,
          waitMs,
          maxRetries: policy.maxRetries,
          maxWaitMs: policy.maxWaitMs,
        });
        throw err;
      }
      log.warn("rate limited by X API; retrying after a bounded wait", {
        tweetIndex,
        attempt: attempt + 1,
        waitMs,
      });
      await sleep(waitMs);
      attempt += 1;
    }
  }
}

/**
 * PublishFn(pipeline.tsの差し替え点)を、指定したXクライアント・リトライ方針で組み立てる。
 * 引数省略時は環境変数から構築した実クライアント(未設定ならnull)・既定のリトライ方針を使う。
 * テストではモッククライアントとno-opのsleepを注入して、実ネットワーク・実待機なしで検証する。
 */
export function createXApiPublish(
  client: XPostClient | null = createXClient(),
  retryPolicy: RateLimitRetryPolicy = DEFAULT_RATE_LIMIT_RETRY_POLICY,
  sleep: SleepFn = defaultSleep
): PublishFn {
  return async (tweets: ThreadTweet[], candidate: NewsCandidate, ogpImage?: OgpImage | null): Promise<PublishResult> => {
    if (!client) {
      const error =
        "X API認証情報(X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET)が未設定のため投稿できません";
      log.error(error, { url: candidate.url });
      return { posted: false, detail: error, tweetIds: [], error };
    }

    // OGP画像は、投稿失敗が全体をブロックしないよう、事前に一度だけアップロードしてmedia_idを得ておく。
    // アップロード自体に失敗しても(client.uploadMedia未定義・API呼び出し失敗いずれも)、画像なしで
    // スレッド投稿を継続する(ブロッキングしない)。
    let mediaId: string | undefined;
    if (ogpImage) {
      if (!client.uploadMedia) {
        log.warn("x client does not support media upload; posting thread without image attachment", {
          url: candidate.url,
        });
      } else {
        try {
          mediaId = await client.uploadMedia(ogpImage);
          log.info("uploaded ogp image to X", { url: candidate.url, imageUrl: ogpImage.url });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          log.warn("failed to upload ogp image to X; posting thread without image attachment", {
            url: candidate.url,
            imageUrl: ogpImage.url,
            message,
          });
        }
      }
    }

    // 添付先は「スレッド1件目の本文ツイート」(kind:"body")。リンクツイートが先頭に来る設定
    // (POST_LINK_TWEET_POSITION=start)の場合でも、末尾のリンクツイートには添付しない。
    const firstBodyTweet = tweets.find((t) => t.kind === "body");

    const postedIds: string[] = [];
    let previousTweetId: string | undefined;

    for (const tweet of tweets) {
      const replyToTweetId = previousTweetId;
      const mediaIds = mediaId && tweet === firstBodyTweet ? [mediaId] : undefined;
      try {
        const posted = await postWithRateLimitRetry(
          client,
          tweet.text,
          replyToTweetId,
          tweet.index,
          retryPolicy,
          sleep,
          mediaIds
        );
        postedIds.push(posted.id);
        previousTweetId = posted.id;
        log.info("posted tweet to X", {
          index: tweet.index,
          total: tweets.length,
          tweetId: posted.id,
          replyTo: replyToTweetId,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("failed to post tweet to X; stopping thread here", {
          failedAtIndex: tweet.index,
          total: tweets.length,
          postedSoFar: postedIds.length,
          postedTweetIds: postedIds,
          url: candidate.url,
          message,
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
    log.info("posted full thread to X", { tweetCount: postedIds.length, tweetIds: postedIds, url: candidate.url });
    return {
      posted: true,
      detail: `${postedIds.length}件のツイートをスレッドとして投稿しました`,
      tweetIds: postedIds,
      postedAt,
    };
  };
}

/** 既定の環境変数・リトライ方針を使う本番投稿用のPublishFn */
export const xApiPublish: PublishFn = createXApiPublish();
