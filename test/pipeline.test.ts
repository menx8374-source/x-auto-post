import { test } from "node:test";
import assert from "node:assert/strict";
import { runPostingPipeline, dryRunPublish, type PipelineDependencies, type PublishFn } from "../src/pipeline.js";
import { resolveCurrentSlot } from "../src/postSchedule.js";
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

/**
 * F9: loadHistory/appendHistory/updateHistoryが同一のメモリ上配列を共有する、ファイルI/O無しの
 * ステートフルなモック。複数回runPostingPipeline()を呼んでも状態が引き継がれるため、
 * 「二重起動」「不発リカバリ」を実ファイルなしにシミュレートできる。
 */
function buildStatefulMockDeps(candidateOverrides: Partial<NewsCandidate> = {}): {
  deps: Partial<PipelineDependencies>;
  store: PostHistoryEntry[];
} {
  const store: PostHistoryEntry[] = [];
  let nextId = 0;
  const c = candidate({ url: "https://example.com/gpt6", title: "OpenAI releases GPT-6", ...candidateOverrides });

  const deps: Partial<PipelineDependencies> = {
    collect: async () => ({ scored: [c] }),
    loadHistory: async () => [...store],
    select: () => ({
      selected: c,
      reason: "テスト用: 最高スコアの候補を選定",
      consideredCount: 1,
      excludedAsDuplicateCount: 0,
      excludedByThresholdCount: 0,
    }),
    generate: async () => ({ success: true, text: "生成されたテスト用の投稿本文です。", candidate: c }),
    buildThread: (text, url) => [{ index: 1, text, charLength: text.length, kind: "body" }],
    appendHistory: async (entry) => {
      const full: PostHistoryEntry = {
        ...entry,
        status: entry.status ?? "selected",
        id: `id-${nextId++}`,
        normalizedUrl: entry.url,
      };
      store.push(full);
      return full;
    },
    updateHistory: async (id, updates) => {
      const idx = store.findIndex((h) => h.id === id);
      if (idx === -1) return null;
      store[idx] = { ...store[idx], ...updates };
      return store[idx];
    },
  };

  return { deps, store };
}

test("F9: 擬似二重起動 - 同一枠・同一日に2回パイプラインを実行しても2回目は二重投稿されない", async () => {
  const { deps } = buildStatefulMockDeps();
  let publishCallCount = 0;
  const publish: PublishFn = async (tweets) => {
    publishCallCount++;
    return { posted: true, detail: "投稿成功", tweetIds: [`tweet-${publishCallCount}`], postedAt: new Date().toISOString() };
  };

  const firstRun = await runPostingPipeline({ writeHistory: true, publish, deps, slot: "morning" });
  assert.equal(firstRun.success, true);
  assert.equal(firstRun.publishResult?.posted, true);
  assert.equal(publishCallCount, 1);

  // 数分後、同一枠に対する二重起動をシミュレート
  const secondRun = await runPostingPipeline({ writeHistory: true, publish, deps, slot: "morning" });
  assert.equal(secondRun.success, false);
  assert.equal(secondRun.stage, "skipped");
  assert.equal(secondRun.skipReason, "already-posted");
  // publishは再度呼ばれていない(二重投稿されていない)
  assert.equal(publishCallCount, 1);
});

test("F9: 投稿完了後、履歴エントリにslot・postedAt・tweetIdsが反映される", async () => {
  const { deps, store } = buildStatefulMockDeps();
  const publish: PublishFn = async () => ({
    posted: true,
    detail: "投稿成功",
    tweetIds: ["tweet-abc"],
    postedAt: "2026-07-16T09:05:00.000Z",
  });

  await runPostingPipeline({ writeHistory: true, publish, deps, slot: "morning" });

  assert.equal(store.length, 1);
  assert.equal(store[0].slot, "morning");
  assert.equal(store[0].status, "posted");
  assert.equal(store[0].postedAt, "2026-07-16T09:05:00.000Z");
  assert.deepEqual(store[0].tweetIds, ["tweet-abc"]);
});

test("F9: 不発リカバリ - 許容範囲内(数時間程度)ならscheduledAt指定でも投稿を補える", async () => {
  const { deps } = buildStatefulMockDeps();
  const scheduledAt = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1時間前が予定時刻
  let publishCalled = false;
  const publish: PublishFn = async () => {
    publishCalled = true;
    return { posted: true, detail: "補って投稿成功", tweetIds: ["tweet-1"], postedAt: new Date().toISOString() };
  };

  const result = await runPostingPipeline({
    writeHistory: true,
    publish,
    deps,
    slot: "morning",
    scheduledAt,
    recoveryWindowHours: 3,
  });

  assert.equal(result.success, true);
  assert.equal(publishCalled, true);
});

test("F9: 不発リカバリ - 許容範囲外(深夜に朝枠のような大幅遅延)なら投稿を補わずスキップする", async () => {
  const { deps } = buildStatefulMockDeps();
  const scheduledAt = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(); // 10時間前が予定時刻
  let publishCalled = false;
  const publish: PublishFn = async () => {
    publishCalled = true;
    return { posted: true, detail: "呼ばれてはいけない" };
  };

  const result = await runPostingPipeline({
    writeHistory: true,
    publish,
    deps,
    slot: "morning",
    scheduledAt,
    recoveryWindowHours: 3,
  });

  assert.equal(result.success, false);
  assert.equal(result.stage, "skipped");
  assert.equal(result.skipReason, "outside-recovery-window");
  assert.equal(publishCalled, false);
});

test("F9回帰: 深夜跨ぎのルックバックでresolveCurrentSlotが前日の枠と解決した場合でも、冪等性判定はscheduledAtの暦日を基準にしてリトライの二重投稿を防ぐ", async () => {
  // pipeline.ts内の不発リカバリ判定(isWithinRecoveryWindow)は実行時点の実際の壁時計(new Date())を
  // 使うため、テストを実際の実行時刻から独立させる(いつ実行しても再現する)ために、実行時刻から
  // 十分離れた(=必ず別のJST暦日になる)過去のscheduledAtを使い、許容範囲を大きめに設定する。
  // これは「深夜跨ぎで前日の枠に解決される」状況を、実時刻に依存せず再現するためのテスト用の値であり、
  // 実運用のPOST_RECOVERY_WINDOW_HOURS(バグ実証時は5時間)の大きさ自体が本質ではない。
  const toleranceHours = 30;
  const pastNow = new Date(Date.now() - 26 * 60 * 60 * 1000); // 26時間前 = 実行時刻とは必ず異なるJST暦日

  const { deps } = buildStatefulMockDeps();

  // resolveCurrentSlotが解決した「本来の予定時刻」を使う(実運用でCLIの--auto-slotが渡す値と同じ形)
  const resolved = resolveCurrentSlot(pastNow, toleranceHours);
  assert.ok(resolved);

  let publishCallCount = 0;
  const publish: PublishFn = async () => {
    publishCallCount++;
    return {
      posted: true,
      detail: "投稿成功",
      tweetIds: [`tweet-${publishCallCount}`],
      // 予定時刻(scheduledAt)の5分後に投稿完了(同じJST暦日内)
      postedAt: new Date(new Date(resolved!.scheduledAt).getTime() + 5 * 60 * 1000).toISOString(),
    };
  };

  // 1回目: 予定枠として実行・投稿完了
  const firstRun = await runPostingPipeline({
    writeHistory: true,
    publish,
    deps,
    slot: resolved!.slot,
    scheduledAt: resolved!.scheduledAt,
    recoveryWindowHours: toleranceHours,
  });
  assert.equal(firstRun.success, true);
  assert.equal(publishCallCount, 1);

  // 2回目: 深夜跨ぎのルックバックにより、リトライ時もresolveCurrentSlotが同じ「前日の枠」の
  // scheduledAtを再解決したケースを模す(実運用ではポーリング/リトライで再度auto-slot解決される)。
  const secondRun = await runPostingPipeline({
    writeHistory: true,
    publish,
    deps,
    slot: resolved!.slot,
    scheduledAt: resolved!.scheduledAt,
    recoveryWindowHours: toleranceHours,
  });

  // 冪等性判定がscheduledAt(=前日)の暦日を基準にするため、前日分の投稿履歴を見つけてスキップする。
  // (修正前は実行時点の実際の暦日を使っていたため、前日分の履歴を見つけられずここで二重投稿していた)
  assert.equal(secondRun.success, false);
  assert.equal(secondRun.stage, "skipped");
  assert.equal(secondRun.skipReason, "already-posted");
  // publishは再度呼ばれていない(二重投稿されていない)
  assert.equal(publishCallCount, 1);
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
