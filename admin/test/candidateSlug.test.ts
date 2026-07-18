import { test } from "node:test";
import assert from "node:assert/strict";
import { slugifyProductName } from "../public/candidateSlug.js";
import { SAFE_PRODUCT_ID } from "../functions/_lib/validate";

test("slugifyProductNameは英数字のみの製品名を小文字のスラッグに変換する", () => {
  assert.equal(slugifyProductName("SuperAI"), "superai");
});

test("slugifyProductNameは空白・記号をハイフンに変換する", () => {
  assert.equal(slugifyProductName("ChatGPT Plus"), "chatgpt-plus");
  assert.equal(slugifyProductName("Notion AI!"), "notion-ai");
});

test("slugifyProductNameは先頭・末尾のハイフンを取り除く", () => {
  assert.equal(slugifyProductName("-Tool Name-"), "tool-name");
});

test("slugifyProductNameは日本語のみの名前の場合、空文字列を返す(ユーザー入力に委ねる)", () => {
  assert.equal(slugifyProductName("日本語ツール"), "");
});

test("slugifyProductNameは文字列以外の入力に対して空文字列を返す(例外を投げない)", () => {
  assert.equal(slugifyProductName(null as unknown as string), "");
  assert.equal(slugifyProductName(undefined as unknown as string), "");
});

test("slugifyProductNameが生成する結果はSAFE_PRODUCT_IDを満たす(空文字列の場合を除く)", () => {
  const names = ["ChatGPT Plus", "SuperAI Tool 2.0", "Notion-AI_Pro"];
  for (const name of names) {
    const slug = slugifyProductName(name);
    assert.ok(slug.length > 0, `slug should not be empty for "${name}"`);
    assert.ok(SAFE_PRODUCT_ID.test(slug), `slug "${slug}" should satisfy SAFE_PRODUCT_ID`);
  }
});
