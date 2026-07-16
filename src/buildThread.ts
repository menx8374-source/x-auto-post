#!/usr/bin/env node
/**
 * F4/F5: 直近の `npm run generate` の出力(生成済み本文+選定記事)から、
 * 文字数上限を厳守した投稿予定のツイート配列(本文スレッド+元記事リンクツイート)を組み立てる。
 *
 * このスプリントではXへの実投稿は行わない(それはSprint 6)。
 * 「投稿予定として何がどう分割されるか」をコマンド1つで確認できることがゴール。
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";
import { composeThread, type ThreadTweet } from "./threadSplit.js";
import { TWEET_CHAR_LIMIT } from "./tweetLength.js";
import type { NewsCandidate } from "./types.js";

interface GeneratedPostFile {
  success: boolean;
  text?: string;
  error?: string;
  candidate: NewsCandidate;
}

async function loadGeneratedPostFromCache(): Promise<GeneratedPostFile> {
  const file = path.join(process.cwd(), "data", "output", "latest-post.json");
  const raw = await readFile(file, "utf-8");
  return JSON.parse(raw) as GeneratedPostFile;
}

/** CLIから直接実行された場合のみ、リポジトリ直下の.env(存在すれば)をprocess.envへ読み込む */
function loadDotEnvIfPresent(): void {
  const envFile = path.join(process.cwd(), ".env");
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

function printThread(tweets: ThreadTweet[]): void {
  console.log("---- 投稿予定のツイート(ドライラン: 未投稿) ----");
  for (const tweet of tweets) {
    console.log(
      `[${tweet.index}/${tweets.length}] (${tweet.kind === "body" ? "本文" : "リンク"}, ${tweet.charLength}/${TWEET_CHAR_LIMIT}文字)`
    );
    console.log(tweet.text);
    console.log("----");
  }
}

async function main() {
  loadDotEnvIfPresent();
  const generated = await loadGeneratedPostFromCache();

  const outDir = path.join(process.cwd(), "data", "output");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "latest-thread.json");

  if (!generated.success || !generated.text) {
    log.warn("no successfully generated post text found (run `npm run generate` first), nothing to split", {
      error: generated.error,
    });
    await writeFile(
      outFile,
      JSON.stringify(
        { builtAt: new Date().toISOString(), success: false, error: generated.error ?? "生成済み本文がありません" },
        null,
        2
      ),
      "utf-8"
    );
    process.exitCode = 1;
    return;
  }

  const tweets = composeThread(generated.text, generated.candidate.url);
  printThread(tweets);

  await writeFile(
    outFile,
    JSON.stringify(
      {
        builtAt: new Date().toISOString(),
        success: true,
        candidate: generated.candidate,
        tweets,
      },
      null,
      2
    ),
    "utf-8"
  );
  log.info(`wrote thread build result to ${outFile}`, { tweetCount: tweets.length });
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    log.error("fatal error during thread build", {
      message: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  });
}
