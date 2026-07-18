import { test } from "node:test";
import assert from "node:assert/strict";
import { A8_TOP_URL, copyTextSafely, buildA8GuideMessage, buildA8SearchUrl } from "../public/a8Search.js";

test("A8_TOP_URLはA8.netの正しいトップページURLである", () => {
  assert.equal(A8_TOP_URL, "https://www.a8.net/");
});

test("buildA8SearchUrlは商品名を付与した検索結果URLを返す", () => {
  const url = buildA8SearchUrl("Notta");
  assert.equal(url, "https://media-console.a8.net/program/search/keyword?keywords=Notta");
});

test("buildA8SearchUrlは商品名をURLエンコードする", () => {
  const url = buildA8SearchUrl("ChatGPT Plus/&テスト");
  assert.equal(
    url,
    `https://media-console.a8.net/program/search/keyword?keywords=${encodeURIComponent("ChatGPT Plus/&テスト")}`,
  );
  assert.doesNotMatch(url, /keywords=ChatGPT Plus/);
});

test("buildA8SearchUrlは商品名が空文字列/未定義の場合A8_TOP_URLにフォールバックする", () => {
  assert.equal(buildA8SearchUrl(""), A8_TOP_URL);
  assert.equal(buildA8SearchUrl(undefined), A8_TOP_URL);
  assert.equal(buildA8SearchUrl("   "), A8_TOP_URL);
});

test("copyTextSafelyはclipboardImpl.writeTextが成功した場合trueを返す", async () => {
  let capturedText = "";
  const clipboard = {
    writeText: async (text: string) => {
      capturedText = text;
    },
  };
  const result = await copyTextSafely("テスト商品", clipboard);
  assert.equal(result, true);
  assert.equal(capturedText, "テスト商品");
});

test("copyTextSafelyはclipboardImplが未指定/nullの場合falseを返す(例外を投げない)", async () => {
  assert.equal(await copyTextSafely("x", undefined), false);
  assert.equal(await copyTextSafely("x", null), false);
});

test("copyTextSafelyはclipboardImpl.writeTextが関数でない場合falseを返す", async () => {
  assert.equal(await copyTextSafely("x", {} as any), false);
});

test("copyTextSafelyはwriteTextが例外/rejectする場合falseを返す(non-secure context等での失敗を安全に劣化させる)", async () => {
  const clipboard = {
    writeText: async () => {
      throw new Error("NotAllowedError");
    },
  };
  const result = await copyTextSafely("x", clipboard);
  assert.equal(result, false);
});

test("buildA8GuideMessageはコピー成功時、商品名を含む案内メッセージを返す", () => {
  const message = buildA8GuideMessage("ChatGPT Plus", true);
  assert.match(message, /ChatGPT Plus/);
  assert.match(message, /コピー済み/);
  assert.match(message, /検索結果ページ/);
});

test("buildA8GuideMessageはコピー失敗時、フォールバックとして商品名をテキストで見える形にする", () => {
  const message = buildA8GuideMessage("ChatGPT Plus", false);
  assert.match(message, /ChatGPT Plus/);
  assert.match(message, /コピー&ペースト/);
  assert.match(message, /検索結果ページ/);
});
