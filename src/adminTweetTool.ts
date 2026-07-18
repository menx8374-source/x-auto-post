#!/usr/bin/env node
/**
 * 障害対応用の管理CLIツール(正式なスプリントの機能ではなく、運用トラブル対応のための緊急ツール)。
 *
 * 背景: アフィリエイト投稿の不具合調査中に、リンクツイートの投稿が失敗し不完全なスレッドが
 * 複数投稿されてしまった。この復旧・調査のために以下2つのサブコマンドを提供する。
 *
 * - delete-tweet --id=<tweetId> : 指定した1件のツイートを削除する。
 *   安全のため1回のコマンド実行につき --id は1つのみ受け付ける(複数ID一括削除・ワイルドカードは
 *   実装しない。誤操作による大量削除を防ぐため)。
 * - test-post --text="<text>"   : 指定したテキストで単発のテスト投稿を1件行う
 *   (スレッドではない、返信でもない独立したツイート)。文字数上限超過時は投稿しない。
 *
 * 既存の src/xPublish.ts の createXClient()(認証情報読み込み)をそのまま再利用する。
 * X_API_KEY 等の認証情報が未設定の場合は、API呼び出し自体を行わず安全にエラー終了する。
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";
import { createXClient, type XPostClient } from "./xPublish.js";
import { calculateTweetLength, fitsInSingleTweet, TWEET_CHAR_LIMIT } from "./tweetLength.js";

/** CLIから直接実行された場合のみ、リポジトリ直下の.env(存在すれば)をprocess.envへ読み込む */
function loadDotEnvIfPresent(): void {
  const envFile = path.join(process.cwd(), ".env");
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

/**
 * "--id=123" 形式の引数から値を取り出す。未指定ならundefined。
 * シェルによってクォートがそのまま残るケース(例: --text="foo")を考慮し前後のクォートは剥がす。
 */
function readArgValue(args: string[], flag: string): string | undefined {
  const prefix = `${flag}=`;
  const found = args.find((a) => a.startsWith(prefix));
  if (!found) return undefined;
  const raw = found.slice(prefix.length);
  if (raw.length >= 2) {
    const first = raw[0];
    const last = raw[raw.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return raw.slice(1, -1);
    }
  }
  return raw;
}

/**
 * 指定した1件のツイートIDを削除する。
 * client/tweetIdがexportされたテスト可能な関数として、モッククライアントで単体テストする。
 */
export async function deleteTweetCommand(client: XPostClient | null, tweetId: string | undefined): Promise<void> {
  if (!client) {
    log.error(
      "X API認証情報(X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET)が未設定のため削除できません"
    );
    process.exitCode = 1;
    return;
  }
  if (!tweetId || !tweetId.trim()) {
    log.error("--id=<tweetId> は必須です(安全のため1回のコマンド実行につき1件のみ指定できます)");
    process.exitCode = 1;
    return;
  }
  if (!client.deleteTweet) {
    log.error("このXクライアントは削除操作(deleteTweet)に対応していません");
    process.exitCode = 1;
    return;
  }

  const id = tweetId.trim();
  try {
    const result = await client.deleteTweet(id);
    if (result.deleted) {
      log.info("tweet deleted successfully", { tweetId: id });
    } else {
      log.error("tweet deletion request completed but X API reported deleted:false", { tweetId: id });
      process.exitCode = 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("failed to delete tweet", { tweetId: id, message });
    process.exitCode = 1;
  }
}

/**
 * 指定したテキストで単発のテスト投稿を1件行う(スレッド化・返信化しない独立したツイート)。
 */
export async function testPostCommand(client: XPostClient | null, text: string | undefined): Promise<void> {
  if (!client) {
    log.error(
      "X API認証情報(X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET)が未設定のため投稿できません"
    );
    process.exitCode = 1;
    return;
  }
  if (!text || !text.trim()) {
    log.error('--text="<投稿するテキスト>" は必須です');
    process.exitCode = 1;
    return;
  }
  if (!fitsInSingleTweet(text)) {
    log.error(
      `テキストが1ツイートの文字数上限(${TWEET_CHAR_LIMIT})を超えているため投稿しません`,
      { calculatedLength: calculateTweetLength(text) }
    );
    process.exitCode = 1;
    return;
  }

  try {
    const posted = await client.postTweet(text);
    log.info("test tweet posted successfully", { tweetId: posted.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("failed to post test tweet", { message });
    process.exitCode = 1;
  }
}

async function main() {
  loadDotEnvIfPresent();
  const args = process.argv.slice(2);
  const action = args[0];

  switch (action) {
    case "delete-tweet": {
      const client = createXClient();
      await deleteTweetCommand(client, readArgValue(args, "--id"));
      break;
    }
    case "test-post": {
      const client = createXClient();
      await testPostCommand(client, readArgValue(args, "--text"));
      break;
    }
    default:
      log.error(
        `不明なサブコマンドです: "${action ?? ""}"(delete-tweet または test-post を指定してください)`
      );
      process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    log.error("fatal error in admin tweet tool", {
      message: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  });
}
