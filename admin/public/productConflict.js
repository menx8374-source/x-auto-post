// 新規商品追加時のID衝突チェック用の純粋関数。
// admin/functions/api/products.ts のPOSTハンドラは、idが既存商品と一致する場合は無条件に
// 「更新」として扱い(facts等を含め完全上書き)、作成専用モード・衝突拒否は持たない。
// そのため、アフィリエイトリンク自動解決等から自動生成したidが偶然、既存の有効な商品
// (facts/affiliateUrl設定済み)のidと一致すると、空のドラフト値で警告なく上書き・データ消失
// してしまう。admin/public/app.jsはこの関数を使い、新規追加の送信前にクライアント側で
// 衝突を検知してブロックする。

/**
 * `id`が`products`のいずれかの`id`と一致する場合、その商品を返す。一致が無ければnullを返す。
 * @param {Array<{id: string, name?: string}>} products
 * @param {string} id
 * @returns {{id: string, name?: string} | null}
 */
export function findConflictingProduct(products, id) {
  if (!Array.isArray(products)) return null;
  const found = products.find((p) => p && typeof p === "object" && p.id === id);
  return found || null;
}
