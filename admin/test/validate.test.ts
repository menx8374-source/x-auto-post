import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isHttpUrl,
  SAFE_PRODUCT_ID,
  validateProductInput,
  toAffiliateProduct,
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
    programName: "SuperAI Tool",
    a8ProgramUrl: "https://media-console.a8.net/program/detail-not-partnered?programId=s00000024524003",
  });
  assert.equal(result.valid, true);
  assert.equal(result.mode, "create");
});

test("validateApplicationTrackingInputは新規作成時、programNameは任意項目として扱う(未指定/nullは許容、指定する場合は空文字列を拒否)", () => {
  const base = { a8ProgramUrl: "https://media-console.a8.net/program/detail-not-partnered?programId=s1" };
  assert.equal(validateApplicationTrackingInput({ ...base }).valid, true);
  assert.equal(validateApplicationTrackingInput({ ...base, programName: null }).valid, true);
  assert.equal(validateApplicationTrackingInput({ ...base, programName: "" }).valid, false);
  assert.equal(validateApplicationTrackingInput({ ...base, programName: "   " }).valid, false);
  assert.equal(validateApplicationTrackingInput({ ...base, programName: "SuperAI Tool" }).valid, true);
});

test("validateApplicationTrackingInputは新規作成時、a8ProgramUrlが未指定/空文字列の場合拒否する", () => {
  const base = { programName: "SuperAI Tool" };
  assert.equal(validateApplicationTrackingInput({ ...base }).valid, false);
  assert.equal(validateApplicationTrackingInput({ ...base, a8ProgramUrl: "" }).valid, false);
});

test("validateApplicationTrackingInputは新規作成時、a8ProgramUrlがa8.net以外のドメインの場合拒否する", () => {
  const result = validateApplicationTrackingInput({
    programName: "SuperAI Tool",
    a8ProgramUrl: "https://example.com/program/detail?programId=s1",
  });
  assert.equal(result.valid, false);
});

test("validateApplicationTrackingInputは新規作成時、a8ProgramUrlが不正スキームの場合拒否する", () => {
  const result = validateApplicationTrackingInput({
    programName: "SuperAI Tool",
    a8ProgramUrl: "javascript:alert(1)",
  });
  assert.equal(result.valid, false);
});

test("validateApplicationTrackingInputはオブジェクトでない入力を拒否する", () => {
  assert.equal(validateApplicationTrackingInput(null).valid, false);
  assert.equal(validateApplicationTrackingInput("string").valid, false);
});
