import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createXApiPublish,
  XApiError,
  type XPostClient,
  type RateLimitRetryPolicy,
} from "../src/xPublish.js";
import type { ThreadTweet } from "../src/threadSplit.js";
import type { NewsCandidate } from "../src/types.js";

const candidate: NewsCandidate = {
  title: "OpenAI releases GPT-6",
  url: "https://example.com/gpt6",
  source: "Hacker News",
  publishedAt: "2026-07-16T00:00:00.000Z",
  score: 80,
};

function tweets(count: number): ThreadTweet[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    text: `本文${i + 1}`,
    charLength: 3,
    kind: i === count - 1 ? "link" : "body",
  }));
}

const noopSleep = async () => {};

test("認証情報未設定(client:null)の場合、API呼び出しをせず安全にエラーを返す", async () => {
  const publish = createXApiPublish(null);
  const result = await publish(tweets(2), candidate);

  assert.equal(result.posted, false);
  assert.equal(result.tweetIds?.length, 0);
  assert.match(result.error ?? "", /X_API_KEY|X_API_SECRET|X_ACCESS_TOKEN|X_ACCESS_SECRET/);
});

test("単一ツイート投稿: 1件のみのスレッドでも正しく投稿される", async () => {
  const calls: { text: string; replyTo?: string }[] = [];
  const mockClient: XPostClient = {
    postTweet: async (text, replyToTweetId) => {
      calls.push({ text, replyTo: replyToTweetId });
      return { id: `tweet-${calls.length}` };
    },
  };
  const publish = createXApiPublish(mockClient);

  const result = await publish(tweets(1), candidate);

  assert.equal(result.posted, true);
  assert.deepEqual(result.tweetIds, ["tweet-1"]);
  assert.ok(result.postedAt);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].replyTo, undefined);
});

test("スレッド投稿: 2件目以降が直前のツイートIDへの返信として連結される呼び出しになる", async () => {
  const calls: { text: string; replyTo?: string }[] = [];
  const mockClient: XPostClient = {
    postTweet: async (text, replyToTweetId) => {
      calls.push({ text, replyTo: replyToTweetId });
      return { id: `tweet-${calls.length}` };
    },
  };
  const publish = createXApiPublish(mockClient);

  const result = await publish(tweets(3), candidate);

  assert.equal(result.posted, true);
  assert.deepEqual(result.tweetIds, ["tweet-1", "tweet-2", "tweet-3"]);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].replyTo, undefined, "1件目は返信なし");
  assert.equal(calls[1].replyTo, "tweet-1", "2件目は1件目への返信");
  assert.equal(calls[2].replyTo, "tweet-2", "3件目は2件目への返信");
});

test("途中失敗: 2件目投稿が失敗した場合、1件目のIDは記録され、失敗箇所(failedAtIndex)も記録され、3件目は送信されない", async () => {
  const calls: string[] = [];
  const mockClient: XPostClient = {
    postTweet: async (text) => {
      calls.push(text);
      if (calls.length === 2) {
        throw new Error("simulated network failure");
      }
      return { id: `tweet-${calls.length}` };
    },
  };
  const publish = createXApiPublish(mockClient);

  const result = await publish(tweets(3), candidate);

  assert.equal(result.posted, false);
  assert.deepEqual(result.tweetIds, ["tweet-1"]);
  assert.equal(result.failedAtIndex, 2);
  assert.match(result.error ?? "", /simulated network failure/);
  assert.equal(calls.length, 2, "3件目は送信されないはず");
});

test("レート制限(429)検知時: reset時刻までの待機がmaxWaitMs以内ならリトライして成功する", async () => {
  let attempts = 0;
  const resetAt = Math.floor(Date.now() / 1000) + 1; // 1秒後にリセット
  const mockClient: XPostClient = {
    postTweet: async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new XApiError("rate limited", { status: 429, rateLimitResetAt: resetAt });
      }
      return { id: "tweet-1" };
    },
  };
  const policy: RateLimitRetryPolicy = { maxRetries: 2, maxWaitMs: 60_000 };
  const sleepCalls: number[] = [];
  const publish = createXApiPublish(mockClient, policy, async (ms) => {
    sleepCalls.push(ms);
  });

  const result = await publish(tweets(1), candidate);

  assert.equal(result.posted, true);
  assert.equal(attempts, 2, "429の後にリトライして成功するはず");
  assert.equal(sleepCalls.length, 1, "1回だけ待機したはず");
});

test("レート制限(429)検知時: リトライ上限を超える場合は諦めて理由を記録する(無制限リトライしない)", async () => {
  let attempts = 0;
  const mockClient: XPostClient = {
    postTweet: async () => {
      attempts += 1;
      throw new XApiError("rate limited forever", { status: 429, rateLimitResetAt: Math.floor(Date.now() / 1000) + 1 });
    },
  };
  const policy: RateLimitRetryPolicy = { maxRetries: 2, maxWaitMs: 60_000 };
  const publish = createXApiPublish(mockClient, policy, noopSleep);

  const result = await publish(tweets(1), candidate);

  assert.equal(result.posted, false);
  assert.equal(attempts, policy.maxRetries + 1, "初回+maxRetries回で打ち切るはず");
  assert.match(result.error ?? "", /rate limited forever/);
});

test("レート制限(429)検知時: 待機時間がmaxWaitMsを超える場合は即座に諦める(規約違反の連投をしない)", async () => {
  let attempts = 0;
  const farFutureReset = Math.floor(Date.now() / 1000) + 3600; // 1時間後
  const mockClient: XPostClient = {
    postTweet: async () => {
      attempts += 1;
      throw new XApiError("rate limited long", { status: 429, rateLimitResetAt: farFutureReset });
    },
  };
  const policy: RateLimitRetryPolicy = { maxRetries: 5, maxWaitMs: 5_000 }; // 待機上限5秒 << 1時間
  const publish = createXApiPublish(mockClient, policy, noopSleep);

  const result = await publish(tweets(1), candidate);

  assert.equal(result.posted, false);
  assert.equal(attempts, 1, "待機上限を超えるため即座に諦め、リトライしないはず");
});
