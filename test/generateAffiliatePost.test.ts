import { test } from "node:test";
import assert from "node:assert/strict";
import type Anthropic from "@anthropic-ai/sdk";
import {
  buildAffiliateGenerationPrompt,
  ensurePrLabel,
  validateAffiliateGeneratedText,
  generateAffiliatePostText,
  PR_LABEL,
  MAX_GENERATED_LENGTH,
} from "../src/generateAffiliatePost.js";
import { DEFAULT_MODEL, type AnthropicMessageClient } from "../src/generatePost.js";
import type { AffiliateProduct } from "../src/affiliateProducts.js";

function product(overrides: Partial<AffiliateProduct> & { id: string }): AffiliateProduct {
  return {
    name: `商品${overrides.id}`,
    officialUrl: `https://example.com/${overrides.id}`,
    affiliateUrl: `https://affiliate.example.com/${overrides.id}`,
    facts: ["容量は500ml", "国内正規品"],
    enabled: true,
    ...overrides,
  };
}

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

test("buildAffiliateGenerationPromptはシステムプロンプトに【PR】表記の必須指示を含む", () => {
  const p = product({ id: "p1" });
  const prompt = buildAffiliateGenerationPrompt(p);
  assert.match(prompt.system, /【PR】/);
  assert.match(prompt.system, /省略不可|必須/);
});

test("buildAffiliateGenerationPromptは事実に無い情報の創作を禁止する指示を含む", () => {
  const p = product({ id: "p1" });
  const prompt = buildAffiliateGenerationPrompt(p);
  assert.match(prompt.system, /創作/);
  assert.match(prompt.system, /事実/);
});

test("buildAffiliateGenerationPromptは一人称の体験談を禁止する指示を含む", () => {
  const p = product({ id: "p1" });
  const prompt = buildAffiliateGenerationPrompt(p);
  assert.match(prompt.system, /私は使ってみて/);
  assert.match(prompt.system, /体験談.*禁止|捏造/);
});

test("buildAffiliateGenerationPromptはfactsをユーザープロンプトに含める", () => {
  const p = product({ id: "p1", facts: ["容量500ml", "送料無料"] });
  const prompt = buildAffiliateGenerationPrompt(p);
  assert.match(prompt.user, /容量500ml/);
  assert.match(prompt.user, /送料無料/);
  assert.match(prompt.user, /商品p1/);
});

test("ensurePrLabelは先頭に【PR】が無ければ付与する", () => {
  const result = ensurePrLabel("これは紹介文です。");
  assert.ok(result.startsWith(PR_LABEL));
});

test("ensurePrLabelは既に先頭にある場合そのまま(重複しない)", () => {
  const result = ensurePrLabel(`${PR_LABEL} これは紹介文です。`);
  assert.equal(result, `${PR_LABEL} これは紹介文です。`);
});

test("ensurePrLabelは本文途中に紛れ込んだ表記を除去し、先頭に1つだけ配置する", () => {
  const result = ensurePrLabel(`これは紹介文です。${PR_LABEL}末尾にありました`);
  const occurrences = result.split(PR_LABEL).length - 1;
  assert.equal(occurrences, 1);
  assert.ok(result.startsWith(PR_LABEL));
});

test("validateAffiliateGeneratedTextは【PR】が先頭に無い場合を無効と判定する", () => {
  const result = validateAffiliateGeneratedText("これは紹介文です。");
  assert.equal(result.valid, false);
  assert.match(result.reason ?? "", /【PR】/);
});

test("validateAffiliateGeneratedTextは【PR】始まりの正常な文面を有効と判定する", () => {
  const result = validateAffiliateGeneratedText(`${PR_LABEL} これは紹介文です。`);
  assert.equal(result.valid, true);
});

test("validateAffiliateGeneratedTextは空文字列・長すぎる文面を無効と判定する", () => {
  assert.equal(validateAffiliateGeneratedText("").valid, false);
  const tooLong = `${PR_LABEL} ${"あ".repeat(MAX_GENERATED_LENGTH)}`;
  assert.equal(validateAffiliateGeneratedText(tooLong).valid, false);
});

test("generateAffiliatePostTextはクライアントがnull(APIキー未設定)の場合、失敗を返し例外を投げない", async () => {
  const p = product({ id: "p1" });
  const result = await generateAffiliatePostText(p, null);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error, /ANTHROPIC_API_KEY/);
  }
});

test("generateAffiliatePostTextは生成結果に【PR】が無くても、安全網により必ず先頭に付与されて成功する", async () => {
  const p = product({ id: "p1" });
  const { client } = mockClient("この商品は容量500mlで国内正規品です。");
  const result = await generateAffiliatePostText(p, client);
  assert.equal(result.success, true);
  if (result.success) {
    assert.ok(result.text.startsWith(PR_LABEL));
  }
});

test("generateAffiliatePostTextはAPI呼び出しが例外を投げた場合も失敗として安全に返す", async () => {
  const p = product({ id: "p1" });
  const client: AnthropicMessageClient = {
    messages: {
      create: async () => {
        throw new Error("simulated network failure");
      },
    },
  };
  const result = await generateAffiliatePostText(p, client);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error, /simulated network failure/);
  }
});

test("generateAffiliatePostTextは生成結果が長すぎる場合、失敗として扱う", async () => {
  const p = product({ id: "p1" });
  const { client } = mockClient("あ".repeat(700));
  const result = await generateAffiliatePostText(p, client);
  assert.equal(result.success, false);
  if (!result.success) {
    assert.match(result.error, /長すぎ/);
  }
});
