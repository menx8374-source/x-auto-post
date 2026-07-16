import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import {
  buildGenerationPrompt,
  cleanGeneratedText,
  extractTextFromResponse,
  validateGeneratedText,
  generatePostText,
  GENERATION_STYLE,
  DEFAULT_MODEL,
  type AnthropicMessageClient,
} from "../src/generatePost.js";
import type { NewsCandidate } from "../src/types.js";

function candidate(overrides: Partial<NewsCandidate> & { title: string; url: string }): NewsCandidate {
  return {
    source: "TechCrunch AI",
    publishedAt: "2026-07-16T00:00:00.000Z",
    score: 80,
    ...overrides,
  };
}

/** モック用のAnthropicレスポンスを組み立てる(テストに不要なフィールドは型アサーションで省略) */
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

/** create()呼び出し引数を記録しつつ固定レスポンスを返すモッククライアント */
function mockClient(
  responseText: string
): { client: AnthropicMessageClient; calls: unknown[] } {
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

test("buildGenerationPromptはタイトル・概要・情報源をユーザープロンプトに含み、日本語指定をシステムプロンプトに含む", () => {
  const c = candidate({
    title: "OpenAI releases GPT-6 with major reasoning upgrade",
    url: "https://example.com/gpt6",
    summary: "OpenAI unveiled its newest flagship model today.",
  });

  const prompt = buildGenerationPrompt(c);

  assert.match(prompt.user, /OpenAI releases GPT-6 with major reasoning upgrade/);
  assert.match(prompt.user, /OpenAI unveiled its newest flagship model today\./);
  assert.match(prompt.user, /TechCrunch AI/);
  assert.match(prompt.system, /日本語/);
  assert.equal(GENERATION_STYLE.language, "ja");
});

test("buildGenerationPromptは概要が無くても壊れない(概要行を含めない)", () => {
  const c = candidate({ title: "Some AI news", url: "https://example.com/x" });
  const prompt = buildGenerationPrompt(c);
  assert.doesNotMatch(prompt.user, /概要: undefined/);
});

test("extractTextFromResponseはtext以外のブロックを無視し、テキストブロックを連結する", () => {
  const message = {
    content: [
      { type: "text", text: "1つ目の文", citations: null },
      { type: "thinking", thinking: "内部思考(無視されるべき)" },
      { type: "text", text: "2つ目の文", citations: null },
    ],
  } as unknown as Anthropic.Message;

  const result = extractTextFromResponse(message);
  assert.equal(result, "1つ目の文\n2つ目の文");
});

test("cleanGeneratedTextは先頭/末尾の引用符・かぎ括弧を取り除く", () => {
  assert.equal(cleanGeneratedText('"生成された文面です"'), "生成された文面です");
  assert.equal(cleanGeneratedText("「生成された文面です」"), "生成された文面です");
  assert.equal(cleanGeneratedText("  余白付きの文面  "), "余白付きの文面");
});

test("validateGeneratedTextは要約・言い換えになっている文面を有効と判定する", () => {
  const c = candidate({
    title: "OpenAI releases GPT-6 with major reasoning upgrade",
    url: "https://example.com/gpt6",
  });
  const text = "OpenAIが新しい推論能力を強化したモデルを発表した。既存モデルより複雑な問題に対応できるという。";
  const result = validateGeneratedText(text, c);
  assert.equal(result.valid, true);
});

test("validateGeneratedTextはタイトルの丸写しに近い文面を無効と判定する(丸写し検知)", () => {
  const c = candidate({
    title: "OpenAI releases GPT-6 with major reasoning upgrade today",
    url: "https://example.com/gpt6",
  });
  // タイトルとほぼ同一のキーワード集合を持つ文面(丸写し相当)
  const text = "OpenAI releases GPT-6 with major reasoning upgrade today";
  const result = validateGeneratedText(text, c);
  assert.equal(result.valid, false);
  assert.match(result.reason ?? "", /丸写し/);
});

test("validateGeneratedTextは空文字列を無効と判定する", () => {
  const c = candidate({ title: "Some AI news", url: "https://example.com/x" });
  const result = validateGeneratedText("", c);
  assert.equal(result.valid, false);
  assert.match(result.reason ?? "", /空文字列/);
});

test("validateGeneratedTextは長すぎる生成結果を無効と判定する", () => {
  const c = candidate({ title: "Some AI news", url: "https://example.com/x" });
  const result = validateGeneratedText("あ".repeat(700), c);
  assert.equal(result.valid, false);
  assert.match(result.reason ?? "", /長すぎ/);
});

test("generatePostTextはクライアントがnull(APIキー未設定)の場合、失敗を返し例外を投げない", async () => {
  const c = candidate({ title: "Some AI news", url: "https://example.com/x" });
  const result = await generatePostText(c, null);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error, /ANTHROPIC_API_KEY/);
  }
});

test("generatePostTextはモッククライアントの応答を整形・検証して成功結果を返す(要約・言い換え文面)", async () => {
  const c = candidate({
    title: "OpenAI releases GPT-6 with major reasoning upgrade",
    url: "https://example.com/gpt6",
    summary: "OpenAI unveiled its newest flagship model today.",
  });
  const { client, calls } = mockClient(
    "「OpenAIが新しい推論特化モデルを公開した。従来より複雑な問題を解けるようになったという。」"
  );

  const result = await generatePostText(c, client);

  assert.equal(result.success, true);
  if (result.success) {
    // 引用符が取り除かれ、整形されていること
    assert.equal(result.text.startsWith("「"), false);
    assert.match(result.text, /OpenAI/);
  }
  // リクエストにモデル名・system・userメッセージ(タイトル含む)が渡っていること
  assert.equal(calls.length, 1);
  const requestParams = calls[0] as {
    model: string;
    system: string;
    messages: Anthropic.MessageParam[];
  };
  assert.equal(requestParams.model, DEFAULT_MODEL);
  assert.match(requestParams.system, /日本語/);
  assert.equal(requestParams.messages.length, 1);
  assert.match(String(requestParams.messages[0].content), /OpenAI releases GPT-6/);
});

test("generatePostTextはAPI応答がタイトルの丸写しに近い場合、失敗として扱い投稿処理に進まない", async () => {
  const c = candidate({
    title: "OpenAI releases GPT-6 with major reasoning upgrade today",
    url: "https://example.com/gpt6",
  });
  const { client } = mockClient("OpenAI releases GPT-6 with major reasoning upgrade today");

  const result = await generatePostText(c, client);

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error, /丸写し/);
  }
});

test("generatePostTextはAPI呼び出し自体が例外を投げた場合も失敗として安全に返す(壊れた投稿をしない)", async () => {
  const c = candidate({ title: "Some AI news", url: "https://example.com/x" });
  const client: AnthropicMessageClient = {
    messages: {
      create: async () => {
        throw new Error("simulated network failure");
      },
    },
  };

  const result = await generatePostText(c, client);

  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error, /simulated network failure/);
  }
});
