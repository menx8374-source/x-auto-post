import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadHistory, appendHistoryEntry } from "../src/postHistory.js";

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
