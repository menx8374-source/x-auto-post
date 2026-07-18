import { test } from "node:test";
import assert from "node:assert/strict";
import { extractOgpMetadata } from "../functions/_lib/ogpMeta";

const BASE_URL = "https://example.com/product/page";

test("extractOgpMetadataはog:title/og:imageの両方がある場合はそれらを使う", () => {
  const html = `
    <html><head>
      <meta property="og:title" content="すごい商品A">
      <meta property="og:image" content="https://example.com/images/a.png">
      <title>別のタイトル(使われない)</title>
    </head></html>
  `;
  const result = extractOgpMetadata(html, BASE_URL);
  assert.equal(result.title, "すごい商品A");
  assert.equal(result.image, "https://example.com/images/a.png");
});

test("extractOgpMetadataはog:titleが無い場合<title>をフォールバックに使う", () => {
  const html = `<html><head><title>フォールバックタイトル</title></head></html>`;
  const result = extractOgpMetadata(html, BASE_URL);
  assert.equal(result.title, "フォールバックタイトル");
});

test("extractOgpMetadataは相対URLのog:imageをbaseUrlを基準に絶対URLへ解決する", () => {
  const html = `<meta property="og:image" content="/images/relative.png">`;
  const result = extractOgpMetadata(html, BASE_URL);
  assert.equal(result.image, "https://example.com/images/relative.png");
});

test("extractOgpMetadataは不正スキームのog:imageをnullにする", () => {
  const html = `<meta property="og:image" content="javascript:alert(1)">`;
  const result = extractOgpMetadata(html, BASE_URL);
  assert.equal(result.image, null);
});

test("extractOgpMetadataは解決不能なog:image(パース不可)をnullにする", () => {
  const html = `<meta property="og:image" content="">`;
  const result = extractOgpMetadata(html, BASE_URL);
  assert.equal(result.image, null);
});

test("extractOgpMetadataはmetaタグが全く無い場合、title/imageともにnullを返す", () => {
  const html = `<html><body><p>本文のみ</p></body></html>`;
  const result = extractOgpMetadata(html, BASE_URL);
  assert.equal(result.title, null);
  assert.equal(result.image, null);
});

test("extractOgpMetadataは空文字列/型不正なhtmlに対して例外を投げずnullを返す", () => {
  assert.deepEqual(extractOgpMetadata("", BASE_URL), { title: null, image: null });
  assert.deepEqual(extractOgpMetadata(undefined as unknown as string, BASE_URL), { title: null, image: null });
});

test("extractOgpMetadataはname属性のog:title/og:imageも受け付ける(property/nameどちらでもよい)", () => {
  const html = `
    <meta name="og:title" content="name属性タイトル">
    <meta name="og:image" content="https://example.com/images/b.png">
  `;
  const result = extractOgpMetadata(html, BASE_URL);
  assert.equal(result.title, "name属性タイトル");
  assert.equal(result.image, "https://example.com/images/b.png");
});

test("extractOgpMetadataはHTMLエンティティをデコードする", () => {
  const html = `<meta property="og:title" content="A&amp;B &quot;すごい&quot;商品">`;
  const result = extractOgpMetadata(html, BASE_URL);
  assert.equal(result.title, 'A&B "すごい"商品');
});

test("extractOgpMetadataはダブルクォート値中のアポストロフィで途中で切れない(/code-review CONFIRMED回帰テスト)", () => {
  const html = `<meta property="og:title" content="Trader Joe's Coffee">`;
  const result = extractOgpMetadata(html, BASE_URL);
  assert.equal(result.title, "Trader Joe's Coffee");
});

test("extractOgpMetadataはシングルクォート値中のダブルクォートで途中で切れない", () => {
  const html = `<meta property='og:title' content='すごい"商品"の紹介'>`;
  const result = extractOgpMetadata(html, BASE_URL);
  assert.equal(result.title, 'すごい"商品"の紹介');
});

test("extractOgpMetadataはダブルクォート値中にアポストロフィを含むog:imageも正しくURL解決する", () => {
  const html = `<meta property="og:image" content="https://example.com/images/joe's.png">`;
  const result = extractOgpMetadata(html, BASE_URL);
  assert.equal(result.image, "https://example.com/images/joe's.png");
});
