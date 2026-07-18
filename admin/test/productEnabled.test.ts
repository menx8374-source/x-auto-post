import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveEnabledOnSubmit } from "../public/productEnabled.js";

test("resolveEnabledOnSubmitは新規追加かつaffiliateUrlが有効な場合、チェックボックスの値に関わらずtrueを返す", () => {
  assert.equal(
    resolveEnabledOnSubmit({ isEditing: false, checkboxEnabled: false, affiliateUrlValid: true }),
    true
  );
  assert.equal(
    resolveEnabledOnSubmit({ isEditing: false, checkboxEnabled: true, affiliateUrlValid: true }),
    true
  );
});

test("resolveEnabledOnSubmitは新規追加でもaffiliateUrlが無効な場合、チェックボックスの値をそのまま返す", () => {
  assert.equal(
    resolveEnabledOnSubmit({ isEditing: false, checkboxEnabled: false, affiliateUrlValid: false }),
    false
  );
  assert.equal(
    resolveEnabledOnSubmit({ isEditing: false, checkboxEnabled: true, affiliateUrlValid: false }),
    true
  );
});

test("resolveEnabledOnSubmitは編集時、affiliateUrlが有効でもチェックボックスの値をそのまま返す(自動有効化しない)", () => {
  assert.equal(
    resolveEnabledOnSubmit({ isEditing: true, checkboxEnabled: false, affiliateUrlValid: true }),
    false
  );
  assert.equal(
    resolveEnabledOnSubmit({ isEditing: true, checkboxEnabled: true, affiliateUrlValid: true }),
    true
  );
});

test("resolveEnabledOnSubmitは編集時、affiliateUrlが無効な場合もチェックボックスの値をそのまま返す", () => {
  assert.equal(
    resolveEnabledOnSubmit({ isEditing: true, checkboxEnabled: false, affiliateUrlValid: false }),
    false
  );
});
