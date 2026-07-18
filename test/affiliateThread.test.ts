import { test } from "node:test";
import assert from "node:assert/strict";
import { composeAffiliateThread, buildAffiliateLinkTweetText } from "../src/affiliateThread.js";
import { TWEET_CHAR_LIMIT } from "../src/tweetLength.js";

test("composeAffiliateThreadは短い本文なら本文1件+リンク1件の計2件を返す", () => {
  const tweets = composeAffiliateThread("【PR】これは短い紹介文です。", "https://affiliate.example.com/p1");
  assert.equal(tweets.length, 2);
  assert.equal(tweets[0].kind, "body");
  assert.equal(tweets[1].kind, "link");
  assert.match(tweets[1].text, /https:\/\/affiliate\.example\.com\/p1/);
});

test("composeAffiliateThreadは各ツイートが文字数上限以内に収まる", () => {
  const longBody = `【PR】${"紹介文の本文です。".repeat(60)}`;
  const tweets = composeAffiliateThread(longBody, "https://affiliate.example.com/p1");
  for (const tweet of tweets) {
    assert.ok(tweet.charLength <= TWEET_CHAR_LIMIT);
  }
});

test("buildAffiliateLinkTweetTextはアフィリエイトリンクを含む", () => {
  const text = buildAffiliateLinkTweetText("https://affiliate.example.com/p1");
  assert.match(text, /https:\/\/affiliate\.example\.com\/p1/);
});
