import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateTweetLength, fitsInSingleTweet, TWEET_CHAR_LIMIT, URL_WEIGHT } from "../src/tweetLength.js";

test("calculateTweetLengthは半角文字を1文字1として数える", () => {
  assert.equal(calculateTweetLength("abc"), 3);
  assert.equal(calculateTweetLength("Hello, World!"), "Hello, World!".length);
});

test("calculateTweetLengthは全角文字(ひらがな・漢字)を1文字2として数える", () => {
  assert.equal(calculateTweetLength("あいう"), 6);
  assert.equal(calculateTweetLength("日本語"), 6);
  assert.equal(calculateTweetLength("カタカナ"), 8);
});

test("calculateTweetLengthは半角・全角混在文字列を正しく合算する", () => {
  // "AI" (半角2) + "が" (全角2 -> 重み2) + "進化" (全角2文字 -> 重み4)
  assert.equal(calculateTweetLength("AIが進化"), 2 + 2 + 4);
});

test("calculateTweetLengthはURLを実際の長さに関わらず固定重み(URL_WEIGHT)として数える", () => {
  const shortUrl = "https://x.co/a";
  const longUrl = "https://example.com/very/long/path/that/keeps/going/and/going/2026/07/16/article-slug";
  assert.equal(calculateTweetLength(shortUrl), URL_WEIGHT);
  assert.equal(calculateTweetLength(longUrl), URL_WEIGHT);
});

test("calculateTweetLengthは前後にテキストがあるURL混在文でもURL部分だけ固定重みにする", () => {
  const text = "詳細はこちら https://example.com/article です";
  const withoutUrl = "詳細はこちら  です"; // URL部分を空文字に置き換えた場合との比較用
  const expected = calculateTweetLength(withoutUrl) + URL_WEIGHT;
  assert.equal(calculateTweetLength(text), expected);
});

test("fitsInSingleTweetは境界値(ちょうど280)でtrue、281でfalseを返す(半角のみ)", () => {
  const exactly280 = "a".repeat(280);
  const over281 = "a".repeat(281);
  assert.equal(calculateTweetLength(exactly280), 280);
  assert.equal(fitsInSingleTweet(exactly280), true);
  assert.equal(calculateTweetLength(over281), 281);
  assert.equal(fitsInSingleTweet(over281), false);
});

test("fitsInSingleTweetは境界値(ちょうど280)でtrue、超過でfalseを返す(全角のみ、140文字=280重み)", () => {
  const exactly140Wide = "あ".repeat(140); // 140 * 2 = 280
  const over141Wide = "あ".repeat(141); // 141 * 2 = 282
  assert.equal(calculateTweetLength(exactly140Wide), TWEET_CHAR_LIMIT);
  assert.equal(fitsInSingleTweet(exactly140Wide), true);
  assert.equal(calculateTweetLength(over141Wide), 282);
  assert.equal(fitsInSingleTweet(over141Wide), false);
});
