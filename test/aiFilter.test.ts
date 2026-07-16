import { test } from "node:test";
import assert from "node:assert/strict";
import { isAiRelated, filterAiRelated } from "../src/aiFilter.js";

test("AI関連キーワードを含むタイトルはAI関連と判定される", () => {
  assert.equal(isAiRelated("OpenAI releases new GPT-5 model"), true);
  assert.equal(isAiRelated("Anthropic's Claude gets a major update"), true);
  assert.equal(isAiRelated("Google DeepMind publishes new research on AI safety"), true);
  assert.equal(isAiRelated("This machine learning breakthrough changes everything"), true);
});

test("AI無関係のタイトルはAI関連と判定されない", () => {
  assert.equal(isAiRelated("Local bakery wins award for best sourdough bread"), false);
  assert.equal(isAiRelated("Stock market closes higher amid interest rate concerns"), false);
  assert.equal(isAiRelated("New airline route announced between Tokyo and Osaka"), false);
});

test("'AI'を含む無関係な単語(chair, said等)を誤検出しない", () => {
  assert.equal(isAiRelated("The chair said the meeting is postponed"), false);
});

test("'A.I.'のようなピリオド付き略記を正しくマッチする(回帰テスト)", () => {
  assert.equal(isAiRelated("Military reliance on A.I. in warfare grows"), true);
  assert.equal(isAiRelated("A.I. is transforming the industry"), true);
  assert.equal(isAiRelated("The report on A.I., published today, is alarming"), true);
  // 文末で句読点が続かないケースも確認
  assert.equal(isAiRelated("Experts debate the ethics of A.I."), true);
});

test("filterAiRelatedは無関係な候補を除外する", () => {
  const items = [
    { title: "OpenAI announces new safety framework" },
    { title: "Local restaurant opens downtown" },
    { title: "New LLM benchmark shows record performance" },
  ];
  const result = filterAiRelated(items);
  assert.equal(result.length, 2);
  assert.ok(result.every((r) => isAiRelated(r.title)));
});
