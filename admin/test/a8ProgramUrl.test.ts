import { test } from "node:test";
import assert from "node:assert/strict";
import { parseA8ProgramId, isA8ProgramDetailUrl } from "../functions/_lib/a8ProgramUrl";

test("parseA8ProgramIdはprogramIdクエリパラメータの値を抽出する", () => {
  const url =
    "https://media-console.a8.net/program/detail-not-partnered?programId=s00000024524003&fromSearch=true";
  assert.equal(parseA8ProgramId(url), "s00000024524003");
});

test("parseA8ProgramIdはprogramIdパラメータが無い場合nullを返す", () => {
  assert.equal(parseA8ProgramId("https://media-console.a8.net/program/detail-not-partnered"), null);
});

test("parseA8ProgramIdはprogramIdが空文字列の場合nullを返す", () => {
  assert.equal(parseA8ProgramId("https://media-console.a8.net/program/detail?programId="), null);
});

test("parseA8ProgramIdはパース不能なURLに対してnullを返す(例外を投げない)", () => {
  assert.equal(parseA8ProgramId("not a url"), null);
  assert.equal(parseA8ProgramId(""), null);
});

test("isA8ProgramDetailUrlはa8.netドメイン(サブドメイン含む)のhttp/https URLを許可する", () => {
  assert.equal(
    isA8ProgramDetailUrl("https://media-console.a8.net/program/detail-not-partnered?programId=s1"),
    true
  );
  assert.equal(isA8ProgramDetailUrl("https://a8.net/foo"), true);
  assert.equal(isA8ProgramDetailUrl("http://support.a8.net/foo"), true);
});

test("isA8ProgramDetailUrlはa8.net以外のドメインを拒否する", () => {
  assert.equal(isA8ProgramDetailUrl("https://example.com/program/detail?programId=s1"), false);
  assert.equal(isA8ProgramDetailUrl("https://not-a8.net.evil.com/foo"), false);
});

test("isA8ProgramDetailUrlは不正スキーム・パース不能なURLを拒否する", () => {
  assert.equal(isA8ProgramDetailUrl("javascript:alert(1)"), false);
  assert.equal(isA8ProgramDetailUrl("not a url"), false);
  assert.equal(isA8ProgramDetailUrl(""), false);
});
