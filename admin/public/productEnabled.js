// 新規商品追加時、有効なアフィリエイトリンクが入力されていれば保存時に自動的に投稿対象(enabled)に
// するための純粋関数。admin/public/app.js(ブラウザ)とadmin/test/(node:testでの単体テスト)の
// 両方から同じロジックをimportして使う(ビルドステップなしで動かすためバンドラは使わない)。

/**
 * 保存時に送信するenabledの値を決定する。
 * - 新規追加(isEditing===false)かつaffiliateUrlが有効なURLの場合: チェックボックスの値に関わらずtrue。
 * - それ以外(既存商品の編集時、またはaffiliateUrlが無効/未入力の場合): チェックボックスの値をそのまま使う。
 *   編集時に自動有効化しないのは、ユーザーが意図的に無効化した商品を編集保存のたびに勝手に
 *   有効化してしまう事故を防ぐため。
 * @param {{isEditing: boolean, checkboxEnabled: boolean, affiliateUrlValid: boolean}} params
 * @returns {boolean}
 */
export function resolveEnabledOnSubmit({ isEditing, checkboxEnabled, affiliateUrlValid }) {
  if (!isEditing && affiliateUrlValid) return true;
  return Boolean(checkboxEnabled);
}
