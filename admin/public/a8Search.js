// A8.netへの「申請リンク」機能(機能1)。
//
// A8.netのプログラム検索はログイン後の管理画面内にあり、公式にURLパラメータ形式が
// 公開されていないため、商品名を付与した検索結果への直リンクは作れない(推測でURLを
// 作ると壊れたリンクになるリスクがあるため作らないと合意済み)。代わりに:
// (a) A8.netのトップページを新しいタブで開く
// (b) 対象の商品名をクリップボードにコピーする
// (c) 案内メッセージを表示する
// クリップボードAPIが使えない環境(non-secure context等)向けに、コピー失敗時は
// 商品名をテキストで見える形にフォールバック表示する(呼び出し側でalert等を使う)。
//
// admin/public/app.js(ブラウザ側)と admin/test/(node:testでの単体テスト)の両方から
// 同じロジックをimportして使う(ビルドステップなしで動かすためバンドラは使わない)。

export const A8_TOP_URL = "https://www.a8.net/";

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
      `商品名「${name}」をコピーしました。A8.netにログイン後、` +
      "プログラム検索に貼り付けて検索してください。"
    );
  }
  return (
    "クリップボードへのコピーに失敗しました。以下の商品名をA8.netのプログラム検索に" +
    `ご自身でコピー&ペーストしてください:\n\n${name}`
  );
}
