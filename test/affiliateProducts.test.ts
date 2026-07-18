import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadAffiliateProducts, filterEnabledProducts, type AffiliateProduct } from "../src/affiliateProducts.js";

async function withTempFile(fn: (filePath: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "affiliate-products-test-"));
  const filePath = path.join(dir, "affiliate-products.json");
  try {
    await fn(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("loadAffiliateProductsはファイルが存在しない場合、空配列を返す(エラーにしない)", async () => {
  await withTempFile(async (filePath) => {
    const products = await loadAffiliateProducts(filePath);
    assert.deepEqual(products, []);
  });
});

test("loadAffiliateProductsは空配列のファイルをそのまま読み込める", async () => {
  await withTempFile(async (filePath) => {
    await writeFile(filePath, "[]", "utf-8");
    const products = await loadAffiliateProducts(filePath);
    assert.deepEqual(products, []);
  });
});

test("loadAffiliateProductsは登録済み商品をそのまま読み込める", async () => {
  await withTempFile(async (filePath) => {
    const products: AffiliateProduct[] = [
      {
        id: "p1",
        name: "テスト商品A",
        officialUrl: "https://example.com/a",
        affiliateUrl: "https://affiliate.example.com/a",
        facts: ["特長1", "特長2"],
        enabled: true,
      },
    ];
    await writeFile(filePath, JSON.stringify(products, null, 2), "utf-8");
    const loaded = await loadAffiliateProducts(filePath);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, "p1");
  });
});

test("loadAffiliateProductsはJSON配列でない中身をエラーとして投げる(壊れた設定で進めない)", async () => {
  await withTempFile(async (filePath) => {
    await writeFile(filePath, JSON.stringify({ notAnArray: true }), "utf-8");
    await assert.rejects(() => loadAffiliateProducts(filePath), /JSON配列/);
  });
});

test("loadAffiliateProductsは壊れたJSONをエラーとして投げる", async () => {
  await withTempFile(async (filePath) => {
    await writeFile(filePath, "{ this is not valid json", "utf-8");
    await assert.rejects(() => loadAffiliateProducts(filePath));
  });
});

function product(overrides: Partial<AffiliateProduct> & { id: string; enabled: boolean }): AffiliateProduct {
  return {
    name: "商品",
    officialUrl: "https://example.com",
    affiliateUrl: "https://affiliate.example.com",
    facts: [],
    ...overrides,
  };
}

test("filterEnabledProductsはenabled:trueの商品のみを返す", () => {
  const products = [
    product({ id: "a", enabled: true }),
    product({ id: "b", enabled: false }),
    product({ id: "c", enabled: true }),
  ];
  const enabled = filterEnabledProducts(products);
  assert.deepEqual(
    enabled.map((p) => p.id),
    ["a", "c"]
  );
});
