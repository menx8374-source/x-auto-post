import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveProductId } from "../public/productId.js";

const slugifyName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

test("resolveProductIdはrawIdが指定されていればそのまま返す", () => {
  const id = resolveProductId({ rawId: "my-product", isEditing: false, name: "何か", slugifyName });
  assert.equal(id, "my-product");
});

test("resolveProductIdは編集時、rawIdが空でも自動生成しない", () => {
  const id = resolveProductId({ rawId: "", isEditing: true, name: "何か", slugifyName });
  assert.equal(id, "");
});

test("resolveProductIdは新規追加時、rawIdが空なら商品名からスラッグを生成する", () => {
  const id = resolveProductId({ rawId: "", isEditing: false, name: "Super AI Tool", slugifyName });
  assert.equal(id, "super-ai-tool");
});

test("resolveProductIdは新規追加時、rawIdもスラッグも空ならフォールバック関数を使う", () => {
  const id = resolveProductId({
    rawId: "",
    isEditing: false,
    name: "日本語のみの商品名",
    slugifyName,
    generateFallbackId: () => "item-abcd1234",
  });
  assert.equal(id, "item-abcd1234");
});
