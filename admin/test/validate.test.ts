import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isHttpUrl,
  SAFE_PRODUCT_ID,
  validateProductInput,
  toAffiliateProduct,
  isValidA8NetHint,
  isValidTrackingStatus,
  validateApplicationTrackingInput,
} from "../functions/_lib/validate";

test("isHttpUrlはhttp/httpsのURLを許可する", () => {
  assert.equal(isHttpUrl("https://example.com/foo"), true);
  assert.equal(isHttpUrl("http://example.com/foo"), true);
});

test("isHttpUrlはjavascript:等の不正スキームを拒否する(XSS対策)", () => {
  assert.equal(isHttpUrl("javascript:alert(1)"), false);
  assert.equal(isHttpUrl("file:///etc/passwd"), false);
  assert.equal(isHttpUrl("data:text/html,<script>alert(1)</script>"), false);
});

test("isHttpUrlはパースできない文字列に対してfalseを返す(例外を投げない)", () => {
  assert.equal(isHttpUrl("not a url"), false);
  assert.equal(isHttpUrl(""), false);
});

test("SAFE_PRODUCT_IDは英数字・ハイフン・アンダースコアのみを許可する", () => {
  assert.equal(SAFE_PRODUCT_ID.test("product-1_A"), true);
  assert.equal(SAFE_PRODUCT_ID.test("../../evil"), false);
  assert.equal(SAFE_PRODUCT_ID.test("has space"), false);
  assert.equal(SAFE_PRODUCT_ID.test("has/slash"), false);
});

function validProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: "product1",
    name: "テスト商品",
    officialUrl: "https://example.com",
    affiliateUrl: "https://affiliate.example.com/p1",
    facts: ["特長1"],
    enabled: true,
    ...overrides,
  };
}

test("validateProductInputは正常な入力を受理する(errors=[])", () => {
  const result = validateProductInput(validProduct());
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});

test("validateProductInputは任意項目(imageUrl/category)を省略しても受理する", () => {
  const result = validateProductInput(validProduct());
  assert.equal(result.valid, true);
});

test("validateProductInputはオブジェクトでない入力を拒否する", () => {
  assert.equal(validateProductInput(null).valid, false);
  assert.equal(validateProductInput("string").valid, false);
  assert.equal(validateProductInput([1, 2, 3]).valid, false);
});

test("validateProductInputは不正な商品ID(パストラバーサル)を拒否する", () => {
  const result = validateProductInput(validProduct({ id: "../../evil" }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("id")));
});

test("validateProductInputはidが空文字/未指定の場合拒否する", () => {
  assert.equal(validateProductInput(validProduct({ id: "" })).valid, false);
  const { id, ...rest } = validProduct();
  assert.equal(validateProductInput(rest).valid, false);
});

test("validateProductInputはaffiliateUrlがjavascript:の場合拒否する(不正スキーム対策)", () => {
  const result = validateProductInput(validProduct({ affiliateUrl: "javascript:alert(1)" }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("affiliateUrl")));
});

test("validateProductInputはofficialUrlがjavascript:の場合拒否する", () => {
  const result = validateProductInput(validProduct({ officialUrl: "javascript:alert(1)" }));
  assert.equal(result.valid, false);
});

test("validateProductInputはimageUrlを指定する場合、不正スキームを拒否する", () => {
  const result = validateProductInput(validProduct({ imageUrl: "javascript:alert(1)" }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("imageUrl")));
});

test("validateProductInputはimageUrlが正しいhttp/httpsであれば受理する", () => {
  const result = validateProductInput(validProduct({ imageUrl: "https://example.com/img.png" }));
  assert.equal(result.valid, true);
});

test("validateProductInputはfactsが空配列の場合拒否する", () => {
  const result = validateProductInput(validProduct({ facts: [] }));
  assert.equal(result.valid, false);
});

test("validateProductInputはfactsが文字列以外を含む場合拒否する", () => {
  const result = validateProductInput(validProduct({ facts: ["ok", 123] }));
  assert.equal(result.valid, false);
});

test("validateProductInputはenabledがbooleanでない場合拒否する", () => {
  const result = validateProductInput(validProduct({ enabled: "true" }));
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("enabled")));
});

test("validateProductInputはnameが空文字の場合拒否する", () => {
  const result = validateProductInput(validProduct({ name: "   " }));
  assert.equal(result.valid, false);
});

test("toAffiliateProductは任意項目が空の場合フィールド自体を含めない", () => {
  const product = toAffiliateProduct(validProduct());
  assert.equal("imageUrl" in product, false);
  assert.equal("category" in product, false);
});

test("toAffiliateProductは指定された任意項目を含める", () => {
  const product = toAffiliateProduct(
    validProduct({ imageUrl: "https://example.com/img.png", category: "ガジェット" })
  );
  assert.equal(product.imageUrl, "https://example.com/img.png");
  assert.equal(product.category, "ガジェット");
});

test("isValidA8NetHintはknown_brand/site_link_found/unknownの3種類を受理する", () => {
  assert.equal(isValidA8NetHint({ type: "known_brand", a8AdvertiserId: "s00000011623" }), true);
  assert.equal(isValidA8NetHint({ type: "site_link_found" }), true);
  assert.equal(isValidA8NetHint({ type: "unknown" }), true);
});

test("isValidA8NetHintはknown_brandでa8AdvertiserIdが無い/不正な場合拒否する", () => {
  assert.equal(isValidA8NetHint({ type: "known_brand" }), false);
  assert.equal(isValidA8NetHint({ type: "known_brand", a8AdvertiserId: "" }), false);
});

test("isValidA8NetHintは未知のtype・オブジェクトでない入力を拒否する", () => {
  assert.equal(isValidA8NetHint({ type: "does_not_exist" }), false);
  assert.equal(isValidA8NetHint(null), false);
  assert.equal(isValidA8NetHint("known_brand"), false);
});

test("isValidTrackingStatusは applying/approved のみ許可する", () => {
  assert.equal(isValidTrackingStatus("applying"), true);
  assert.equal(isValidTrackingStatus("approved"), true);
  assert.equal(isValidTrackingStatus("rejected"), false);
  assert.equal(isValidTrackingStatus(undefined), false);
});

test("validateApplicationTrackingInputはid指定時(更新)、statusのみを検証しmode:updateを返す", () => {
  const result = validateApplicationTrackingInput({ id: "entry-1", status: "approved" });
  assert.equal(result.valid, true);
  assert.equal(result.mode, "update");
});

test("validateApplicationTrackingInputはid指定時、statusが不正なら拒否する", () => {
  const result = validateApplicationTrackingInput({ id: "entry-1", status: "invalid" });
  assert.equal(result.valid, false);
});

test("validateApplicationTrackingInputはid未指定時(新規作成)、必須項目を検証しmode:createを返す", () => {
  const result = validateApplicationTrackingInput({
    productName: "SuperAI Tool",
    officialUrl: "https://superai.example.com",
    a8NetHint: { type: "site_link_found" },
    status: "applying",
  });
  assert.equal(result.valid, true);
  assert.equal(result.mode, "create");
});

test("validateApplicationTrackingInputは新規作成時、officialUrlが不正スキームの場合拒否する", () => {
  const result = validateApplicationTrackingInput({
    productName: "SuperAI Tool",
    officialUrl: "javascript:alert(1)",
    a8NetHint: { type: "unknown" },
    status: "applying",
  });
  assert.equal(result.valid, false);
});

test(
  'validateApplicationTrackingInputは新規作成時、officialUrlが未指定/null/空文字列でも受理する' +
    '(known_brandヒントはofficialUrlGuessが無くても成立するため)',
  () => {
    const base = {
      productName: "楽天市場",
      a8NetHint: { type: "known_brand", a8AdvertiserId: "s00000011623" },
      status: "applying",
    };
    assert.equal(validateApplicationTrackingInput({ ...base }).valid, true); // officialUrl未指定
    assert.equal(validateApplicationTrackingInput({ ...base, officialUrl: null }).valid, true);
    assert.equal(validateApplicationTrackingInput({ ...base, officialUrl: "" }).valid, true);
  }
);

test("validateApplicationTrackingInputはオブジェクトでない入力を拒否する", () => {
  assert.equal(validateApplicationTrackingInput(null).valid, false);
  assert.equal(validateApplicationTrackingInput("string").valid, false);
});
