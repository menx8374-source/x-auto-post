import { test } from "node:test";
import assert from "node:assert/strict";
import { selectAffiliateProduct } from "../src/selectAffiliateProduct.js";
import type { AffiliateProduct } from "../src/affiliateProducts.js";
import type { AffiliatePostHistoryEntry } from "../src/affiliateHistory.js";

function product(overrides: Partial<AffiliateProduct> & { id: string }): AffiliateProduct {
  return {
    name: `商品${overrides.id}`,
    officialUrl: `https://example.com/${overrides.id}`,
    affiliateUrl: `https://affiliate.example.com/${overrides.id}`,
    facts: ["特長1"],
    enabled: true,
    ...overrides,
  };
}

function historyEntry(
  overrides: Partial<AffiliatePostHistoryEntry> & { productId: string; productName: string }
): AffiliatePostHistoryEntry {
  return { selectedAt: "2026-07-01T00:00:00.000Z", ...overrides };
}

test("商品リストが空の場合、投稿対象なしとして安全にスキップする", () => {
  const result = selectAffiliateProduct([], [], 3);
  assert.equal(result.selected, null);
  assert.match(result.reason, /商品リストが空/);
  assert.equal(result.consideredCount, 0);
});

test("enabled:trueの商品が0件の場合、投稿対象なしとしてスキップする", () => {
  const products = [product({ id: "p1", enabled: false })];
  const result = selectAffiliateProduct(products, [], 3);
  assert.equal(result.selected, null);
  assert.match(result.reason, /enabled:true.*0件|0件.*enabled/);
  assert.equal(result.enabledCount, 0);
});

test("未投稿の商品が複数ある場合、いずれかを選定する(投稿対象あり)", () => {
  const products = [product({ id: "p1" }), product({ id: "p2" })];
  const result = selectAffiliateProduct(products, [], 3);
  assert.ok(result.selected);
  assert.ok(["p1", "p2"].includes(result.selected!.id));
});

test("最も直近に投稿していない商品(未投稿を最優先)を選ぶ", () => {
  const products = [product({ id: "p1" }), product({ id: "p2" })];
  // p1は投稿済み、p2は未投稿 → p2が優先されるべき
  const history: AffiliatePostHistoryEntry[] = [
    historyEntry({ productId: "p1", productName: "商品p1", status: "posted", postedAt: "2026-07-15T00:00:00.000Z" }),
  ];
  const result = selectAffiliateProduct(products, history, 3);
  assert.equal(result.selected?.id, "p2");
});

test("未投稿の商品が無い場合、最も古く投稿された商品を選ぶ(ローテーション)", () => {
  const products = [product({ id: "p1" }), product({ id: "p2" })];
  const history: AffiliatePostHistoryEntry[] = [
    historyEntry({ productId: "p1", productName: "商品p1", status: "posted", postedAt: "2026-07-16T00:00:00.000Z" }),
    historyEntry({ productId: "p2", productName: "商品p2", status: "posted", postedAt: "2026-07-10T00:00:00.000Z" }),
  ];
  const result = selectAffiliateProduct(products, history, 3);
  assert.equal(result.selected?.id, "p2"); // より古く投稿されたp2が優先される
});

test("同一商品の投稿回数が上限に達している場合、その商品は選定対象から除外される", () => {
  const products = [product({ id: "p1" })];
  const history: AffiliatePostHistoryEntry[] = [
    historyEntry({ productId: "p1", productName: "商品p1", status: "posted", postedAt: "2026-07-01T00:00:00.000Z" }),
    historyEntry({ productId: "p1", productName: "商品p1", status: "posted", postedAt: "2026-07-02T00:00:00.000Z" }),
    historyEntry({ productId: "p1", productName: "商品p1", status: "posted", postedAt: "2026-07-03T00:00:00.000Z" }),
  ];
  const result = selectAffiliateProduct(products, history, 3);
  assert.equal(result.selected, null);
  assert.match(result.reason, /上限/);
});

test("上限に達していない商品と達している商品が混在する場合、達していない方を選ぶ", () => {
  const products = [product({ id: "p1" }), product({ id: "p2" })];
  const history: AffiliatePostHistoryEntry[] = [
    historyEntry({ productId: "p1", productName: "商品p1", status: "posted", postedAt: "2026-07-01T00:00:00.000Z" }),
    historyEntry({ productId: "p1", productName: "商品p1", status: "posted", postedAt: "2026-07-02T00:00:00.000Z" }),
    historyEntry({ productId: "p1", productName: "商品p1", status: "posted", postedAt: "2026-07-03T00:00:00.000Z" }),
  ];
  const result = selectAffiliateProduct(products, history, 3);
  assert.equal(result.selected?.id, "p2");
});

test("maxPostsPerProductを1に指定すると1回投稿済みの商品も除外される", () => {
  const products = [product({ id: "p1" })];
  const history: AffiliatePostHistoryEntry[] = [
    historyEntry({ productId: "p1", productName: "商品p1", status: "posted", postedAt: "2026-07-01T00:00:00.000Z" }),
  ];
  const result = selectAffiliateProduct(products, history, 1);
  assert.equal(result.selected, null);
});
