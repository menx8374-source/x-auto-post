import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSummary } from "../public/summary.js";

test("computeSummaryは商品のenabled/無効件数を正しく集計する", () => {
  const products = [
    { id: "a", enabled: true },
    { id: "b", enabled: true },
    { id: "c", enabled: false },
  ];
  const result = computeSummary(products, []);
  assert.equal(result.enabledCount, 2);
  assert.equal(result.disabledCount, 1);
});

test("computeSummaryはenabledが未定義(falsy)の商品も無効として数える", () => {
  const products = [{ id: "a" }, { id: "b", enabled: false }];
  const result = computeSummary(products, []);
  assert.equal(result.enabledCount, 0);
  assert.equal(result.disabledCount, 2);
});

test("computeSummaryは提携申請のapplying/approved件数を正しく集計する", () => {
  const tracking = [
    { id: "1", status: "applying" },
    { id: "2", status: "applying" },
    { id: "3", status: "approved" },
  ];
  const result = computeSummary([], tracking);
  assert.equal(result.applyingCount, 2);
  assert.equal(result.approvedCount, 1);
});

test("computeSummaryは空配列・未指定の場合すべて0を返す", () => {
  assert.deepEqual(computeSummary([], []), {
    enabledCount: 0,
    disabledCount: 0,
    applyingCount: 0,
    approvedCount: 0,
  });
  // @ts-expect-error - 呼び出し側の防御的な扱い(products/trackingが未定義でも例外にならないことを確認)
  assert.deepEqual(computeSummary(undefined, undefined), {
    enabledCount: 0,
    disabledCount: 0,
    applyingCount: 0,
    approvedCount: 0,
  });
});

test("computeSummaryは未知のstatus値を無視する(applying/approvedいずれにもカウントしない)", () => {
  const tracking = [{ id: "1", status: "unknown" }];
  const result = computeSummary([], tracking);
  assert.equal(result.applyingCount, 0);
  assert.equal(result.approvedCount, 0);
});
