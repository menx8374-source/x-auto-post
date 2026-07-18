import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { generateCandidateHints, TOP_N_HINTS } from "../src/generateCandidateHints.js";
import type { NewsCandidate } from "../src/types.js";

function candidate(overrides: Partial<NewsCandidate> & { title: string; url: string }): NewsCandidate {
  return {
    source: "テストソース",
    publishedAt: new Date().toISOString(),
    score: 50,
    ...overrides,
  };
}

async function withTempOutFile(fn: (outFile: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "candidate-hints-test-"));
  try {
    await fn(path.join(dir, "affiliate-candidate-hints.json"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("generateCandidateHintsはcollectFnが返した候補をtitle/url/source/scoreの形で書き出す", async () => {
  await withTempOutFile(async (outFile) => {
    const scored: NewsCandidate[] = [
      candidate({ title: "記事A", url: "https://example.com/a", source: "Hacker News", score: 90 }),
      candidate({ title: "記事B", url: "https://example.com/b", source: "Reddit", score: 80 }),
    ];
    const result = await generateCandidateHints(outFile, async () => ({ scored }));

    assert.equal(result.items.length, 2);
    assert.deepEqual(result.items[0], { title: "記事A", url: "https://example.com/a", source: "Hacker News", score: 90 });
    assert.ok(result.generatedAt);

    const written = JSON.parse(await readFile(outFile, "utf-8"));
    assert.deepEqual(written, result);
  });
});

test("generateCandidateHintsはスコア上位TOP_N_HINTS件のみに絞り込む", async () => {
  await withTempOutFile(async (outFile) => {
    const scored: NewsCandidate[] = Array.from({ length: TOP_N_HINTS + 10 }, (_, i) =>
      candidate({ title: `記事${i}`, url: `https://example.com/${i}`, score: 100 - i })
    );
    const result = await generateCandidateHints(outFile, async () => ({ scored }));
    assert.equal(result.items.length, TOP_N_HINTS);
    assert.equal(result.items[0].title, "記事0");
  });
});

test("generateCandidateHintsは候補が0件でもエラーにせず空配列を書き出す", async () => {
  await withTempOutFile(async (outFile) => {
    const result = await generateCandidateHints(outFile, async () => ({ scored: [] }));
    assert.deepEqual(result.items, []);
    const written = JSON.parse(await readFile(outFile, "utf-8"));
    assert.deepEqual(written.items, []);
  });
});

test("generateCandidateHintsはurlがjavascript:等の不正スキームの候補を除外する(admin/public/app.jsがhrefへ直接埋め込むための安全網)", async () => {
  await withTempOutFile(async (outFile) => {
    const scored: NewsCandidate[] = [
      candidate({ title: "正常記事", url: "https://example.com/ok", score: 90 }),
      candidate({ title: "不正記事", url: "javascript:alert(1)", score: 80 }),
    ];
    const result = await generateCandidateHints(outFile, async () => ({ scored }));
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, "正常記事");
  });
});

test("generateCandidateHintsは全候補が不正スキームの場合、空配列を書き出す(エラーにしない)", async () => {
  await withTempOutFile(async (outFile) => {
    const scored: NewsCandidate[] = [candidate({ title: "不正記事", url: "javascript:alert(1)", score: 90 })];
    const result = await generateCandidateHints(outFile, async () => ({ scored }));
    assert.deepEqual(result.items, []);
  });
});

test("generateCandidateHintsは本番のsrc/pipeline.ts等をimportしない(独立性の静的確認)", async () => {
  const source = await readFile(path.join(process.cwd(), "src", "generateCandidateHints.ts"), "utf-8");
  assert.doesNotMatch(source, /from ["']\.\/pipeline\.js["']/);
  assert.doesNotMatch(source, /from ["']\.\/publish\.js["']/);
  assert.doesNotMatch(source, /from ["']\.\/dryRun\.js["']/);
});
