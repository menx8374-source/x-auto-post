import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTextFromHtml } from "../functions/_lib/htmlText";

test("extractTextFromHtmlはscriptタグの内容ごと除去する", () => {
  const html = "<html><body><script>alert('evil');var x=1;</script><p>本文です</p></body></html>";
  const text = extractTextFromHtml(html);
  assert.doesNotMatch(text, /alert/);
  assert.doesNotMatch(text, /var x/);
  assert.match(text, /本文です/);
});

test("extractTextFromHtmlはstyleタグの内容ごと除去する", () => {
  const html = "<style>.foo{color:red}</style><p>価格は1000円</p>";
  const text = extractTextFromHtml(html);
  assert.doesNotMatch(text, /color:red/);
  assert.match(text, /価格は1000円/);
});

test("extractTextFromHtmlはHTMLコメントを除去する", () => {
  const html = "<!-- 内部メモ --><p>公開情報</p>";
  const text = extractTextFromHtml(html);
  assert.doesNotMatch(text, /内部メモ/);
  assert.match(text, /公開情報/);
});

test("extractTextFromHtmlは基本的なHTMLエンティティをデコードする", () => {
  const html = "<p>価格&amp;送料 &lt;無料&gt; &quot;税込&quot;</p>";
  const text = extractTextFromHtml(html);
  assert.match(text, /価格&送料 <無料> "税込"/);
});

test("extractTextFromHtmlは連続する空白を正規化する", () => {
  const html = "<p>特長A    特長B</p>";
  const text = extractTextFromHtml(html);
  assert.match(text, /特長A 特長B/);
});

test("extractTextFromHtmlは非文字列/空文字列の入力に対して空文字列を返す(例外を投げない)", () => {
  assert.equal(extractTextFromHtml(""), "");
  assert.equal(extractTextFromHtml(null as unknown as string), "");
  assert.equal(extractTextFromHtml(undefined as unknown as string), "");
});

test("extractTextFromHtmlはブロック要素ごとに改行して単語がくっつくのを防ぐ", () => {
  const html = "<div>行A</div><div>行B</div>";
  const text = extractTextFromHtml(html);
  assert.equal(text, "行A\n行B");
});
