import { test } from "node:test";
import assert from "node:assert/strict";
import { findConflictingProduct } from "../public/productConflict.js";

test("findConflictingProductはidが一致する既存商品を返す", () => {
  const products = [
    { id: "product1", name: "商品1" },
    { id: "product2", name: "商品2" },
  ];
  const result = findConflictingProduct(products, "product2");
  assert.deepEqual(result, { id: "product2", name: "商品2" });
});

test("findConflictingProductは一致する商品が無い場合nullを返す", () => {
  const products = [{ id: "product1", name: "商品1" }];
  assert.equal(findConflictingProduct(products, "product-new"), null);
});

test("findConflictingProductは空配列に対してnullを返す", () => {
  assert.equal(findConflictingProduct([], "product1"), null);
});

test("findConflictingProductはproductsが配列でない場合、例外を投げずnullを返す", () => {
  assert.equal(findConflictingProduct(null as unknown as never[], "product1"), null);
  assert.equal(findConflictingProduct(undefined as unknown as never[], "product1"), null);
});
