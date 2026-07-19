// 新規商品追加時、商品ID欄が未入力でも保存できるように最終的なidを決定する純粋関数。
// admin/public/app.js(ブラウザ)とadmin/test/(node:testでの単体テスト)の両方から
// 同じロジックをimportして使う(ビルドステップなしで動かすためバンドラは使わない)。

/**
 * 保存時に送信するidを決定する。
 * - rawId(フォームの入力値)が空でなければそれをそのまま使う。
 * - 編集時(isEditing===true)は、rawIdが空でも自動生成しない(id欄はreadOnly化されており
 *   既存商品のidがそのまま入っているはずのため、空になるのは想定外の状態)。
 * - 新規追加(isEditing===false)でrawIdが空の場合、商品名(name)からスラッグを自動生成する
 *   (`admin/public/candidateSlug.js`の`slugifyProductName`と同じ規則、SAFE_PRODUCT_ID互換)。
 * - 日本語名など、変換後に英数字が1文字も残らない場合(slugifyNameがそれでも空文字列を返す場合)は、
 *   `generateFallbackId`(既定はcrypto.randomUUID()の先頭8桁の16進数)で一意な短い識別子を生成する。
 * @param {{rawId: string, isEditing: boolean, name: string, slugifyName: (name: string) => string, generateFallbackId?: () => string}} params
 * @returns {string}
 */
export function resolveProductId({ rawId, isEditing, name, slugifyName, generateFallbackId }) {
  if (rawId) return rawId;
  if (isEditing) return rawId;
  const slug = slugifyName(name);
  if (slug) return slug;
  const fallback = generateFallbackId || defaultGenerateFallbackId;
  return fallback();
}

function defaultGenerateFallbackId() {
  return `item-${crypto.randomUUID().split("-")[0]}`;
}
