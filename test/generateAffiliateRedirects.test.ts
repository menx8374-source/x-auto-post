import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, access, writeFile as writeFileFs } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { escapeHtml, buildRedirectHtml, generateRedirectPages, main } from "../src/generateAffiliateRedirects.js";
import type { AffiliateProduct } from "../src/affiliateProducts.js";

/** process.exitCode を汚さないよう、各テストの前後で退避・復元する */
function withExitCodeIsolation(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const before = process.exitCode;
    process.exitCode = undefined;
    try {
      await fn();
    } finally {
      process.exitCode = before;
    }
  };
}

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

test("escapeHtmlは&/</>/\"/'をエスケープする", () => {
  assert.equal(escapeHtml(`a&b<c>d"e'f`), "a&amp;b&lt;c&gt;d&quot;e&#39;f");
});

test("buildRedirectHtmlはmeta refreshでaffiliateUrlへ即座にリダイレクトする", () => {
  const p = product({ id: "p1", affiliateUrl: "https://affiliate.example.com/p1" });
  const html = buildRedirectHtml(p);
  assert.match(html, /<meta http-equiv="refresh" content="0; url=https:\/\/affiliate\.example\.com\/p1">/);
});

test("buildRedirectHtmlはJavaScriptフォールバック(window.location.replace)を含む", () => {
  const p = product({ id: "p1", affiliateUrl: "https://affiliate.example.com/p1" });
  const html = buildRedirectHtml(p);
  assert.match(html, /window\.location\.replace\("https:\/\/affiliate\.example\.com\/p1"\)/);
});

test("buildRedirectHtmlは手動遷移用の<a href>リンクを含む", () => {
  const p = product({ id: "p1", affiliateUrl: "https://affiliate.example.com/p1" });
  const html = buildRedirectHtml(p);
  assert.match(html, /<a href="https:\/\/affiliate\.example\.com\/p1">/);
});

test("buildRedirectHtmlはaffiliateUrlに&等の特殊文字が含まれてもHTML属性値中はエスケープして壊れたHTMLにならない(A8.net形式の実際のURLで検証)", () => {
  const p = product({
    id: "zenchord1",
    affiliateUrl: "https://px.a8.net/svt/ejp?a8mat=4B83D1+D5X2B6+5QLS+HV7V6&a8ejpredirect=1",
  });
  const html = buildRedirectHtml(p);
  // meta refreshのurl属性値・<a href>属性値中の&は生のままではなく&amp;にエスケープ済み
  assert.match(html, /content="0; url=https:\/\/px\.a8\.net\/svt\/ejp\?a8mat=4B83D1\+D5X2B6\+5QLS\+HV7V6&amp;a8ejpredirect=1"/);
  assert.match(html, /<a href="https:\/\/px\.a8\.net\/svt\/ejp\?a8mat=4B83D1\+D5X2B6\+5QLS\+HV7V6&amp;a8ejpredirect=1">/);
  // JavaScript文字列リテラル中(<script>内)はHTML属性値ではないため、生の&のままで問題ない
  // (JSON.stringifyでJS文字列リテラルとして正しくクォート・エスケープされる)
  assert.match(html, /window\.location\.replace\("https:\/\/px\.a8\.net\/svt\/ejp\?a8mat=4B83D1\+D5X2B6\+5QLS\+HV7V6&a8ejpredirect=1"\)/);
});

test("buildRedirectHtmlはaffiliateUrlに</script>を含む文字列が混入しても生の</scriptがHTMLパーサーレベルでscript要素を早期終了させない(Stored XSS回帰テスト)", () => {
  const malicious = "https://affiliate.example.com/p1</script><script>alert(1)</script>";
  const p = product({ id: "p1", affiliateUrl: malicious });
  const html = buildRedirectHtml(p);

  // <script>...</script>ブロックの中身(window.location.replace呼び出し)を抽出し、
  // その中に生の"</script"(大文字小文字問わず)が含まれていないことを検証する。
  const scriptBlockMatch = html.match(/<script>\n([\s\S]*?)\n<\/script>/);
  assert.ok(scriptBlockMatch, "<script>ブロックが見つかること");
  const scriptBody = scriptBlockMatch![1];
  assert.doesNotMatch(scriptBody, /<\/script/i);

  // HTML全体としては、scriptブロック自体を閉じる正規の</script>が1箇所だけ存在し、
  // それ以外(注入されたペイロード由来)の</script出現がないことを確認する。
  const closingScriptTagCount = (html.match(/<\/script>/gi) || []).length;
  assert.equal(closingScriptTagCount, 1);

  // window.location.replaceへの引数がJSON.stringify + <,>追加エスケープされた
  // 単一の文字列リテラルとして出力されていること(<,>はいずれも\uXXXXとしてエスケープされる)
  assert.match(
    html,
    /window\.location\.replace\("https:\/\/affiliate\.example\.com\/p1\\u003C\/script\\u003E\\u003Cscript\\u003Ealert\(1\)\\u003C\/script\\u003E"\);/
  );
});

test("buildRedirectHtmlのtitleに商品名を含む", () => {
  const p = product({ id: "p1", name: "テスト商品ABC" });
  const html = buildRedirectHtml(p);
  assert.match(html, /<title>テスト商品ABCへ移動します<\/title>/);
});

async function withTempOutDir(fn: (outDir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), "affiliate-redirects-test-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

test("generateRedirectPagesはaffiliateUrlがjavascript:等の不正スキームの商品をスキップし、ページを生成しない(CVE的な自動実行対策)", async () => {
  await withTempOutDir(async (outDir) => {
    const p = product({ id: "evil", affiliateUrl: "javascript:alert(1)" });
    const result = await generateRedirectPages([p], outDir);
    assert.equal(result.written, 0);
    assert.equal(result.skipped, 1);
    assert.equal(await fileExists(path.join(outDir, "evil.html")), false);
  });
});

test("generateRedirectPagesは正常なhttp/https URLの商品は引き続き問題なく生成する", async () => {
  await withTempOutDir(async (outDir) => {
    const p1 = product({ id: "p1", affiliateUrl: "https://affiliate.example.com/p1" });
    const p2 = product({ id: "p2", affiliateUrl: "http://affiliate.example.com/p2" });
    const result = await generateRedirectPages([p1, p2], outDir);
    assert.equal(result.written, 2);
    assert.equal(result.skipped, 0);
    assert.equal(await fileExists(path.join(outDir, "p1.html")), true);
    assert.equal(await fileExists(path.join(outDir, "p2.html")), true);
  });
});

test("generateRedirectPagesは不正スキーム商品と正常商品が混在していても、正常な商品は生成しつつ不正な商品だけをスキップする", async () => {
  await withTempOutDir(async (outDir) => {
    const good = product({ id: "good", affiliateUrl: "https://affiliate.example.com/good" });
    const evil = product({ id: "evil", affiliateUrl: "javascript:alert(document.cookie)" });
    const result = await generateRedirectPages([good, evil], outDir);
    assert.equal(result.written, 1);
    assert.equal(result.skipped, 1);
    const files = await readdir(outDir);
    assert.deepEqual(files.sort(), ["good.html"]);
  });
});

test("generateRedirectPagesはproduct.idにパストラバーサルを含む値の商品をスキップし、ページを生成しない", async () => {
  await withTempOutDir(async (outDir) => {
    const evil = product({ id: "../../evil", affiliateUrl: "https://affiliate.example.com/evil" });
    const result = await generateRedirectPages([evil], outDir);
    assert.equal(result.written, 0);
    assert.equal(result.skipped, 1);
    // outDir配下に何も書き出されていないことを確認する(outDir外への書き込みも発生しない設計)
    const files = await readdir(outDir);
    assert.deepEqual(files, []);
  });
});

test("generateRedirectPagesはproduct.idが英数字・ハイフン・アンダースコアのみの正常な形式であれば引き続き生成する", async () => {
  await withTempOutDir(async (outDir) => {
    const p = product({ id: "good-product_1", affiliateUrl: "https://affiliate.example.com/good" });
    const result = await generateRedirectPages([p], outDir);
    assert.equal(result.written, 1);
    assert.equal(result.skipped, 0);
    assert.equal(await fileExists(path.join(outDir, "good-product_1.html")), true);
  });
});

async function withTempProductsFile(
  products: AffiliateProduct[],
  fn: (filePath: string, outDir: string) => Promise<void>
) {
  const dir = await mkdtemp(path.join(tmpdir(), "affiliate-redirects-main-test-"));
  const filePath = path.join(dir, "affiliate-products.json");
  const outDir = path.join(dir, "go");
  try {
    await writeFileFs(filePath, JSON.stringify(products), "utf-8");
    await fn(filePath, outDir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test(
  "main()はスキップが1件でもあればprocess.exitCodeを1に設定する",
  withExitCodeIsolation(async () => {
    const evil = product({ id: "evil", affiliateUrl: "javascript:alert(1)" });
    await withTempProductsFile([evil], async (filePath, outDir) => {
      const result = await main(filePath, outDir);
      assert.equal(result.skipped, 1);
      assert.equal(process.exitCode, 1);
    });
  })
);

test(
  "main()はスキップが0件であればprocess.exitCodeを変更しない",
  withExitCodeIsolation(async () => {
    const good = product({ id: "good", affiliateUrl: "https://affiliate.example.com/good" });
    await withTempProductsFile([good], async (filePath, outDir) => {
      const result = await main(filePath, outDir);
      assert.equal(result.skipped, 0);
      assert.equal(process.exitCode, undefined, "成功時はexitCodeを変更しない");
    });
  })
);
