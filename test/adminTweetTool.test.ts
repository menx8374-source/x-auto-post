import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteTweetCommand, testPostCommand } from "../src/adminTweetTool.js";
import type { XPostClient } from "../src/xPublish.js";
import { TWEET_CHAR_LIMIT } from "../src/tweetLength.js";

/** process.exitCode を汚さないよう、各テストの前後で退避・復元する */
function withExitCodeIsolation(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    const before = process.exitCode;
    process.exitCode = undefined;
    try {
      await fn();
    } finally {
      process.exitCode = before;
    }
  };
}

test(
  "delete-tweet: 認証情報未設定(client:null)の場合、削除を試みずエラー終了する",
  withExitCodeIsolation(async () => {
    await deleteTweetCommand(null, "12345");
    assert.equal(process.exitCode, 1);
  })
);

test(
  "delete-tweet: --idが未指定の場合、削除を試みずエラー終了する",
  withExitCodeIsolation(async () => {
    const calls: string[] = [];
    const mockClient: XPostClient = {
      postTweet: async () => ({ id: "unused" }),
      deleteTweet: async (id) => {
        calls.push(id);
        return { deleted: true };
      },
    };
    await deleteTweetCommand(mockClient, undefined);
    assert.equal(process.exitCode, 1);
    assert.equal(calls.length, 0, "IDが未指定なら削除APIを呼び出さない");
  })
);

test(
  "delete-tweet: 指定した1件のツイートIDのみを削除し、それ以外には影響しない",
  withExitCodeIsolation(async () => {
    const calls: string[] = [];
    const mockClient: XPostClient = {
      postTweet: async () => ({ id: "unused" }),
      deleteTweet: async (id) => {
        calls.push(id);
        return { deleted: true };
      },
    };
    await deleteTweetCommand(mockClient, "tweet-999");

    assert.deepEqual(calls, ["tweet-999"], "指定したIDのみ削除APIに渡される");
    assert.equal(process.exitCode, undefined, "成功時はexitCodeを変更しない");
  })
);

test(
  "delete-tweet: X APIが deleted:false を返した場合はエラー終了する",
  withExitCodeIsolation(async () => {
    const mockClient: XPostClient = {
      postTweet: async () => ({ id: "unused" }),
      deleteTweet: async () => ({ deleted: false }),
    };
    await deleteTweetCommand(mockClient, "tweet-1");
    assert.equal(process.exitCode, 1);
  })
);

test(
  "delete-tweet: X API呼び出しが例外を投げた場合はエラー終了する",
  withExitCodeIsolation(async () => {
    const mockClient: XPostClient = {
      postTweet: async () => ({ id: "unused" }),
      deleteTweet: async () => {
        throw new Error("simulated API failure");
      },
    };
    await deleteTweetCommand(mockClient, "tweet-1");
    assert.equal(process.exitCode, 1);
  })
);

test(
  "test-post: 認証情報未設定(client:null)の場合、投稿を試みずエラー終了する",
  withExitCodeIsolation(async () => {
    await testPostCommand(null, "テスト投稿");
    assert.equal(process.exitCode, 1);
  })
);

test(
  "test-post: --textが未指定の場合、投稿を試みずエラー終了する",
  withExitCodeIsolation(async () => {
    const calls: string[] = [];
    const mockClient: XPostClient = {
      postTweet: async (text) => {
        calls.push(text);
        return { id: "tweet-1" };
      },
    };
    await testPostCommand(mockClient, undefined);
    assert.equal(process.exitCode, 1);
    assert.equal(calls.length, 0);
  })
);

test(
  "test-post: 文字数上限超過時はエラーとなり投稿されない",
  withExitCodeIsolation(async () => {
    const calls: string[] = [];
    const mockClient: XPostClient = {
      postTweet: async (text) => {
        calls.push(text);
        return { id: "tweet-1" };
      },
    };
    const tooLong = "あ".repeat(Math.ceil(TWEET_CHAR_LIMIT / 2) + 10); // 全角なので重み2 x N > 280
    await testPostCommand(mockClient, tooLong);

    assert.equal(process.exitCode, 1);
    assert.equal(calls.length, 0, "文字数超過時はpostTweetを呼び出さない");
  })
);

test(
  "test-post: 上限内のテキストは単発ツイートとして(返信・スレッド化せず)投稿される",
  withExitCodeIsolation(async () => {
    const calls: { text: string; replyTo?: string }[] = [];
    const mockClient: XPostClient = {
      postTweet: async (text, replyToTweetId) => {
        calls.push({ text, replyTo: replyToTweetId });
        return { id: "tweet-42" };
      },
    };
    await testPostCommand(mockClient, "動作確認用のテスト投稿です");

    assert.equal(calls.length, 1);
    assert.equal(calls[0].text, "動作確認用のテスト投稿です");
    assert.equal(calls[0].replyTo, undefined, "返信ではなく独立したツイートとして投稿される");
    assert.equal(process.exitCode, undefined, "成功時はexitCodeを変更しない");
  })
);

test(
  "test-post: X API呼び出しが例外を投げた場合はエラー終了する",
  withExitCodeIsolation(async () => {
    const mockClient: XPostClient = {
      postTweet: async () => {
        throw new Error("simulated API failure");
      },
    };
    await testPostCommand(mockClient, "テスト投稿");
    assert.equal(process.exitCode, 1);
  })
);
