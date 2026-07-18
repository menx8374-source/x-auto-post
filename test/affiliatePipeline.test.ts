import { test } from "node:test";
import assert from "node:assert/strict";
import {
  runAffiliatePostingPipeline,
  dryRunAffiliatePublish,
  type AffiliatePipelineDependencies,
  type AffiliatePublishFn,
} from "../src/affiliatePipeline.js";
import type { AffiliateProduct } from "../src/affiliateProducts.js";
import type { AffiliatePostHistoryEntry } from "../src/affiliateHistory.js";
import type { ThreadTweet } from "../src/threadSplit.js";

function product(overrides: Partial<AffiliateProduct> & { id: string }): AffiliateProduct {
  return {
    name: `商品${overrides.id}`,
    officialUrl: `https://example.com/${overrides.id}`,
    affiliateUrl: `https://affiliate.example.com/${overrides.id}`,
    facts: ["特長1"],
    enabled: true,
    ...overrides,
  };
}

function buildMockDeps(overrides: Partial<AffiliatePipelineDependencies> = {}): {
  deps: Partial<AffiliatePipelineDependencies>;
  appendHistoryCalls: unknown[];
} {
  const p = product({ id: "p1" });
  const appendHistoryCalls: unknown[] = [];

  const deps: Partial<AffiliatePipelineDependencies> = {
    loadProducts: async () => [p],
    loadHistory: async () => [],
    select: () => ({ selected: p, reason: "テスト用選定", consideredCount: 1, enabledCount: 1 }),
    generate: async () => ({ success: true, text: "【PR】生成されたテスト用の紹介文です。", product: p }),
    buildThread: (text, url) => [
      { index: 1, text, charLength: text.length, kind: "body" },
      { index: 2, text: `商品ページ: ${url}`, charLength: `商品ページ: ${url}`.length, kind: "link" },
    ],
    appendHistory: async (entry) => {
      appendHistoryCalls.push(entry);
      return { ...entry, id: "history-id-1" };
    },
    updateHistory: async () => null,
    ...overrides,
  };

  return { deps, appendHistoryCalls };
}

test("ドライラン: 選定→生成→分割→リンク付与が通り、投稿予定の全ツイートが得られる", async () => {
  const { deps } = buildMockDeps();
  const result = await runAffiliatePostingPipeline({ writeHistory: false, publish: dryRunAffiliatePublish, deps });

  assert.equal(result.success, true);
  assert.equal(result.stage, "done");
  assert.equal(result.product?.id, "p1");
  assert.equal(result.tweets?.length, 2);
  assert.equal(result.historyWritten, false);
});

test("商品リストが空の場合、投稿対象なしとして安全にスキップされる(エラーにならない)", async () => {
  const { deps } = buildMockDeps({
    loadProducts: async () => [],
    select: (products) => ({
      selected: null,
      reason: "商品リストが空のため投稿対象なし",
      consideredCount: products.length,
      enabledCount: 0,
    }),
  });

  const result = await runAffiliatePostingPipeline({ writeHistory: false, publish: dryRunAffiliatePublish, deps });

  assert.equal(result.success, false);
  assert.equal(result.stage, "select");
  assert.equal(result.skipReason, "no-eligible-product");
  assert.match(result.error ?? "", /商品リストが空/);
});

test("writeHistory:trueの場合、選定結果が履歴に記録される", async () => {
  const { deps, appendHistoryCalls } = buildMockDeps();
  const result = await runAffiliatePostingPipeline({ writeHistory: true, publish: dryRunAffiliatePublish, deps });

  assert.equal(result.success, true);
  assert.equal(result.historyWritten, true);
  assert.equal(appendHistoryCalls.length, 1);
});

test("生成失敗時はパイプラインがgenerate段階で停止し、履歴に書き込まない", async () => {
  const { deps, appendHistoryCalls } = buildMockDeps({
    generate: async (p) => ({ success: false, error: "生成に失敗しました(テスト)", product: p }),
  });

  const result = await runAffiliatePostingPipeline({ writeHistory: true, publish: dryRunAffiliatePublish, deps });

  assert.equal(result.success, false);
  assert.equal(result.stage, "generate");
  assert.equal(result.historyWritten, false);
  assert.equal(appendHistoryCalls.length, 0);
});

test("冪等性: 同一slot・同一日にstatus:'posted'の履歴があれば、収集・生成を一切行わずスキップする", async () => {
  const p = product({ id: "p1" });
  let generateCalled = false;
  const history: AffiliatePostHistoryEntry[] = [
    {
      id: "h1",
      productId: "p1",
      productName: "商品p1",
      slot: "affiliate",
      selectedAt: "2026-07-16T10:00:00.000Z",
      status: "posted",
      postedAt: "2026-07-16T10:00:00.000Z",
    },
  ];
  const { deps } = buildMockDeps({
    loadHistory: async () => history,
    generate: async () => {
      generateCalled = true;
      return { success: true, text: "【PR】テスト", product: p };
    },
  });

  const result = await runAffiliatePostingPipeline({
    writeHistory: true,
    publish: dryRunAffiliatePublish,
    slot: "affiliate",
    scheduledAt: "2026-07-16T10:00:00.000Z",
    now: new Date("2026-07-16T11:00:00.000Z"),
    deps,
  });

  assert.equal(result.success, false);
  assert.equal(result.stage, "skipped");
  assert.equal(result.skipReason, "already-posted");
  assert.equal(generateCalled, false);
});

test("本番投稿成功時、履歴エントリが投稿結果(posted)で更新される", async () => {
  const updateCalls: { id: string; updates: unknown }[] = [];
  const { deps } = buildMockDeps({
    updateHistory: async (id, updates) => {
      updateCalls.push({ id, updates });
      return null;
    },
  });

  const fakePublish: AffiliatePublishFn = async (tweets: ThreadTweet[]) => ({
    posted: true,
    detail: "投稿しました",
    tweetIds: tweets.map((t) => `tweet-${t.index}`),
    postedAt: "2026-07-16T10:00:05.000Z",
  });

  const result = await runAffiliatePostingPipeline({ writeHistory: true, publish: fakePublish, deps });

  assert.equal(result.success, true);
  assert.equal(result.publishResult?.posted, true);
  assert.equal(updateCalls.length, 1);
  assert.equal((updateCalls[0].updates as { status: string }).status, "posted");
});
