// アフィリエイトリンク自動解決・提携申請の進捗記録などから、商品追加フォームの
// 商品ID欄を事前入力するためのスラッグを生成する純粋関数。
// admin/public/app.js(ブラウザ側、ESモジュールとして読み込む)と admin/test/(node:testでの単体テスト)の
// 両方から同じロジックをimportして使う(ビルドステップなしで動かすためバンドラは使わない)。

/**
 * 商品名から、admin/functions/_lib/validate.tsのSAFE_PRODUCT_ID
 * (英数字・ハイフン・アンダースコアのみ)を満たすスラッグを生成する。
 * 日本語名など、変換後に英数字が1文字も残らない場合は空文字列を返す
 * (仕様: 「日本語名の場合は空欄のままにしてユーザーに入力させてよい」)。
 * @param {string} name
 * @returns {string}
 */
export function slugifyProductName(name) {
  if (typeof name !== "string") return "";
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
