/**
 * アフィリエイト投稿用のスレッド組み立て。
 *
 * 文字数上限厳守・スレッド分割は既存のsrc/threadSplit.ts(splitIntoBodyTweets)・
 * src/tweetLength.ts(calculateTweetLength)をそのまま再利用する(重複実装しない)。
 * リンクツイートの文言のみアフィリエイト用(商品ページへのリンク)に差し替える。
 */
import { calculateTweetLength } from "./tweetLength.js";
import { splitIntoBodyTweets, MAX_BODY_TWEETS, type ThreadTweet } from "./threadSplit.js";

/**
 * アフィリエイトリンクURLをツイート本文に埋め込む前に正規化する。
 * A8.net等のアフィリエイトトラッキングURLはクエリ文字列にリテラルの`+`(RFC3986上は合法)を
 * 含むことが多いが、X(Twitter)側のツイート内URL検出がこれを正しく解釈できず
 * 「The Tweet contains an invalid URL」として投稿自体を拒否するケースを実際に確認した。
 * `+`を`%2B`にパーセントエンコードすることで、URLの意味(遷移先)を変えずにXの検出を回避する。
 *
 * ツイートに実際に埋め込むのは下記`buildAffiliateRedirectUrl`のGitHub Pages固定URL(`+`を含まない)
 * のため、現時点では出番がないが、他の呼び出し元から生のアフィリエイトURLを扱う可能性に備えて残す。
 */
export function normalizeUrlForTweet(url: string): string {
  return url.replace(/\+/g, "%2B");
}

/**
 * アフィリエイト商品ごとの自前リダイレクトページ(`src/generateAffiliateRedirects.ts`が
 * `docs/go/<productId>.html`として静的生成する)のベースURL。
 * このリポジトリで有効になっているGitHub Pages(`docs/`がソース)の公開URLに対応する。
 */
export const AFFILIATE_REDIRECT_BASE_URL = "https://menx8374-source.github.io/x-auto-post/go/";

/**
 * 商品IDから、その商品の自前リダイレクトページURLを機械的に組み立てる。
 * 実行時のネットワーク呼び出し(旧TinyURL経由の動的短縮)は不要。
 */
export function buildAffiliateRedirectUrl(productId: string): string {
  return `${AFFILIATE_REDIRECT_BASE_URL}${productId}.html`;
}

/** アフィリエイトリンクを含むリンクツイートの本文を組み立てる(productIdからリダイレクトURLを組み立てる) */
export function buildAffiliateLinkTweetText(productId: string): string {
  return `商品ページ: ${buildAffiliateRedirectUrl(productId)}`;
}

export interface ComposeAffiliateThreadOptions {
  maxBodyTweets?: number;
}

/**
 * 生成済み本文と商品IDから、投稿予定のツイート配列(本文N件+リンク1件)を組み立てる。
 * 本文側はURLを含まないため文字数計算に影響せず、末尾に必ずアフィリエイトリンクツイートを付与する
 * (「投稿の末尾にアフィリエイトリンクを含める」という要件を、既存のリンクツイート付与パターンに揃えて実装)。
 */
export function composeAffiliateThread(
  bodyText: string,
  productId: string,
  options: ComposeAffiliateThreadOptions = {}
): ThreadTweet[] {
  const bodyTexts = splitIntoBodyTweets(bodyText, options.maxBodyTweets ?? MAX_BODY_TWEETS);
  const parts: { text: string; kind: "body" | "link" }[] = bodyTexts.map((text) => ({
    text,
    kind: "body" as const,
  }));
  parts.push({ text: buildAffiliateLinkTweetText(productId), kind: "link" as const });

  return parts.map((p, i) => ({
    index: i + 1,
    text: p.text,
    charLength: calculateTweetLength(p.text),
    kind: p.kind,
  }));
}
