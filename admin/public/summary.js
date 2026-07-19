// サマリーバー(ページ最上部に常時表示する件数集計)のための純粋関数。DOM操作を含まないため、
// admin/public/app.js(ブラウザ)とadmin/test/(node:testでの単体テスト)の両方から
// 同じロジックをimportして使う(ビルドステップなしで動かすためバンドラは使わない)。

/**
 * 商品一覧・提携申請一覧から、サマリーバーに表示する件数を集計する。
 * @param {Array<{enabled?: boolean}>} products - state.products相当(各要素は{id, name, enabled, ...})
 * @param {Array<{status?: string}>} tracking - state.tracking相当(各要素は{id, status: "applying"|"approved", ...})
 * @returns {{enabledCount: number, disabledCount: number, applyingCount: number, approvedCount: number}}
 */
export function computeSummary(products, tracking) {
  const productList = Array.isArray(products) ? products : [];
  const trackingList = Array.isArray(tracking) ? tracking : [];

  let enabledCount = 0;
  let disabledCount = 0;
  productList.forEach((product) => {
    if (product && product.enabled) {
      enabledCount += 1;
    } else {
      disabledCount += 1;
    }
  });

  let applyingCount = 0;
  let approvedCount = 0;
  trackingList.forEach((entry) => {
    if (!entry) return;
    if (entry.status === "approved") approvedCount += 1;
    else if (entry.status === "applying") applyingCount += 1;
  });

  return { enabledCount, disabledCount, applyingCount, approvedCount };
}
