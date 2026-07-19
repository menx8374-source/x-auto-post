/**
 * アフィリエイト投稿対象の商品を、投稿履歴(ローテーション状態)を見ながら選定するロジック。
 *
 * AIニュースの選定ロジック(src/selectPost.ts、既出記事のURL/実質同一記事の除外)とは目的が異なる
 * 別物として実装する: こちらは「同一商品の投稿回数が上限未満」かつ「なるべく直近に投稿していない
 * 商品」を選ぶ、ローテーション(rotation)方式の選定。
 *
 * 商品リストが空、または有効な商品が0件の場合は「投稿対象なし」として理由付きでスキップする
 * (既存のF2「有効な候補が0件」と同じ設計思想: 例外を投げず、安全にスキップする)。
 *
 * 【投稿回数上限とその例外】ローテーション目的の上限(maxPostsPerProduct)は、あくまで
 * 「他に選べる商品がある場合に同じ商品ばかりにならないようにする」ためのものであり、
 * 上限判定の結果、選べる商品が1件も残らない場合(＝有効な商品が全て上限に達しており、
 * 他に投稿対象が無い場合)は、上限を適用せず有効な商品全体から選び直す(投稿自体を
 * 諦めない)。商品登録数が少ないうちに永久にスキップされ続けることを避けるための設計。
 */
import { filterEnabledProducts, type AffiliateProduct } from "./affiliateProducts.js";
import { countPostedByProduct, lastPostedAtByProduct, type AffiliatePostHistoryEntry } from "./affiliateHistory.js";
import { getAffiliateMaxPostsPerProduct } from "./config.js";

export interface AffiliateSelectionResult {
  /** 選定された商品。投稿対象が無い場合はnull */
  selected: AffiliateProduct | null;
  /** 選定/スキップの理由(ログ・出力用の人間可読な文字列) */
  reason: string;
  /** 登録済み商品の総数(enabled問わず) */
  consideredCount: number;
  /** 投稿対象(enabled:true)の商品数 */
  enabledCount: number;
}

/**
 * 商品リストと履歴から、投稿対象の1件をローテーション方式で選ぶ。
 *
 * 選定順序:
 *   1. 商品リストが空なら投稿対象なし。
 *   2. enabled:trueの商品が0件なら投稿対象なし。
 *   3. 有効な商品のうち、投稿済み(status:"posted")回数がmaxPostsPerProduct未満のものを対象にする。
 *      ただし全ての有効な商品が上限に達している(＝他に選べる商品が無い)場合は、上限を適用せず
 *      有効な商品全体を対象にする(同じ商品の連続投稿を許容してでも、投稿自体は継続する)。
 *   4. 対象の中から、最終投稿日時が最も古い商品(未投稿の商品は最優先)を選ぶ。
 */
export function selectAffiliateProduct(
  products: AffiliateProduct[],
  history: AffiliatePostHistoryEntry[],
  maxPostsPerProduct: number = getAffiliateMaxPostsPerProduct()
): AffiliateSelectionResult {
  const consideredCount = products.length;

  if (consideredCount === 0) {
    return {
      selected: null,
      reason: "商品リストが空のため投稿対象なし(data/affiliate-products.jsonに商品を追加してください)",
      consideredCount,
      enabledCount: 0,
    };
  }

  const enabled = filterEnabledProducts(products);
  if (enabled.length === 0) {
    return {
      selected: null,
      reason: `登録済み商品${consideredCount}件のうち、投稿対象(enabled:true)が0件のためスキップ`,
      consideredCount,
      enabledCount: 0,
    };
  }

  const postedCounts = countPostedByProduct(history);
  const lastPostedAt = lastPostedAtByProduct(history);

  const eligible = enabled.filter((p) => (postedCounts.get(p.id) ?? 0) < maxPostsPerProduct);

  // 上限判定の結果、選べる商品が1件も無い(＝他に投稿対象が無い)場合は上限を適用せず、
  // 有効な商品全体から選び直す(投稿自体をスキップしない)。
  const capBypassed = eligible.length === 0;
  const candidatePool = capBypassed ? enabled : eligible;

  // なるべく直近に投稿していない商品を優先する: 未投稿の商品を最優先とし、
  // 次点は最終投稿日時が古い順(=最も長くローテーションから外れている商品)を選ぶ。
  const sorted = [...candidatePool].sort((a, b) => {
    const aLast = lastPostedAt.get(a.id);
    const bLast = lastPostedAt.get(b.id);
    if (!aLast && !bLast) return 0;
    if (!aLast) return -1;
    if (!bLast) return 1;
    return new Date(aLast).getTime() - new Date(bLast).getTime();
  });

  const selected = sorted[0];
  const reason = capBypassed
    ? `有効な商品${enabled.length}件すべてが投稿回数の上限(${maxPostsPerProduct}回)に達していますが、` +
      `他に投稿対象が無いため上限を適用せず選定を継続(選定商品の投稿済み回数: ${postedCounts.get(selected.id) ?? 0}回)`
    : `有効な商品${enabled.length}件中、投稿回数上限(${maxPostsPerProduct}回)未満の${eligible.length}件から、` +
      `最も直近に投稿していない商品を選定(選定商品の投稿済み回数: ${postedCounts.get(selected.id) ?? 0}回)`;

  return {
    selected,
    reason,
    consideredCount,
    enabledCount: enabled.length,
  };
}
