import { test } from "node:test";
import assert from "node:assert/strict";
import {
  composeAffiliateThread,
  buildAffiliateLinkTweetText,
  buildAffiliateRedirectUrl,
  normalizeUrlForTweet,
  AFFILIATE_REDIRECT_BASE_URL,
} from "../src/affiliateThread.js";
import { TWEET_CHAR_LIMIT } from "../src/tweetLength.js";

test("composeAffiliateThreadは短い本文なら本文1件+リンク1件の計2件を返す", () => {
  const tweets = composeAffiliateThread("【PR】これは短い紹介文です。", "p1");
  assert.equal(tweets.length, 2);
  assert.equal(tweets[0].kind, "body");
  assert.equal(tweets[1].kind, "link");
  assert.match(tweets[1].text, /https:\/\/menx8374-source\.github\.io\/x-auto-post\/go\/p1\.html/);
});

test("composeAffiliateThreadは各ツイートが文字数上限以内に収まる", () => {
  const longBody = `【PR】${"紹介文の本文です。".repeat(60)}`;
  const tweets = composeAffiliateThread(longBody, "p1");
  for (const tweet of tweets) {
    assert.ok(tweet.charLength <= TWEET_CHAR_LIMIT);
  }
});

test("buildAffiliateRedirectUrlは商品IDから固定のGitHub Pages URLを機械的に組み立てる", () => {
  const url = buildAffiliateRedirectUrl("zenchord1");
  assert.equal(url, "https://menx8374-source.github.io/x-auto-post/go/zenchord1.html");
  assert.equal(url, `${AFFILIATE_REDIRECT_BASE_URL}zenchord1.html`);
});

test("buildAffiliateLinkTweetTextは商品IDから組み立てたリダイレクトURLを含む(動的な短縮APIは呼ばない)", () => {
  const text = buildAffiliateLinkTweetText("zenchord1");
  assert.match(text, /https:\/\/menx8374-source\.github\.io\/x-auto-post\/go\/zenchord1\.html/);
});

test("normalizeUrlForTweetはリテラルの+を%2Bにエンコードする(X APIが「invalid URL」として拒否する実際の不具合の回帰テスト)", () => {
  const raw = "https://px.a8.net/svt/ejp?a8mat=4B83D1+D5X2B6+5QLS+HV7V6";
  const normalized = normalizeUrlForTweet(raw);
  assert.equal(normalized, "https://px.a8.net/svt/ejp?a8mat=4B83D1%2BD5X2B6%2B5QLS%2BHV7V6");
  assert.ok(!normalized.includes("+"));
});
