import { test } from "node:test";
import assert from "node:assert/strict";
import { composeAffiliateThread, buildAffiliateLinkTweetText, normalizeUrlForTweet } from "../src/affiliateThread.js";
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

test("normalizeUrlForTweetはリテラルの+を%2Bにエンコードする(X APIが「invalid URL」として拒否する実際の不具合の回帰テスト)", () => {
  const raw = "https://px.a8.net/svt/ejp?a8mat=4B83D1+D5X2B6+5QLS+HV7V6";
  const normalized = normalizeUrlForTweet(raw);
  assert.equal(normalized, "https://px.a8.net/svt/ejp?a8mat=4B83D1%2BD5X2B6%2B5QLS%2BHV7V6");
  assert.ok(!normalized.includes("+"));
});

test("buildAffiliateLinkTweetTextはA8.net形式のURL(リテラル+含む)を正規化して埋め込む", () => {
  const text = buildAffiliateLinkTweetText("https://px.a8.net/svt/ejp?a8mat=4B83D1+D5X2B6+5QLS+HV7V6");
  assert.ok(!text.includes("+"), "ツイート本文にリテラルの+が残っていない");
  assert.match(text, /a8mat=4B83D1%2BD5X2B6%2B5QLS%2BHV7V6/);
});
