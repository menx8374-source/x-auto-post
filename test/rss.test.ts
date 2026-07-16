import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePublishedAt } from "../src/sources/rss.js";

test("isoDateがあればそれをそのまま使う", () => {
  const result = resolvePublishedAt({ isoDate: "2026-07-15T00:00:00.000Z" });
  assert.equal(result.publishedAt, "2026-07-15T00:00:00.000Z");
  assert.equal(result.publishedAtUnknown, false);
});

test("isoDateが無くpubDateがあればそれをISO8601に変換して使う", () => {
  const result = resolvePublishedAt({ pubDate: "Wed, 15 Jul 2026 00:00:00 GMT" });
  assert.equal(result.publishedAt, "2026-07-15T00:00:00.000Z");
  assert.equal(result.publishedAtUnknown, false);
});

test("isoDateもpubDateも無い場合、収集実行時刻(現在時刻)にはフォールバックせず日付不明として扱う(回帰テスト)", () => {
  const beforeCall = Date.now();
  const result = resolvePublishedAt({});

  assert.equal(result.publishedAtUnknown, true, "日付不明フラグが立つべき");
  // 現在時刻(=最大の新しさ)にフォールバックしていないことを確認。
  // 十分古い固定のプレースホルダ(UNIXエポック)になっているべき。
  const resolvedTime = new Date(result.publishedAt).getTime();
  assert.equal(resolvedTime, new Date(0).getTime(), "publishedAtは固定のプレースホルダ(エポック)であるべき");
  assert.ok(resolvedTime < beforeCall, "publishedAtが収集実行時刻より大幅に古いこと");
});

test("pubDateが不正な文字列の場合も日付不明として扱う", () => {
  const result = resolvePublishedAt({ pubDate: "not-a-valid-date" });
  assert.equal(result.publishedAtUnknown, true);
});
