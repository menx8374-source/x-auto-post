/**
 * アフィリエイト投稿用のスレッド組み立て。
 *
 * 文字数上限厳守・スレッド分割は既存のsrc/threadSplit.ts(splitIntoBodyTweets)・
 * src/tweetLength.ts(calculateTweetLength)をそのまま再利用する(重複実装しない)。
 * リンクツイートの文言のみアフィリエイト用(商品ページへのリンク)に差し替える。
 */
import { calculateTweetLength } from "./tweetLength.js";
import { splitIntoBodyTweets, MAX_BODY_TWEETS, type ThreadTweet } from "./threadSplit.js";

/** アフィリエイトリンクを含むリンクツイートの本文を組み立てる */
export function buildAffiliateLinkTweetText(affiliateUrl: string): string {
  return `商品ページ: ${affiliateUrl}`;
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
