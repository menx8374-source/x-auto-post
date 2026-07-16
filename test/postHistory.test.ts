import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadHistory,
  appendHistoryEntry,
  updateHistoryEntry,
  hasPostedSlotOnDate,
  isWithinRecoveryWindow,
} from "../src/postHistory.js";
import type { PostHistoryEntry } from "../src/types.js";

async function withTempHistoryFile(fn: (filePath: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "post-history-test-"));
  const filePath = path.join(dir, "post-history.json");
  try {
    await fn(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("履歴ファイルが存在しない場合、空配列を返す", async () => {
  await withTempHistoryFile(async (filePath) => {
    const history = await loadHistory(filePath);
    assert.deepEqual(history, []);
  });
});

test("appendHistoryEntryで追記した内容がloadHistoryで読み返せる(normalizedUrlも付与される)", async () => {
  await withTempHistoryFile(async (filePath) => {
    await appendHistoryEntry(
      { url: "https://example.com/article-1/", title: "記事1", score: 42, selectedAt: "2026-07-16T00:00:00.000Z" },
      filePath
    );
    const history = await loadHistory(filePath);
    assert.equal(history.length, 1);
    assert.equal(history[0].url, "https://example.com/article-1/");
    assert.equal(history[0].normalizedUrl, "https://example.com/article-1");
    assert.equal(history[0].title, "記事1");
    assert.equal(history[0].score, 42);
  });
});

test("複数回appendHistoryEntryすると既存分が保持されたまま追記される", async () => {
  await withTempHistoryFile(async (filePath) => {
    await appendHistoryEntry({ url: "https://a.example.com/1", title: "A", selectedAt: "2026-07-16T00:00:00.000Z" }, filePath);
    await appendHistoryEntry({ url: "https://b.example.com/2", title: "B", selectedAt: "2026-07-16T01:00:00.000Z" }, filePath);
    const history = await loadHistory(filePath);
    assert.equal(history.length, 2);
    assert.equal(history[0].title, "A");
    assert.equal(history[1].title, "B");
  });
});

test("F9: appendHistoryEntryはid付きのエントリを返し、既定でstatus:'selected'になる", async () => {
  await withTempHistoryFile(async (filePath) => {
    const entry = await appendHistoryEntry(
      { url: "https://example.com/a", title: "A", selectedAt: "2026-07-16T00:00:00.000Z" },
      filePath
    );
    assert.ok(entry.id && entry.id.length > 0);
    assert.equal(entry.status, "selected");
  });
});

test("F9: updateHistoryEntryで投稿結果(枠・投稿日時・ツイートID・状態)を既存エントリへ反映できる", async () => {
  await withTempHistoryFile(async (filePath) => {
    const entry = await appendHistoryEntry(
      { url: "https://example.com/a", title: "A", selectedAt: "2026-07-16T09:00:00.000Z" },
      filePath
    );

    const updated = await updateHistoryEntry(
      entry.id!,
      { status: "posted", postedAt: "2026-07-16T09:05:00.000Z", tweetIds: ["t1", "t2"], slot: "morning" },
      filePath
    );

    assert.equal(updated?.status, "posted");
    assert.equal(updated?.postedAt, "2026-07-16T09:05:00.000Z");
    assert.deepEqual(updated?.tweetIds, ["t1", "t2"]);
    assert.equal(updated?.slot, "morning");

    const history = await loadHistory(filePath);
    assert.equal(history.length, 1);
    assert.equal(history[0].status, "posted");
  });
});

test("F9: updateHistoryEntryは存在しないidに対してnullを返し、履歴を書き換えない(例外を投げない)", async () => {
  await withTempHistoryFile(async (filePath) => {
    await appendHistoryEntry({ url: "https://example.com/a", title: "A", selectedAt: "2026-07-16T00:00:00.000Z" }, filePath);
    const result = await updateHistoryEntry("non-existent-id", { status: "posted" }, filePath);
    assert.equal(result, null);
    const history = await loadHistory(filePath);
    assert.equal(history.length, 1);
    assert.equal(history[0].status, "selected"); // 更新されず、appendHistoryEntry時点の既定値のまま
  });
});

test("F9: Sprint2形式(slot/status/id無し)の履歴もloadHistoryでそのまま読み込める(後方互換)", async () => {
  await withTempHistoryFile(async (filePath) => {
    const { writeFile } = await import("node:fs/promises");
    const legacyEntry = {
      url: "https://legacy.example.com/1",
      normalizedUrl: "https://legacy.example.com/1",
      title: "Legacy Entry",
      score: 10,
      selectedAt: "2026-07-01T00:00:00.000Z",
    };
    await writeFile(filePath, JSON.stringify([legacyEntry], null, 2), "utf-8");

    const history = await loadHistory(filePath);
    assert.equal(history.length, 1);
    assert.equal(history[0].title, "Legacy Entry");
    assert.equal(history[0].id, undefined);
    assert.equal(history[0].slot, undefined);
  });
});

function historyEntry(overrides: Partial<PostHistoryEntry> & { url: string; title: string }): PostHistoryEntry {
  return {
    normalizedUrl: overrides.url,
    selectedAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

test("F9: hasPostedSlotOnDateは同一枠・同一日にstatus:'posted'のエントリがあればtrueを返す(冪等性)", () => {
  const history: PostHistoryEntry[] = [
    historyEntry({
      url: "https://example.com/a",
      title: "A",
      slot: "morning",
      status: "posted",
      postedAt: "2026-07-16T00:30:00.000Z",
    }),
  ];
  const referenceDate = new Date("2026-07-16T05:00:00.000Z");
  assert.equal(hasPostedSlotOnDate(history, "morning", referenceDate), true);
});

test("F9: hasPostedSlotOnDateは別の日・別の枠・status未達(posted以外)ならfalseを返す", () => {
  const history: PostHistoryEntry[] = [
    historyEntry({
      url: "https://example.com/a",
      title: "A",
      slot: "morning",
      status: "posted",
      postedAt: "2026-07-15T00:30:00.000Z", // 前日
    }),
    historyEntry({
      url: "https://example.com/b",
      title: "B",
      slot: "evening", // 別枠
      status: "posted",
      postedAt: "2026-07-16T00:30:00.000Z",
    }),
    historyEntry({
      url: "https://example.com/c",
      title: "C",
      slot: "morning",
      status: "failed", // 投稿失敗(ブロックしない)
      postedAt: "2026-07-16T00:30:00.000Z",
    }),
  ];
  const referenceDate = new Date("2026-07-16T05:00:00.000Z");
  assert.equal(hasPostedSlotOnDate(history, "morning", referenceDate), false);
});

test("F9: 擬似二重起動 - 1回目の投稿後、同日中の2回目呼び出しはhasPostedSlotOnDateでブロックされる", async () => {
  await withTempHistoryFile(async (filePath) => {
    const entry = await appendHistoryEntry(
      { url: "https://example.com/gpt", title: "GPT", selectedAt: "2026-07-16T09:00:00.000Z", slot: "morning" },
      filePath
    );
    await updateHistoryEntry(
      entry.id!,
      { status: "posted", postedAt: "2026-07-16T09:01:00.000Z", tweetIds: ["t1"], slot: "morning" },
      filePath
    );

    // 2回目の起動(同日・同枠)をシミュレート
    const historyAfterFirstRun = await loadHistory(filePath);
    const secondRunAt = new Date("2026-07-16T09:02:00.000Z"); // 数分後の二重起動
    assert.equal(hasPostedSlotOnDate(historyAfterFirstRun, "morning", secondRunAt), true);
  });
});

test("F9(回帰): hasPostedSlotOnDateはUTC日境界をまたいでもJST基準で同一日と判定し、二重投稿を防ぐ", () => {
  // 実際の不具合再現: 07:31 JSTに投稿(UTCでは前日22:31Zになり、UTC基準のdateKeyだと前日扱いされてしまっていた)。
  // 1時間35分後、09:05 JST(同一JST暦日・既定リカバリー許容範囲3時間以内)に同じ枠で再実行しても、
  // JST基準のdateKeyなら同一日と判定され、hasPostedSlotOnDateがtrueを返して二重投稿をブロックできる必要がある。
  const history: PostHistoryEntry[] = [
    historyEntry({
      url: "https://example.com/morning-article",
      title: "朝の記事",
      slot: "morning",
      status: "posted",
      postedAt: "2026-07-14T22:31:00.000Z", // = 2026-07-15T07:31:00+09:00 (JST)
    }),
  ];
  const secondRunAt = new Date("2026-07-15T00:05:00.000Z"); // = 2026-07-15T09:05:00+09:00 (JST、同一暦日)
  assert.equal(hasPostedSlotOnDate(history, "morning", secondRunAt), true);
});

test("F9(回帰): hasPostedSlotOnDateはUTC日境界をまたいでもJST基準で別日は正しく別日と判定する(誤スキップ防止)", () => {
  // 逆パターン: 前日の投稿はUTC dateKeyでは同日に見えてしまう場合でも、JST基準では正しく別日として
  // 扱われ、翌日の正当な投稿が「既投稿」と誤判定されてスキップされないことを確認する。
  const history: PostHistoryEntry[] = [
    historyEntry({
      url: "https://example.com/previous-day-article",
      title: "前日の記事",
      slot: "morning",
      status: "posted",
      postedAt: "2026-07-13T22:31:00.000Z", // = 2026-07-14T07:31:00+09:00 (JST)
    }),
  ];
  const nextDayRunAt = new Date("2026-07-14T22:00:00.000Z"); // = 2026-07-15T07:00:00+09:00 (JST、翌暦日)
  assert.equal(hasPostedSlotOnDate(history, "morning", nextDayRunAt), false);
});

test("F9: isWithinRecoveryWindowは許容範囲内(境界値含む)ならtrue、範囲外ならfalseを返す", () => {
  const scheduledAt = new Date("2026-07-16T00:00:00.000Z"); // 例: 朝枠の予定時刻(UTC)
  const toleranceHours = 3;

  // ちょうど許容範囲内(3時間ぴったり)
  assert.equal(
    isWithinRecoveryWindow(scheduledAt, new Date("2026-07-16T03:00:00.000Z"), toleranceHours),
    true
  );
  // 許容範囲のわずかに内側
  assert.equal(
    isWithinRecoveryWindow(scheduledAt, new Date("2026-07-16T02:59:59.000Z"), toleranceHours),
    true
  );
  // 許容範囲のわずかに外側(深夜に朝枠を投稿するような無制限遅延を防ぐ)
  assert.equal(
    isWithinRecoveryWindow(scheduledAt, new Date("2026-07-16T03:00:01.000Z"), toleranceHours),
    false
  );
  // 大幅に範囲外(例: 深夜に朝枠)
  assert.equal(
    isWithinRecoveryWindow(scheduledAt, new Date("2026-07-16T23:00:00.000Z"), toleranceHours),
    false
  );
  // 予定時刻より前(まだ来ていない)は常にtrue
  assert.equal(
    isWithinRecoveryWindow(scheduledAt, new Date("2026-07-15T23:00:00.000Z"), toleranceHours),
    true
  );
});
