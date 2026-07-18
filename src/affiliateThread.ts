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
 */
export function normalizeUrlForTweet(url: string): string {
  return url.replace(/\+/g, "%2B");
}

/** アフィリエイトリンクを含むリンクツイートの本文を組み立てる */
export function buildAffiliateLinkTweetText(affiliateUrl: string): string {
  return `商品ページ: ${normalizeUrlForTweet(affiliateUrl)}`;
}

export interface ComposeAffiliateThreadOptions {
  maxBodyTweets?: number;
}

/**
 * 生成済み本文とアフィリエイトリンクから、投稿予定のツイート配列(本文N件+リンク1件)を組み立てる。
 * 本文側はURLを含まないため文字数計算に影響せず、末尾に必ずアフィリエイトリンクツイートを付与する
 * (「投稿の末尾にアフィリエイトリンクを含める」という要件を、既存のリンクツイート付与パターンに揃えて実装)。
 */
export function composeAffiliateThread(
  bodyText: string,
  affiliateUrl: string,
  options: ComposeAffiliateThreadOptions = {}
): ThreadTweet[] {
  const bodyTexts = splitIntoBodyTweets(bodyText, options.maxBodyTweets ?? MAX_BODY_TWEETS);
  const parts: { text: string; kind: "body" | "link" }[] = bodyTexts.map((text) => ({
    text,
    kind: "body" as const,
  }));
  parts.push({ text: buildAffiliateLinkTweetText(affiliateUrl), kind: "link" as const });

  return parts.map((p, i) => ({
    index: i + 1,
    text: p.text,
    charLength: calculateTweetLength(p.text),
    kind: p.kind,
  }));
}
