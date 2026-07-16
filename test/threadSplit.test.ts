import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitIntoBodyTweets,
  composeThread,
  buildLinkTweetText,
  MAX_BODY_TWEETS,
} from "../src/threadSplit.js";
import { calculateTweetLength, TWEET_CHAR_LIMIT } from "../src/tweetLength.js";

test("splitIntoBodyTweetsは上限内の短文をそのまま単一ツイートとして返す(順序表記なし)", () => {
  const text = "OpenAIが新しいモデルを発表した。従来より高速に応答できるという。";
  const result = splitIntoBodyTweets(text);
  assert.equal(result.length, 1);
  assert.equal(result[0], text);
  assert.doesNotMatch(result[0], /\(\d+\/\d+\)/);
});

test("splitIntoBodyTweetsは境界値(ちょうど280)で単一ツイート、281で複数ツイートに分割する", () => {
  const exactly280 = "a".repeat(280);
  const singleResult = splitIntoBodyTweets(exactly280);
  assert.equal(singleResult.length, 1);
  assert.equal(calculateTweetLength(singleResult[0]), 280);

  const over281 = "a".repeat(281);
  const splitResult = splitIntoBodyTweets(over281);
  assert.ok(splitResult.length >= 2, "281文字は複数ツイートに分割されるべき");
  for (const tweet of splitResult) {
    assert.ok(
      calculateTweetLength(tweet) <= TWEET_CHAR_LIMIT,
      `分割後の各ツイートは上限(${TWEET_CHAR_LIMIT})以内であるべき: ${calculateTweetLength(tweet)}`
    );
  }
});

test("splitIntoBodyTweetsは超過時に文単位(句点)で分割し、各ツイートが上限内に収まる", () => {
  // 全角80文字(重み160)の文を4つ連結(合計重み640)。1文ずつは十分短いため、文の途中では切れないはず。
  const sentence = (n: number) => `これは${n}番目のテスト用の文章です。人工知能に関する最新の話題を含む長めの一文をここに置いています。`;
  const text = [sentence(1), sentence(2), sentence(3), sentence(4)].join("");

  const result = splitIntoBodyTweets(text);
  assert.ok(result.length > 1, "上限を超える長文は複数ツイートに分割されるべき");

  for (const tweet of result) {
    assert.ok(calculateTweetLength(tweet) <= TWEET_CHAR_LIMIT);
  }

  // 分割された各ツイート(順序表記を除いた本文部分)が、元の文単位の区切り(句点直後)で終わっていること
  // = 文の途中(不自然な位置)で切れていないことの確認
  for (const tweet of result) {
    const bodyPart = tweet.replace(/\n\(\d+\/\d+\)$/, "");
    assert.match(bodyPart, /。$/, `各ツイートは句点で終わるべき: "${bodyPart}"`);
  }
});

test("splitIntoBodyTweetsは全角疑問符(？)のみで区切られた長文でも、単語の途中で強制分割されず文単位で分割する", () => {
  // 句点・読点を使わず全角疑問符(？)のみで文を区切る文体(問いかけを多用するX投稿を想定)。
  // 1文ずつは十分短いため、正しく文単位で分割されれば各ツイートは全角疑問符で終わるはず。
  const sentence = (n: number) =>
    `AIは本当に${n}番目の仕事を奪うのか？人間にしかできないことは何なのか？今後どう向き合うべきなのか？`;
  const text = [sentence(1), sentence(2), sentence(3), sentence(4)].join("");

  const result = splitIntoBodyTweets(text);
  assert.ok(result.length > 1, "上限を超える長文は複数ツイートに分割されるべき");

  for (const tweet of result) {
    assert.ok(calculateTweetLength(tweet) <= TWEET_CHAR_LIMIT);
  }

  for (const tweet of result) {
    const bodyPart = tweet.replace(/\n\(\d+\/\d+\)$/, "");
    assert.match(bodyPart, /？$/, `各ツイートは全角疑問符で終わるべき(単語の途中で切れていないこと): "${bodyPart}"`);
  }
});

test("splitIntoBodyTweetsは各ツイートに1/N形式の順序表記を付け、表記込みで上限内に収まる", () => {
  const text = "とても長い日本語のAIニュース紹介文。".repeat(20);
  const result = splitIntoBodyTweets(text);
  assert.ok(result.length > 1);

  result.forEach((tweet, i) => {
    assert.match(tweet, new RegExp(`\\(${i + 1}/${result.length}\\)$`));
    assert.ok(calculateTweetLength(tweet) <= TWEET_CHAR_LIMIT);
  });
});

test("splitIntoBodyTweetsは極端に長い入力でも規定の上限本数(MAX_BODY_TWEETS)を超えず、末尾が省略記号で丸められる", () => {
  const hugeText = "AIに関する非常に長いニュース解説文です。".repeat(200); // 数千文字規模
  const result = splitIntoBodyTweets(hugeText);

  assert.equal(result.length, MAX_BODY_TWEETS);
  for (const tweet of result) {
    assert.ok(calculateTweetLength(tweet) <= TWEET_CHAR_LIMIT);
  }
  const last = result[result.length - 1];
  assert.match(last, /…\n\(\d+\/\d+\)$/, "上限本数を超えた場合、最後のツイートは省略記号で丸められるべき");
});

test("splitIntoBodyTweetsは空文字列に対して空配列を返す", () => {
  assert.deepEqual(splitIntoBodyTweets(""), []);
  assert.deepEqual(splitIntoBodyTweets("   "), []);
});

test("buildLinkTweetTextは元記事URLを含む", () => {
  const text = buildLinkTweetText("https://example.com/article-123");
  assert.match(text, /https:\/\/example\.com\/article-123/);
});

test("composeThreadは本文が単一ツイートで収まる場合でも、末尾にリンクツイートを別ツイートとして追加する", () => {
  const url = "https://example.com/article-123";
  const tweets = composeThread("短い本文です。", url);

  assert.equal(tweets.length, 2);
  assert.equal(tweets[0].kind, "body");
  assert.equal(tweets[1].kind, "link");
  assert.match(tweets[1].text, /https:\/\/example\.com\/article-123/);
  assert.doesNotMatch(tweets[0].text, /https:\/\/example\.com/, "本文ツイートはURLを含まない");
  for (const tweet of tweets) {
    assert.ok(tweet.charLength <= TWEET_CHAR_LIMIT);
  }
  // 投稿順序(index)が1から連番であること
  assert.deepEqual(tweets.map((t) => t.index), [1, 2]);
});

test("composeThreadは本文が複数ツイートに分割される場合も、リンクツイートを最後尾に1件だけ追加する", () => {
  const url = "https://example.com/long-article";
  const longText = "とても長いAIニュースの紹介文です。".repeat(15);
  const tweets = composeThread(longText, url);

  const bodyTweets = tweets.filter((t) => t.kind === "body");
  const linkTweets = tweets.filter((t) => t.kind === "link");
  assert.ok(bodyTweets.length > 1);
  assert.equal(linkTweets.length, 1);
  assert.equal(tweets[tweets.length - 1].kind, "link");
  for (const tweet of tweets) {
    assert.ok(tweet.charLength <= TWEET_CHAR_LIMIT);
  }
});

test("composeThreadは非常に長いURLでもリンクツイートが上限内に収まる(t.co固定重み換算)", () => {
  const longUrl = `https://example.com/${"a".repeat(300)}`;
  const tweets = composeThread("短い本文。", longUrl);
  const linkTweet = tweets[tweets.length - 1];
  assert.equal(linkTweet.kind, "link");
  assert.ok(linkTweet.charLength <= TWEET_CHAR_LIMIT);
});

test("F12: composeThreadはincludeLinkTweet:falseを指定するとリンクツイートを付けない", () => {
  const tweets = composeThread("短い本文です。", "https://example.com/article", { includeLinkTweet: false });
  assert.equal(tweets.length, 1);
  assert.equal(tweets[0].kind, "body");
});

test("F12: composeThreadはlinkPosition:'start'を指定するとリンクツイートをスレッド先頭に置く", () => {
  const url = "https://example.com/article";
  const tweets = composeThread("短い本文です。", url, { linkPosition: "start" });
  assert.equal(tweets.length, 2);
  assert.equal(tweets[0].kind, "link");
  assert.equal(tweets[1].kind, "body");
  assert.deepEqual(tweets.map((t) => t.index), [1, 2]);
  assert.match(tweets[0].text, new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("F12: composeThreadはmaxBodyTweetsオプションで本文分割の上限本数を変更できる", () => {
  const longText = "とても長いAIニュースの紹介文です。".repeat(15);
  const tweets = composeThread(longText, "https://example.com/article", { maxBodyTweets: 2 });
  const bodyTweets = tweets.filter((t) => t.kind === "body");
  assert.equal(bodyTweets.length, 2);
});
