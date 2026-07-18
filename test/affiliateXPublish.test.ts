import { test } from "node:test";
import assert from "node:assert/strict";
import { createXApiPublishForAffiliate } from "../src/affiliateXPublish.js";
import type { XPostClient } from "../src/xPublish.js";
import type { ThreadTweet } from "../src/threadSplit.js";
import type { AffiliateProduct } from "../src/affiliateProducts.js";
import type { OgpImage } from "../src/ogpImage.js";

const product: AffiliateProduct = {
  id: "p1",
  name: "テスト商品",
  officialUrl: "https://example.com/p1",
  affiliateUrl: "https://affiliate.example.com/p1",
  facts: ["特長1"],
  enabled: true,
};

function tweets(count: number): ThreadTweet[] {
  // アフィリエイトスレッドはbody...N件 + link(末尾)固定なので、最後だけkind:"link"にする。
  return Array.from({ length: count }, (_, i) => ({
    index: i + 1,
    text: `本文${i + 1}`,
    charLength: 3,
    kind: i === count - 1 ? "link" : "body",
  }));
}

const sampleOgpImage: OgpImage = {
  url: "https://example.com/p1-ogp.png",
  buffer: Buffer.from("fake-image-bytes"),
  contentType: "image/png",
};

test("認証情報未設定(client:null)の場合、API呼び出しをせず安全にエラーを返す", async () => {
  const publish = createXApiPublishForAffiliate(null);
  const result = await publish(tweets(2), product);

  assert.equal(result.posted, false);
  assert.equal(result.tweetIds?.length, 0);
  assert.match(result.error ?? "", /X_API_KEY|X_API_SECRET|X_ACCESS_TOKEN|X_ACCESS_SECRET/);
});

test("OGP画像添付: 1件目(本文ツイート)にのみmedia_idが付き、末尾のリンクツイートには付かない", async () => {
  const calls: { text: string; replyTo?: string; mediaIds?: string[] }[] = [];
  const uploadedImages: OgpImage[] = [];
  const mockClient: XPostClient = {
    postTweet: async (text, replyToTweetId, mediaIds) => {
      calls.push({ text, replyTo: replyToTweetId, mediaIds });
      return { id: `tweet-${calls.length}` };
    },
    uploadMedia: async (image) => {
      uploadedImages.push(image);
      return "media-123";
    },
  };
  const publish = createXApiPublishForAffiliate(mockClient);

  const result = await publish(tweets(3), product, sampleOgpImage);

  assert.equal(result.posted, true);
  assert.equal(uploadedImages.length, 1);
  assert.equal(uploadedImages[0].url, sampleOgpImage.url);
  // tweets(3)は最後がkind:"link"、それ以外がkind:"body"。1件目(最初の本文ツイート)にのみmedia_idが付く。
  assert.deepEqual(calls[0].mediaIds, ["media-123"], "1件目(本文)にmedia_idが付くはず");
  assert.equal(calls[1].mediaIds, undefined, "2件目(本文)にはmedia_idが付かないはず");
  assert.equal(calls[2].mediaIds, undefined, "末尾(リンクツイート)にはmedia_idが付かないはず");
});

test("OGP画像添付: ogpImage未指定(null)の場合、uploadMediaは呼ばれずmedia_idも付かない", async () => {
  let uploadCalled = false;
  const calls: { mediaIds?: string[] }[] = [];
  const mockClient: XPostClient = {
    postTweet: async (text, replyToTweetId, mediaIds) => {
      calls.push({ mediaIds });
      return { id: `tweet-${calls.length}` };
    },
    uploadMedia: async () => {
      uploadCalled = true;
      return "media-should-not-be-used";
    },
  };
  const publish = createXApiPublishForAffiliate(mockClient);

  const result = await publish(tweets(2), product, null);

  assert.equal(result.posted, true);
  assert.equal(uploadCalled, false);
  assert.equal(calls[0].mediaIds, undefined);
});

test("OGP画像添付: 画像アップロードに失敗しても、画像なしでスレッド投稿は継続する(ブロッキングしない)", async () => {
  const calls: string[] = [];
  const mockClient: XPostClient = {
    postTweet: async (text) => {
      calls.push(text);
      return { id: `tweet-${calls.length}` };
    },
    uploadMedia: async () => {
      throw new Error("simulated upload failure");
    },
  };
  const publish = createXApiPublishForAffiliate(mockClient);

  const result = await publish(tweets(2), product, sampleOgpImage);

  assert.equal(result.posted, true, "画像アップロード失敗でも投稿自体は成功するはず");
  assert.equal(calls.length, 2);
});

test("OGP画像添付: クライアントがuploadMediaを持たない場合も安全に画像なしで投稿を継続する", async () => {
  const calls: string[] = [];
  const mockClient: XPostClient = {
    postTweet: async (text) => {
      calls.push(text);
      return { id: `tweet-${calls.length}` };
    },
    // uploadMedia未定義
  };
  const publish = createXApiPublishForAffiliate(mockClient);

  const result = await publish(tweets(1), product, sampleOgpImage);

  assert.equal(result.posted, true);
  assert.equal(calls.length, 1);
});
