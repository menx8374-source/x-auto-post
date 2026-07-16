import { test } from "node:test";
import assert from "node:assert/strict";
import { runPostingPipeline, dryRunPublish, type PipelineDependencies, type PublishFn } from "../src/pipeline.js";
import type { NewsCandidate, PostHistoryEntry } from "../src/types.js";
import type { ThreadTweet } from "../src/threadSplit.js";

function candidate(overrides: Partial<NewsCandidate> & { url: string; title: string }): NewsCandidate {
  return {
    source: "Hacker News",
    publishedAt: "2026-07-16T00:00:00.000Z",
    score: 80,
    ...overrides,
  };
}

/** 収集・選定・生成・履歴I/Oをすべてモック化した依存一式(ネットワーク・外部API・実ファイルI/Oを一切使わない) */
function buildMockDeps(overrides: Partial<PipelineDependencies> = {}): {
  deps: Partial<PipelineDependencies>;
  appendHistoryCalls: unknown[];
} {
  const c = candidate({ url: "https://example.com/gpt6", title: "OpenAI releases GPT-6" });
  const appendHistoryCalls: unknown[] = [];

  const deps: Partial<PipelineDependencies> = {
    collect: async () => ({ scored: [c] }),
    loadHistory: async () => [],
    select: () => ({
      selected: c,
      reason: "テスト用: 最高スコアの候補を選定",
      consideredCount: 1,
      excludedAsDuplicateCount: 0,
      excludedByThresholdCount: 0,
    }),
    generate: async () => ({ success: true, text: "生成されたテスト用の投稿本文です。", candidate: c }),
    buildThread: (text, url) => [
      { index: 1, text, charLength: text.length, kind: "body" },
      { index: 2, text: `元記事: ${url}`, charLength: `元記事: ${url}`.length, kind: "link" },
    ],
    appendHistory: async (entry) => {
      appendHistoryCalls.push(entry);
      return { ...entry, normalizedUrl: entry.url };
    },
    ...overrides,
  };

  return { deps, appendHistoryCalls };
}

test("ドライラン: 収集→選定→生成→分割→リンク付与が通り、投稿予定の全ツイート(順序・文字数・リンク含む)が得られる", async () => {
  const { deps } = buildMockDeps();

  const result = await runPostingPipeline({ writeHistory: false, publish: dryRunPublish, deps });

  assert.equal(result.success, true);
  assert.equal(result.stage, "done");
  assert.equal(result.candidate?.url, "https://example.com/gpt6");
  assert.ok(result.tweets && result.tweets.length === 2);
  assert.equal(result.tweets?.[0].kind, "body");
  assert.equal(result.tweets?.[1].kind, "link");
  assert.equal(result.tweets?.[0].index, 1);
  assert.equal(result.tweets?.[1].index, 2);
  assert.ok((result.tweets?.[0].charLength ?? 0) > 0);
});

test("ドライラン: publishはXへ送信していない(posted: false)ことを返す", async () => {
  const { deps } = buildMockDeps();

  const result = await runPostingPipeline({ writeHistory: false, publish: dryRunPublish, deps });

  assert.equal(result.publishResult?.posted, false);
});

test("ドライラン: writeHistory未指定(false)なら投稿履歴に書き込まれない", async () => {
  const { deps, appendHistoryCalls } = buildMockDeps();

  const result = await runPostingPipeline({ writeHistory: false, publish: dryRunPublish, deps });

  assert.equal(result.historyWritten, false);
  assert.equal(appendHistoryCalls.length, 0);
});

test("writeHistory: trueを明示すれば投稿履歴に書き込まれる(ドライランでも選べる)", async () => {
  const { deps, appendHistoryCalls } = buildMockDeps();

  const result = await runPostingPipeline({ writeHistory: true, publish: dryRunPublish, deps });

  assert.equal(result.historyWritten, true);
  assert.equal(appendHistoryCalls.length, 1);
});

test("有効な選定候補が無い場合、パイプラインはselect段階で停止し、生成・分割・publishへ進まない", async () => {
  let generateCalled = false;
  let publishCalled = false;

  const { deps } = buildMockDeps({
    select: () => ({
      selected: null,
      reason: "有効な候補が0件のため投稿をスキップ",
      consideredCount: 0,
      excludedAsDuplicateCount: 0,
      excludedByThresholdCount: 0,
    }),
    generate: async () => {
      generateCalled = true;
      return { success: true, text: "呼ばれてはいけない", candidate: candidate({ url: "https://x.example.com", title: "x" }) };
    },
  });

  const publish: PublishFn = async () => {
    publishCalled = true;
    return { posted: false, detail: "呼ばれてはいけない" };
  };

  const result = await runPostingPipeline({ writeHistory: false, publish, deps });

  assert.equal(result.success, false);
  assert.equal(result.stage, "select");
  assert.equal(generateCalled, false);
  assert.equal(publishCalled, false);
});

test("生成が失敗した場合、パイプラインはgenerate段階で停止し、分割・publishへ進まない", async () => {
  let publishCalled = false;

  const { deps } = buildMockDeps({
    generate: async () => ({
      success: false,
      error: "ANTHROPIC_API_KEY が未設定のため投稿文面を生成できません",
      candidate: candidate({ url: "https://example.com/gpt6", title: "OpenAI releases GPT-6" }),
    }),
  });

  const publish: PublishFn = async () => {
    publishCalled = true;
    return { posted: false, detail: "呼ばれてはいけない" };
  };

  const result = await runPostingPipeline({ writeHistory: false, publish, deps });

  assert.equal(result.success, false);
  assert.equal(result.stage, "generate");
  assert.match(result.error ?? "", /ANTHROPIC_API_KEY/);
  assert.equal(publishCalled, false);
});

test("本番投稿を模したpublish関数に差し替えても、収集〜分割までの結果は同一(差異はpublish結果のみ)", async () => {
  const { deps: dryDeps } = buildMockDeps();
  const { deps: liveDeps } = buildMockDeps();

  const liveLikePublish: PublishFn = async (tweets: ThreadTweet[]) => ({
    posted: true,
    detail: `本番投稿を模して${tweets.length}件送信しました`,
  });

  const dryResult = await runPostingPipeline({ writeHistory: false, publish: dryRunPublish, deps: dryDeps });
  const liveResult = await runPostingPipeline({ writeHistory: false, publish: liveLikePublish, deps: liveDeps });

  assert.deepEqual(dryResult.tweets, liveResult.tweets);
  assert.equal(dryResult.candidate?.url, liveResult.candidate?.url);
  assert.equal(dryResult.text, liveResult.text);
  assert.equal(dryResult.publishResult?.posted, false);
  assert.equal(liveResult.publishResult?.posted, true);
});
