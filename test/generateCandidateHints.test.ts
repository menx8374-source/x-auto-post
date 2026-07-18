import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import {
  generateCandidateHints,
  TOP_N_HINTS,
  buildProductCandidatePrompt,
  parseProductCandidateResponse,
  detectProductCandidates,
} from "../src/generateCandidateHints.js";
import { DEFAULT_MODEL, type AnthropicMessageClient } from "../src/generatePost.js";
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
    const result = await generateCandidateHints(outFile, async () => ({ scored }), null);

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
    const result = await generateCandidateHints(outFile, async () => ({ scored }), null);
    assert.equal(result.items.length, TOP_N_HINTS);
    assert.equal(result.items[0].title, "記事0");
  });
});

test("generateCandidateHintsは候補が0件でもエラーにせず空配列を書き出す", async () => {
  await withTempOutFile(async (outFile) => {
    const result = await generateCandidateHints(outFile, async () => ({ scored: [] }), null);
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
    const result = await generateCandidateHints(outFile, async () => ({ scored }), null);
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].title, "正常記事");
  });
});

test("generateCandidateHintsは全候補が不正スキームの場合、空配列を書き出す(エラーにしない)", async () => {
  await withTempOutFile(async (outFile) => {
    const scored: NewsCandidate[] = [candidate({ title: "不正記事", url: "javascript:alert(1)", score: 90 })];
    const result = await generateCandidateHints(outFile, async () => ({ scored }), null);
    assert.deepEqual(result.items, []);
  });
});

test("generateCandidateHintsは本番のsrc/pipeline.ts等をimportしない(独立性の静的確認)", async () => {
  const source = await readFile(path.join(process.cwd(), "src", "generateCandidateHints.ts"), "utf-8");
  assert.doesNotMatch(source, /from ["']\.\/pipeline\.js["']/);
  assert.doesNotMatch(source, /from ["']\.\/publish\.js["']/);
  assert.doesNotMatch(source, /from ["']\.\/dryRun\.js["']/);
});

// ---- 商品候補の自動検出(Claude分類)関連のテスト ----

function fakeMessage(text: string): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: DEFAULT_MODEL,
    content: [{ type: "text", text, citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: { input_tokens: 10, output_tokens: 20 },
    container: null,
  } as unknown as Anthropic.Message;
}

function mockClient(responseText: string): { client: AnthropicMessageClient; calls: unknown[] } {
  const calls: unknown[] = [];
  const client: AnthropicMessageClient = {
    messages: {
      create: async (params) => {
        calls.push(params);
        return fakeMessage(responseText);
      },
    },
  };
  return { client, calls };
}

test("buildProductCandidatePromptは事実情報を生成させない指示を含む", () => {
  const prompt = buildProductCandidatePrompt([{ title: "記事A", url: "https://example.com/a", source: "Hacker News" }]);
  assert.match(prompt.system, /事実/);
  assert.match(prompt.system, /生成しないで|一切/);
  assert.match(prompt.user, /記事A/);
});

test("parseProductCandidateResponseは正常なJSON配列をパースする", () => {
  const raw = JSON.stringify([
    { index: 0, productName: "SuperAI Tool", officialUrlGuess: "https://superai.example.com" },
    { index: 2, productName: "AnotherTool", officialUrlGuess: null },
  ]);
  const result = parseProductCandidateResponse(raw, 3);
  assert.equal(result.size, 2);
  assert.deepEqual(result.get(0), { name: "SuperAI Tool", officialUrlGuess: "https://superai.example.com" });
  assert.deepEqual(result.get(2), { name: "AnotherTool", officialUrlGuess: null });
});

test("parseProductCandidateResponseはコードブロックで囲まれたJSONも扱える", () => {
  const raw = "```json\n" + JSON.stringify([{ index: 0, productName: "Tool", officialUrlGuess: null }]) + "\n```";
  const result = parseProductCandidateResponse(raw, 1);
  assert.equal(result.size, 1);
});

test("parseProductCandidateResponseはofficialUrlGuessが不正スキームの場合nullにフォールバックする", () => {
  const raw = JSON.stringify([{ index: 0, productName: "Tool", officialUrlGuess: "javascript:alert(1)" }]);
  const result = parseProductCandidateResponse(raw, 1);
  assert.equal(result.get(0)?.officialUrlGuess, null);
});

test("parseProductCandidateResponseは不正なJSONの場合、例外を投げず空のMapを返す", () => {
  const result = parseProductCandidateResponse("これはJSONではありません", 3);
  assert.equal(result.size, 0);
});

test("parseProductCandidateResponseはJSON配列でない場合(オブジェクト等)、空のMapを返す", () => {
  const result = parseProductCandidateResponse(JSON.stringify({ foo: "bar" }), 3);
  assert.equal(result.size, 0);
});

test("parseProductCandidateResponseは範囲外・型不正な要素をスキップする(全体は失敗にしない)", () => {
  const raw = JSON.stringify([
    { index: 99, productName: "OutOfRange" },
    { index: 0 }, // productNameなし
    { index: "1", productName: "BadIndexType" },
    { index: 1, productName: "Valid", officialUrlGuess: null },
  ]);
  const result = parseProductCandidateResponse(raw, 2);
  assert.equal(result.size, 1);
  assert.deepEqual(result.get(1), { name: "Valid", officialUrlGuess: null });
});

test("detectProductCandidatesはクライアントがnull(APIキー未設定)の場合、空のMapを返し例外を投げない", async () => {
  const result = await detectProductCandidates(
    [{ title: "記事A", url: "https://example.com/a", source: "Hacker News" }],
    null
  );
  assert.equal(result.size, 0);
});

test("detectProductCandidatesはAPI呼び出しが例外を投げた場合も空のMapを返す(スクリプト全体を失敗させない)", async () => {
  const client: AnthropicMessageClient = {
    messages: {
      create: async () => {
        throw new Error("simulated network failure");
      },
    },
  };
  const result = await detectProductCandidates(
    [{ title: "記事A", url: "https://example.com/a", source: "Hacker News" }],
    client
  );
  assert.equal(result.size, 0);
});

test("detectProductCandidatesは項目が0件の場合API呼び出しをせず空のMapを返す", async () => {
  const { client, calls } = mockClient("[]");
  const result = await detectProductCandidates([], client);
  assert.equal(result.size, 0);
  assert.equal(calls.length, 0);
});

test("generateCandidateHintsは商品候補ありのレスポンスをitemsへ反映する", async () => {
  await withTempOutFile(async (outFile) => {
    const scored: NewsCandidate[] = [
      candidate({ title: "SuperAI Toolが新機能を発表", url: "https://example.com/a", source: "Hacker News", score: 90 }),
      candidate({ title: "AI業界の動向まとめ", url: "https://example.com/b", source: "Reddit", score: 80 }),
    ];
    const { client } = mockClient(
      JSON.stringify([{ index: 0, productName: "SuperAI Tool", officialUrlGuess: "https://superai.example.com" }])
    );
    const result = await generateCandidateHints(outFile, async () => ({ scored }), client);

    assert.deepEqual(result.items[0].productCandidate, {
      name: "SuperAI Tool",
      officialUrlGuess: "https://superai.example.com",
    });
    assert.equal("productCandidate" in result.items[1], false);
  });
});

test("generateCandidateHintsはAPIキー未設定(client:null)の場合、productCandidateなしで従来通り書き出す", async () => {
  await withTempOutFile(async (outFile) => {
    const scored: NewsCandidate[] = [
      candidate({ title: "記事A", url: "https://example.com/a", source: "Hacker News", score: 90 }),
    ];
    const result = await generateCandidateHints(outFile, async () => ({ scored }), null);
    assert.equal("productCandidate" in result.items[0], false);
    assert.deepEqual(result.items[0], { title: "記事A", url: "https://example.com/a", source: "Hacker News", score: 90 });
  });
});

test("generateCandidateHintsは分類レスポンスがJSON不正の場合、例外を投げずproductCandidateなしで書き出す", async () => {
  await withTempOutFile(async (outFile) => {
    const scored: NewsCandidate[] = [
      candidate({ title: "記事A", url: "https://example.com/a", source: "Hacker News", score: 90 }),
    ];
    const { client } = mockClient("これはJSONではありません");
    const result = await generateCandidateHints(outFile, async () => ({ scored }), client);
    assert.equal("productCandidate" in result.items[0], false);
  });
});
