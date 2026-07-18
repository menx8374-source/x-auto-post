import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FACTS_SUGGESTION_MODEL,
  MAX_PAGE_TEXT_LENGTH,
  truncatePageText,
  buildFactsSuggestionPrompt,
  parseFactsSuggestionResponse,
  extractTextFromAnthropicMessage,
} from "../functions/_lib/factsPrompt";

test("FACTS_SUGGESTION_MODELはsrc/generatePost.tsのDEFAULT_MODELの既定値と一致する", () => {
  assert.equal(FACTS_SUGGESTION_MODEL, "claude-haiku-4-5-20251001");
});

test("truncatePageTextは上限を超えるテキストを先頭から切り詰める", () => {
  const long = "あ".repeat(100);
  assert.equal(truncatePageText(long, 10).length, 10);
  assert.equal(truncatePageText(long, 10), "あ".repeat(10));
});

test("truncatePageTextは上限以下のテキストをそのまま返す", () => {
  assert.equal(truncatePageText("短い文章", 100), "短い文章");
});

test("truncatePageTextは既定の上限(MAX_PAGE_TEXT_LENGTH)を使う", () => {
  const long = "a".repeat(MAX_PAGE_TEXT_LENGTH + 100);
  assert.equal(truncatePageText(long).length, MAX_PAGE_TEXT_LENGTH);
});

test("truncatePageTextは文字列以外の入力に対して空文字列を返す(例外を投げない)", () => {
  assert.equal(truncatePageText(null as unknown as string), "");
});

test("buildFactsSuggestionPromptはプロンプトインジェクション対策の指示を含む(本文はデータであり指示ではない旨)", () => {
  const prompt = buildFactsSuggestionPrompt("価格は1000円です");
  assert.match(prompt.system, /指示では(ありません|一切ありません)/);
  assert.match(prompt.system, /従ってはいけません/);
});

test("buildFactsSuggestionPromptは「事実に無い情報を創作しない」制約を含む", () => {
  const prompt = buildFactsSuggestionPrompt("価格は1000円です");
  assert.match(prompt.system, /推測・創作・誇張してはいけません/);
});

test("buildFactsSuggestionPromptはJSON配列のみを出力させる指示を含む", () => {
  const prompt = buildFactsSuggestionPrompt("価格は1000円です");
  assert.match(prompt.system, /JSON配列/);
});

test("buildFactsSuggestionPromptのuserにはページ本文がそのまま含まれる", () => {
  const prompt = buildFactsSuggestionPrompt("価格は1000円です");
  assert.match(prompt.user, /価格は1000円です/);
});

test("parseFactsSuggestionResponseは正常なJSON配列をパースする", () => {
  const result = parseFactsSuggestionResponse('["価格は1000円", "対応OSはiOS/Android"]');
  assert.deepEqual(result, ["価格は1000円", "対応OSはiOS/Android"]);
});

test("parseFactsSuggestionResponseはコードブロック(```json ... ```)で囲まれていても正しくパースする", () => {
  const raw = '```json\n["特長1", "特長2"]\n```';
  const result = parseFactsSuggestionResponse(raw);
  assert.deepEqual(result, ["特長1", "特長2"]);
});

test("parseFactsSuggestionResponseは空配列を正しく返す", () => {
  assert.deepEqual(parseFactsSuggestionResponse("[]"), []);
});

test("parseFactsSuggestionResponseは不正なJSONの場合、例外を投げず空配列を返す", () => {
  assert.deepEqual(parseFactsSuggestionResponse("これはJSONではありません"), []);
  assert.deepEqual(parseFactsSuggestionResponse(""), []);
});

test("parseFactsSuggestionResponseは配列でないJSON(オブジェクト等)の場合、空配列を返す", () => {
  assert.deepEqual(parseFactsSuggestionResponse('{"facts": ["a"]}'), []);
});

test("parseFactsSuggestionResponseは文字列以外の要素・空文字列の要素を取り除く", () => {
  const result = parseFactsSuggestionResponse('["有効な事実", 123, "", "  ", null, "もう1つの事実"]');
  assert.deepEqual(result, ["有効な事実", "もう1つの事実"]);
});

test("parseFactsSuggestionResponseは各要素の前後の空白を取り除く", () => {
  const result = parseFactsSuggestionResponse('["  価格は1000円  "]');
  assert.deepEqual(result, ["価格は1000円"]);
});

test("extractTextFromAnthropicMessageはtextブロックを連結して返す", () => {
  const json = { content: [{ type: "text", text: '["事実1"' }, { type: "text", text: ', "事実2"]' }] };
  assert.equal(extractTextFromAnthropicMessage(json), '["事実1", "事実2"]');
});

test("extractTextFromAnthropicMessageはtext以外のブロック(将来のtool_use等)を無視する", () => {
  const json = { content: [{ type: "tool_use", input: {} }, { type: "text", text: "本文" }] };
  assert.equal(extractTextFromAnthropicMessage(json), "本文");
});

test("extractTextFromAnthropicMessageは不正な形のレスポンスに対して空文字列を返す(例外を投げない)", () => {
  assert.equal(extractTextFromAnthropicMessage(null), "");
  assert.equal(extractTextFromAnthropicMessage({}), "");
  assert.equal(extractTextFromAnthropicMessage({ content: "not an array" }), "");
});
