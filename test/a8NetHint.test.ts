import { test } from "node:test";
import assert from "node:assert/strict";
import { matchKnownAdvertiser, scanHtmlForA8NetLinks, KNOWN_A8_ADVERTISERS } from "../src/a8NetHint.js";

test("matchKnownAdvertiserは完全一致するブランド名で一致するエントリを返す", () => {
  const result = matchKnownAdvertiser("Amazon");
  assert.deepEqual(result, { name: "Amazon", a8AdvertiserId: "s00000009884" });
});

test("matchKnownAdvertiserは商品名の一部にブランド名が含まれる場合も一致する", () => {
  const result = matchKnownAdvertiser("楽天市場で買えるおすすめガジェット");
  assert.deepEqual(result, { name: "楽天市場", a8AdvertiserId: "s00000011623" });
});

test("matchKnownAdvertiserは大小文字を区別しない", () => {
  const result = matchKnownAdvertiser("amazon echo dot");
  assert.deepEqual(result, { name: "Amazon", a8AdvertiserId: "s00000009884" });
});

test("matchKnownAdvertiserは全角/半角の表記ゆれを吸収する", () => {
  const result = matchKnownAdvertiser("Ａｍａｚｏｎのセール情報");
  assert.deepEqual(result, { name: "Amazon", a8AdvertiserId: "s00000009884" });
});

test("matchKnownAdvertiserは一致するブランドが無い場合nullを返す", () => {
  assert.equal(matchKnownAdvertiser("無名のAIツール"), null);
});

test("matchKnownAdvertiserは空文字列/空白のみの場合nullを返す", () => {
  assert.equal(matchKnownAdvertiser(""), null);
  assert.equal(matchKnownAdvertiser("   "), null);
});

test("KNOWN_A8_ADVERTISERSは5件程度のエントリを持つ(過剰な推測ブランド名を作らない方針の確認)", () => {
  assert.ok(KNOWN_A8_ADVERTISERS.length >= 1);
  assert.ok(KNOWN_A8_ADVERTISERS.length <= 10);
});

test("scanHtmlForA8NetLinksはa8.netドメインへのリンクがある場合trueを返す", () => {
  const html = `<html><body><a href="https://support.a8.net/as/HintOfProgram/selection.php">A8.net</a></body></html>`;
  assert.equal(scanHtmlForA8NetLinks(html), true);
});

test("scanHtmlForA8NetLinksはa8.netのサブドメイン(px.a8.net等)へのリンクも検知する", () => {
  const html = `<a href="https://px.a8.net/svt/ejp?a8mat=xxxx">アフィリエイトはこちら</a>`;
  assert.equal(scanHtmlForA8NetLinks(html), true);
});

test("scanHtmlForA8NetLinksはシングルクォート属性値でも検知する", () => {
  const html = `<a href='https://www.a8.net/'>A8.net</a>`;
  assert.equal(scanHtmlForA8NetLinks(html), true);
});

test("scanHtmlForA8NetLinksはa8.netドメインへのリンクが無い場合falseを返す", () => {
  const html = `<html><body><a href="https://example.com/about">About</a></body></html>`;
  assert.equal(scanHtmlForA8NetLinks(html), false);
});

test("scanHtmlForA8NetLinksは似た名前だが別ドメイン(例: notreallya8.net.evil.com)を誤検知しない", () => {
  const html = `<a href="https://notreallya8.net.evil.com/">似ているが別ドメイン</a>`;
  assert.equal(scanHtmlForA8NetLinks(html), false);
});

test("scanHtmlForA8NetLinksは空文字列/型不正な入力でfalseを返す(例外を投げない)", () => {
  assert.equal(scanHtmlForA8NetLinks(""), false);
  // @ts-expect-error 型不正な入力に対する防御確認
  assert.equal(scanHtmlForA8NetLinks(null), false);
});

test("scanHtmlForA8NetLinksはhref属性の値がa8.netドメイン中にアポストロフィを含んでいても正しく判定できる(引用符境界の安全策)", () => {
  const html = `<a href="https://a8.net/path?q=it's" data-x="y">A8.net</a>`;
  assert.equal(scanHtmlForA8NetLinks(html), true);
});
