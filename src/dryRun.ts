#!/usr/bin/env node
/**
 * F11: ドライラン(投稿せずプレビュー)。
 *
 * `runPostingPipeline` (src/pipeline.ts) を、送信しない `dryRunPublish` を渡して実行する。
 * 収集→選定→生成→分割→リンク付与は本番投稿(Sprint 6)とまったく同じコードパスを通り、
 * このファイルで指定しているのは「送信しない」publish関数だけ。
 * 投稿予定の全ツイート(順序・各文字数・リンクツイート含む)をコンソールに出力し、Xへは1件も投稿しない。
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";
import { runPostingPipeline, dryRunPublish } from "./pipeline.js";
import { TWEET_CHAR_LIMIT } from "./tweetLength.js";
import type { ThreadTweet } from "./threadSplit.js";

/** CLIから直接実行された場合のみ、リポジトリ直下の.env(存在すれば)をprocess.envへ読み込む */
function loadDotEnvIfPresent(): void {
  const envFile = path.join(process.cwd(), ".env");
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

function printPreview(tweets: ThreadTweet[]): void {
  console.log("==== ドライラン: 投稿予定プレビュー(Xへは投稿していません) ====");
  for (const tweet of tweets) {
    console.log(
      `[${tweet.index}/${tweets.length}] (${tweet.kind === "body" ? "本文" : "リンク"}, ${tweet.charLength}/${TWEET_CHAR_LIMIT}文字)`
    );
    console.log(tweet.text);
    console.log("----");
  }
}

/** "--slot=morning" 形式の引数から値を取り出す。未指定ならundefined */
function readArgValue(args: string[], flag: string): string | undefined {
  const prefix = `${flag}=`;
  const found = args.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

async function main() {
  loadDotEnvIfPresent();
  const args = process.argv.slice(2);
  const injectDecoy = args.includes("--inject-decoy");
  // ドライランは既定で投稿履歴(既出判定用)を汚さない。明示的に指定した場合のみ書き込む。
  const writeHistory = args.includes("--write-history");
  // F9: 冪等性・不発リカバリの許容範囲チェックをドライランでも確認できるようにする(任意)
  const slot = readArgValue(args, "--slot");
  const scheduledAt = readArgValue(args, "--scheduled-at");

  log.info("running dry run pipeline (collect -> select -> generate -> thread, no posting to X)", {
    writeHistory,
    slot,
    scheduledAt,
  });

  const result = await runPostingPipeline({
    injectDecoy,
    writeHistory,
    publish: dryRunPublish,
    slot,
    scheduledAt,
  });

  const outDir = path.join(process.cwd(), "data", "output");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "latest-dryrun.json");

  if (!result.success) {
    log.warn(`dry run stopped at stage "${result.stage}"`, { reason: result.error, skipReason: result.skipReason });
    await writeFile(
      outFile,
      JSON.stringify(
        {
          ranAt: new Date().toISOString(),
          dryRun: true,
          success: false,
          stage: result.stage,
          skipReason: result.skipReason,
          error: result.error,
        },
        null,
        2
      ),
      "utf-8"
    );
    process.exitCode = 1;
    return;
  }

  console.log(`選定記事: ${result.candidate?.title} (${result.candidate?.url})`);
  console.log(`選定理由: ${result.selectionReason}`);
  console.log("");
  printPreview(result.tweets ?? []);
  console.log("");
  console.log(
    result.historyWritten
      ? "投稿履歴に記録しました(--write-history 指定)"
      : "投稿履歴には記録していません(ドライランの既定動作。既出回避用データは汚れません)"
  );

  await writeFile(
    outFile,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        dryRun: true,
        success: true,
        candidate: result.candidate,
        selectionReason: result.selectionReason,
        text: result.text,
        tweets: result.tweets,
        historyWritten: result.historyWritten,
        publishResult: result.publishResult,
      },
      null,
      2
    ),
    "utf-8"
  );
  log.info(`wrote dry run result to ${outFile}`, { tweetCount: result.tweets?.length ?? 0 });
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    log.error("fatal error during dry run", {
      message: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  });
}
