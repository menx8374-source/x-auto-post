// A8.netへの「申請リンク」機能(機能1)。
//
// A8.netの公式公開ページ(ログイン不要、https://support.a8.net/as/HintOfProgram/selection.php)
// のHTMLソースに実際に埋め込まれているhref値を調査した結果、プログラム検索結果への
// リンクは `https://media-console.a8.net/program/search/keyword?keywords=<キーワード>`
// という形式であることを確認した(推測ではなく、A8.net自身のページに存在する実リンクから
// 抽出したパターン)。このURLに商品名をkeywordsとして付与することで:
// (a) A8.netの検索結果ページ(未ログイン時はログイン再認証画面)を新しいタブで開く
// (b) 対象の商品名をクリップボードにコピーする(ログイン後の貼り付け直し・検索欄への
//     再入力の保険として引き続き有用なため維持)
// (c) 案内メッセージを表示する
// クリップボードAPIが使えない環境(non-secure context等)向けに、コピー失敗時は
// 商品名をテキストで見える形にフォールバック表示する(呼び出し側でalert等を使う)。
//
// 注: A8.netへの自動ログイン・自動提携申請・スクレイピングは行わない(新しいタブで
// URLを開くのみ)。
//
// admin/public/app.js(ブラウザ側)と admin/test/(node:testでの単体テスト)の両方から
// 同じロジックをimportして使う(ビルドステップなしで動かすためバンドラは使わない)。

export const A8_TOP_URL = "https://www.a8.net/";

/**
 * A8.netのプログラム検索結果ページのURLを組み立てる純粋関数。
 * A8.net公式ページ(support.a8.net/as/HintOfProgram/selection.php)のHTMLソースに
 * 実際に存在するhref値から抽出したURLパターンを使用する(推測ではない)。
 * productNameは特殊文字によるURL破損を防ぐため必ずencodeURIComponent()する。
 * @param {string | undefined | null} productName
 * @returns {string} 商品名が空の場合はA8_TOP_URL(トップページ)にフォールバックする
 */
export function buildA8SearchUrl(productName) {
  const trimmed = (productName || "").trim();
  if (!trimmed) return A8_TOP_URL;
  return `https://media-console.a8.net/program/search/keyword?keywords=${encodeURIComponent(trimmed)}`;
}

/**
 * navigator.clipboard.writeText()相当のコピー処理を安全にラップする。
 * clipboard実装(clipboardImpl)を引数で受け取ることでDOM/ブラウザAPIに直接依存させず、
 * テストではモックを注入できるようにする。
 * @param {string} text
 * @param {{writeText: (text: string) => Promise<void>} | undefined | null} clipboardImpl
 * @returns {Promise<boolean>} コピーに成功したらtrue。非対応・失敗時はfalse(例外は投げない)
 */
export async function copyTextSafely(text, clipboardImpl) {
  if (!clipboardImpl || typeof clipboardImpl.writeText !== "function") return false;
  try {
    await clipboardImpl.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * A8.net検索の案内メッセージを組み立てる純粋関数。
 * コピーに成功した場合と、失敗(フォールバック)した場合とでメッセージを分ける。
 * @param {string} name
 * @param {boolean} copied
 * @returns {string}
 */
export function buildA8GuideMessage(name, copied) {
  if (copied) {
    return (
      `A8.netの検索結果ページを新しいタブで開きました(商品名「${name}」はコピー済みです)。` +
      "未ログインの場合はログイン画面が表示されるので、ログイン後にもう一度お試しいただくか、" +
      "コピー済みの商品名を検索欄に貼り付けてください。"
    );
  }
  return (
    "A8.netの検索結果ページを新しいタブで開きました(未ログインの場合はログイン画面が表示されます)。" +
    "クリップボードへのコピーには失敗したため、以下の商品名をご自身で検索欄に" +
    `コピー&ペーストしてください:\n\n${name}`
  );
}
