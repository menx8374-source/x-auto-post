/**
 * アフィリエイト投稿用の商品情報。
 *
 * `data/affiliate-products.json`(git管理対象)に、ユーザーが公式情報をもとに手動で商品を追加する
 * 想定のファイル。`facts`(事実ベースの特長)はAIが自動生成するものではなく、ユーザーが公式サイト等の
 * 一次情報から手動で書く前提(実体験・実利用の捏造を避けるため)。
 *
 * 初期状態は空配列。商品が0件でもエラーにはせず、呼び出し側(選定ロジック)が
 * 「投稿対象なし」として安全にスキップできるようにする(既存のF2「有効な候補が0件」と同じ設計思想)。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { log } from "./logger.js";
import { isHttpUrl } from "./ogpImage.js";

export interface AffiliateProduct {
  /** 一意識別子(ローテーション・投稿履歴の紐付けキー) */
  id: string;
  /** 商品・サービス名 */
  name: string;
  /** 公式サイトURL */
  officialUrl: string;
  /**
   * 商品のメイン画像URL(任意)。公式サイトにog:imageメタタグが無い等の理由でOGP自動取得が
   * できない商品向けに、ユーザーが公式サイト等で確認した画像URLを手動で指定するためのフィールド。
   * 設定されている場合、投稿時はOGP自動取得(officialUrlからのog:image抽出)を行わず、
   * このURLから直接画像をダウンロードする(src/affiliatePipeline.tsの画像取得ロジック参照)。
   */
  imageUrl?: string;
  /** アフィリエイトリンク(ユーザーが実在のアフィリエイトプログラムから手動で取得して入力する) */
  affiliateUrl: string;
  /** 事実ベースの特長・スペックの箇条書き(ユーザーが公式情報から手動で記入する。AIは書かない) */
  facts: string[];
  /** カテゴリ(任意、分類・ログ確認用) */
  category?: string;
  /** trueの場合のみ投稿対象に含める */
  enabled: boolean;
}

export const DEFAULT_AFFILIATE_PRODUCTS_FILE = path.join(process.cwd(), "data", "affiliate-products.json");

/**
 * 商品情報ファイルを読み込む。
 * ファイルが存在しない場合は「商品が未登録」として空配列を返す(エラーにしない)。
 * ファイルの中身がJSON配列でない・パースできない場合は、壊れた設定のまま投稿処理へ進めないため
 * エラーを投げる(loadHistory/loadAffiliateHistoryと同じ「壊れたデータは安全側に倒す」方針)。
 */
export async function loadAffiliateProducts(
  filePath: string = DEFAULT_AFFILIATE_PRODUCTS_FILE
): Promise<AffiliateProduct[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      log.warn("affiliate products file not found; treating as empty product list", { filePath });
      return [];
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`アフィリエイト商品ファイル(${filePath})のJSONパースに失敗しました: ${message}`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`アフィリエイト商品ファイル(${filePath})はJSON配列である必要があります`);
  }
  return parsed as AffiliateProduct[];
}

/**
 * enabled:true、かつaffiliateUrlがhttp:/https:の商品のみを対象にする。
 * src/generateAffiliateRedirects.tsのリダイレクトページ生成も同じ`isHttpUrl`検証で
 * 不正スキーム(例: `javascript:`)の商品をスキップしており、選定側もここで同じ基準を
 * 適用することで、「ページは生成されないのに投稿だけされる(=リンク切れのツイートが
 * 公開される)」不整合を防ぐ。
 */
export function filterEnabledProducts(products: AffiliateProduct[]): AffiliateProduct[] {
  return products.filter((p) => {
    if (p.enabled !== true) return false;
    if (!isHttpUrl(p.affiliateUrl)) {
      log.warn("excluded product from selection: affiliateUrl is not http:/https:", {
        productId: p.id,
        affiliateUrl: p.affiliateUrl,
      });
      return false;
    }
    return true;
  });
}
