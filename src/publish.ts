#!/usr/bin/env node
/**
 * F6: 本番投稿(Xへ実際にスレッド投稿する)。
 *
 * `runPostingPipeline` (src/pipeline.ts) を、実際にX APIへ送信する `xApiPublish` を渡して実行する。
 * 収集→選定→生成→分割→リンク付与は `npm run dryrun` とまったく同じコードパスを通り、
 * このファイルで指定しているのは「実際に送信する」publish関数だけ。
 *
 * X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET が未設定の場合、
 * publish段階でAPIを呼び出さず安全にエラーとして終了する(壊れた/部分的な投稿をしない)。
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";
import { runPostingPipeline } from "./pipeline.js";
import { xApiPublish } from "./xPublish.js";

/** CLIから直接実行された場合のみ、リポジトリ直下の.env(存在すれば)をprocess.envへ読み込む */
function loadDotEnvIfPresent(): void {
  const envFile = path.join(process.cwd(), ".env");
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

async function main() {
  loadDotEnvIfPresent();
  const args = process.argv.slice(2);
  const injectDecoy = args.includes("--inject-decoy");

  log.info("running live posting pipeline (collect -> select -> generate -> thread -> post to X)");

  const result = await runPostingPipeline({
    injectDecoy,
    // 本番投稿では既出判定を汚さないため、選定確定後に必ず投稿履歴へ記録する
    writeHistory: true,
    publish: xApiPublish,
  });

  const outDir = path.join(process.cwd(), "data", "output");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "latest-publish.json");

  if (!result.success) {
    log.warn(`posting pipeline stopped at stage "${result.stage}"`, { reason: result.error });
    await writeFile(
      outFile,
      JSON.stringify(
        { ranAt: new Date().toISOString(), success: false, stage: result.stage, error: result.error },
        null,
        2
      ),
      "utf-8"
    );
    process.exitCode = 1;
    return;
  }

  const publishResult = result.publishResult;
  if (!publishResult?.posted) {
    log.error("posting to X did not complete successfully", {
      detail: publishResult?.detail,
      tweetIds: publishResult?.tweetIds,
      failedAtIndex: publishResult?.failedAtIndex,
    });
  } else {
    log.info("posted thread to X successfully", {
      tweetIds: publishResult.tweetIds,
      postedAt: publishResult.postedAt,
    });
  }

  await writeFile(
    outFile,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        success: true,
        candidate: result.candidate,
        selectionReason: result.selectionReason,
        text: result.text,
        tweets: result.tweets,
        historyWritten: result.historyWritten,
        publishResult,
      },
      null,
      2
    ),
    "utf-8"
  );
  log.info(`wrote publish result to ${outFile}`);

  if (!publishResult?.posted) {
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    log.error("fatal error during live posting", {
      message: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  });
}
