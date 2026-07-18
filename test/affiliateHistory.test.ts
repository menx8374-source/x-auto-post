import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadAffiliateHistory,
  appendAffiliateHistoryEntry,
  updateAffiliateHistoryEntry,
  hasPostedAffiliateSlotOnDate,
  countPostedByProduct,
  lastPostedAtByProduct,
  type AffiliatePostHistoryEntry,
} from "../src/affiliateHistory.js";

async function withTempHistoryFile(fn: (filePath: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "affiliate-history-test-"));
  const filePath = path.join(dir, "affiliate-post-history.json");
  try {
    await fn(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("履歴ファイルが存在しない場合、空配列を返す", async () => {
  await withTempHistoryFile(async (filePath) => {
    const history = await loadAffiliateHistory(filePath);
    assert.deepEqual(history, []);
  });
});

test("appendAffiliateHistoryEntryはid付きのエントリを返し、既定でstatus:'selected'になる", async () => {
  await withTempHistoryFile(async (filePath) => {
    const entry = await appendAffiliateHistoryEntry(
      { productId: "p1", productName: "商品A", selectedAt: "2026-07-16T00:00:00.000Z" },
      filePath
    );
    assert.ok(entry.id && entry.id.length > 0);
    assert.equal(entry.status, "selected");

    const history = await loadAffiliateHistory(filePath);
    assert.equal(history.length, 1);
    assert.equal(history[0].productId, "p1");
  });
});

test("updateAffiliateHistoryEntryで投稿結果を既存エントリへ反映できる", async () => {
  await withTempHistoryFile(async (filePath) => {
    const entry = await appendAffiliateHistoryEntry(
      { productId: "p1", productName: "商品A", selectedAt: "2026-07-16T00:00:00.000Z", slot: "affiliate" },
      filePath
    );
    const updated = await updateAffiliateHistoryEntry(
      entry.id!,
      { status: "posted", postedAt: "2026-07-16T10:05:00.000Z", tweetIds: ["t1"], slot: "affiliate" },
      filePath
    );
    assert.equal(updated?.status, "posted");
    assert.equal(updated?.postedAt, "2026-07-16T10:05:00.000Z");
    assert.deepEqual(updated?.tweetIds, ["t1"]);
  });
});

test("updateAffiliateHistoryEntryは存在しないidに対してnullを返し、履歴を書き換えない", async () => {
  await withTempHistoryFile(async (filePath) => {
    await appendAffiliateHistoryEntry({ productId: "p1", productName: "商品A", selectedAt: "2026-07-16T00:00:00.000Z" }, filePath);
    const result = await updateAffiliateHistoryEntry("non-existent-id", { status: "posted" }, filePath);
    assert.equal(result, null);
  });
});

function historyEntry(
  overrides: Partial<AffiliatePostHistoryEntry> & { productId: string; productName: string }
): AffiliatePostHistoryEntry {
  return { selectedAt: "2026-07-16T00:00:00.000Z", ...overrides };
}

test("hasPostedAffiliateSlotOnDateは同一枠・同一日にstatus:'posted'のエントリがあればtrueを返す", () => {
  const history: AffiliatePostHistoryEntry[] = [
    historyEntry({
      productId: "p1",
      productName: "商品A",
      slot: "affiliate",
      status: "posted",
      postedAt: "2026-07-16T10:00:00.000Z",
    }),
  ];
  const referenceDate = new Date("2026-07-16T12:00:00.000Z");
  assert.equal(hasPostedAffiliateSlotOnDate(history, "affiliate", referenceDate), true);
});

test("hasPostedAffiliateSlotOnDateは別日・別枠・status未達ならfalseを返す", () => {
  const history: AffiliatePostHistoryEntry[] = [
    historyEntry({
      productId: "p1",
      productName: "商品A",
      slot: "affiliate",
      status: "posted",
      postedAt: "2026-07-15T10:00:00.000Z", // 前日
    }),
    historyEntry({
      productId: "p2",
      productName: "商品B",
      slot: "affiliate",
      status: "failed", // 未達
      postedAt: "2026-07-16T10:00:00.000Z",
    }),
  ];
  const referenceDate = new Date("2026-07-16T12:00:00.000Z");
  assert.equal(hasPostedAffiliateSlotOnDate(history, "affiliate", referenceDate), false);
});

test("hasPostedAffiliateSlotOnDate(回帰): UTC日境界をまたいでもJST基準で判定する", () => {
  // 19:00 JST投稿 = UTC10:00。同日JST内の再実行(UTC13:00 = 22:00 JST)でも同一JST暦日と判定されること。
  const history: AffiliatePostHistoryEntry[] = [
    historyEntry({
      productId: "p1",
      productName: "商品A",
      slot: "affiliate",
      status: "posted",
      postedAt: "2026-07-16T10:00:00.000Z", // = 2026-07-16T19:00:00+09:00
    }),
  ];
  const secondRunAt = new Date("2026-07-16T13:00:00.000Z"); // = 2026-07-16T22:00:00+09:00(同一JST暦日)
  assert.equal(hasPostedAffiliateSlotOnDate(history, "affiliate", secondRunAt), true);
});

test("countPostedByProductはstatus:'posted'のエントリのみを商品ごとに集計する", () => {
  const history: AffiliatePostHistoryEntry[] = [
    historyEntry({ productId: "p1", productName: "A", status: "posted", postedAt: "2026-07-14T00:00:00.000Z" }),
    historyEntry({ productId: "p1", productName: "A", status: "posted", postedAt: "2026-07-15T00:00:00.000Z" }),
    historyEntry({ productId: "p1", productName: "A", status: "failed", postedAt: "2026-07-16T00:00:00.000Z" }),
    historyEntry({ productId: "p2", productName: "B", status: "posted", postedAt: "2026-07-16T00:00:00.000Z" }),
    historyEntry({ productId: "p3", productName: "C", status: "selected" }),
  ];
  const counts = countPostedByProduct(history);
  assert.equal(counts.get("p1"), 2);
  assert.equal(counts.get("p2"), 1);
  assert.equal(counts.get("p3"), undefined);
});

test("lastPostedAtByProductは商品ごとの最終投稿日時(最新)を返す", () => {
  const history: AffiliatePostHistoryEntry[] = [
    historyEntry({ productId: "p1", productName: "A", status: "posted", postedAt: "2026-07-14T00:00:00.000Z" }),
    historyEntry({ productId: "p1", productName: "A", status: "posted", postedAt: "2026-07-16T00:00:00.000Z" }),
    historyEntry({ productId: "p2", productName: "B", status: "selected" }),
  ];
  const lastPosted = lastPostedAtByProduct(history);
  assert.equal(lastPosted.get("p1"), "2026-07-16T00:00:00.000Z");
  assert.equal(lastPosted.get("p2"), undefined);
});
