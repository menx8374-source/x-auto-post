#!/usr/bin/env node
/**
 * アフィリエイトリンクの自前リダイレクトページ生成。
 *
 * 過去にTinyURL(`api-create.php`、非推奨API)経由の短縮URLをツイートに使っていたが、
 * このAPI経由で作成したリンクは開くと必ずTinyURL自身の「Preview」ページ(ワンクッション画面)を
 * 経由してしまうことが判明したため廃止した(src/urlShortener.tsは削除済み)。
 *
 * 代わりに、このリポジトリで既に有効になっているGitHub Pages(`docs/`がソース)上に、
 * 商品ごとの静的リダイレクトページ(`docs/go/<productId>.html`)をこのスクリプトで
 * 事前生成し、そのURL(`https://menx8374-source.github.io/x-auto-post/go/<productId>.html`)を
 * ツイートに含める(実行時のネットワーク呼び出しは不要)。
 *
 * 新しい商品を`data/affiliate-products.json`に追加した場合は、このスクリプトを再実行して
 * リダイレクトページを生成し、`docs/go/`配下の差分をコミットする必要がある
 * (README.md「アフィリエイト投稿」節参照)。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";
import { loadAffiliateProducts, type AffiliateProduct } from "./affiliateProducts.js";
import { isHttpUrl } from "./ogpImage.js";

export const AFFILIATE_REDIRECT_OUT_DIR = path.join(process.cwd(), "docs", "go");

/** 出力ファイル名として許可するproduct.idの形式(英数字・ハイフン・アンダースコアのみ)。パストラバーサル対策 */
const SAFE_PRODUCT_ID = /^[a-zA-Z0-9_-]+$/;

/** HTML属性値・テキストとして安全に埋め込めるよう最低限のHTMLエスケープを行う */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 商品1件ぶんのリダイレクトページHTMLを組み立てる。
 * meta refresh(即座) + JavaScriptフォールバック + 手動リンクの3段構えでリダイレクトする。
 */
export function buildRedirectHtml(product: AffiliateProduct): string {
  const safeUrl = escapeHtml(product.affiliateUrl);
  const safeName = escapeHtml(product.name);
  // JavaScript文字列リテラルとして正しくエスケープ(クォート・バックスラッシュ・制御文字等)する。
  // これだけでは`<`がそのまま残るため、HTMLパーサーが`</script`を検出してscript要素を
  // 早期終了させてしまう(Stored XSSにつながる)のを防ぐため、`<`と`>`を追加でエスケープする。
  const jsUrlLiteral = JSON.stringify(product.affiliateUrl)
    .replace(/</g, "\\u003C")
    .replace(/>/g, "\\u003E");

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${safeName}へ移動します</title>
<meta name="description" content="${safeName}の商品ページへ移動します。">
<meta http-equiv="refresh" content="0; url=${safeUrl}">
</head>
<body>
<p>${safeName}の商品ページへ移動しています。自動で移動しない場合は<a href="${safeUrl}">こちらのリンク</a>をクリックしてください。</p>
<script>
window.location.replace(${jsUrlLiteral});
</script>
</body>
</html>
`;
}

/**
 * 商品一覧からリダイレクトページ群を生成し、`outDir`配下に書き出す。
 * affiliateUrlがhttp:/https:以外(例: `javascript:`)の商品は、生成したページの
 * meta refresh/window.location.replace/<a href>がそのスキームをそのまま実行・遷移してしまう
 * (javascript:スキームはページ読み込み時に自動実行される)ため、生成をスキップし警告ログを残す。
 * product.idが英数字・ハイフン・アンダースコア以外の文字を含む場合(パストラバーサル
 * 対策。`../../`等がファイルパス組み立てに使われるのを防ぐ)も同様にスキップする。
 * 1件の不正データのために全体の生成を止めない(既存の設計方針を踏襲)。
 *
 * なお、affiliateUrlのスキーム検証はsrc/affiliateProducts.tsの`filterEnabledProducts`
 * (投稿対象の選定ロジックの入り口)でも同じ`isHttpUrl`を使って行っており、ここでの
 * スキップ対象とselectAffiliateProductの選定対象は常に一致する(不正スキームの商品が
 * ページ生成ではスキップされたのに選定・投稿はされる、というリンク切れ投稿を防ぐため)。
 */
export async function generateRedirectPages(
  products: AffiliateProduct[],
  outDir: string = AFFILIATE_REDIRECT_OUT_DIR
): Promise<{ written: number; skipped: number }> {
  await mkdir(outDir, { recursive: true });

  let written = 0;
  let skipped = 0;
  for (const product of products) {
    if (!SAFE_PRODUCT_ID.test(product.id)) {
      log.warn("skipped affiliate redirect page generation: product.id contains disallowed characters", {
        productId: product.id,
      });
      skipped += 1;
      continue;
    }
    if (!isHttpUrl(product.affiliateUrl)) {
      log.warn("skipped affiliate redirect page generation: affiliateUrl is not http:/https:", {
        productId: product.id,
        affiliateUrl: product.affiliateUrl,
      });
      skipped += 1;
      continue;
    }
    const outFile = path.join(outDir, `${product.id}.html`);
    await writeFile(outFile, buildRedirectHtml(product), "utf-8");
    log.info("wrote affiliate redirect page", { productId: product.id, outFile });
    written += 1;
  }

  log.info(`affiliate redirect page generation finished (${written} product(s), ${skipped} skipped)`, {
    outDir,
  });
  return { written, skipped };
}

/**
 * CLIエントリポイント本体。1件でもスキップがあった場合は`process.exitCode = 1`を設定する
 * (スキップを握りつぶして正常終了扱いにしないため。呼び出し側のCI/cronが気づけるようにする)。
 * テストから呼び出せるよう`filePath`/`outDir`を上書き可能にしている(既定は本番と同じ経路)。
 */
export async function main(
  filePath?: string,
  outDir: string = AFFILIATE_REDIRECT_OUT_DIR
): Promise<{ written: number; skipped: number }> {
  const products = await loadAffiliateProducts(filePath);
  const result = await generateRedirectPages(products, outDir);
  if (result.skipped > 0) {
    log.error(
      `${result.skipped}件スキップされました。data/affiliate-products.jsonを確認してください` +
        "(affiliateUrlがhttp:/https:であること、idが英数字・ハイフン・アンダースコアのみであることを確認してください)"
    );
    process.exitCode = 1;
  }
  return result;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    log.error("fatal error during affiliate redirect page generation", {
      message: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  });
}
