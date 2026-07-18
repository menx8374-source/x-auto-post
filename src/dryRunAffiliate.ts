#!/usr/bin/env node
/**
 * アフィリエイト投稿のドライラン(投稿せずプレビュー)。
 *
 * `runAffiliatePostingPipeline` (src/affiliatePipeline.ts) を、送信しない `dryRunAffiliatePublish` を
 * 渡して実行する。既存のAIニュースの `npm run dryrun`(src/dryRun.ts)とはコード上完全に独立しており、
 * こちらの実行は既存のAIニュース投稿の動作・履歴に一切影響しない。
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";
import { runAffiliatePostingPipeline, dryRunAffiliatePublish } from "./affiliatePipeline.js";
import { TWEET_CHAR_LIMIT } from "./tweetLength.js";
import { resolveCurrentAffiliateSlot } from "./postSchedule.js";
import { getAccountProfile } from "./accounts.js";
import { AFFILIATE_SLOT_ID } from "./config.js";
import type { ThreadTweet } from "./threadSplit.js";

/** CLIから直接実行された場合のみ、リポジトリ直下の.env(存在すれば)をprocess.envへ読み込む */
function loadDotEnvIfPresent(): void {
  const envFile = path.join(process.cwd(), ".env");
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

function printPreview(tweets: ThreadTweet[]): void {
  console.log("==== ドライラン: アフィリエイト投稿予定プレビュー(Xへは投稿していません) ====");
  for (const tweet of tweets) {
    console.log(
      `[${tweet.index}/${tweets.length}] (${tweet.kind === "body" ? "本文" : "リンク"}, ${tweet.charLength}/${TWEET_CHAR_LIMIT}文字)`
    );
    console.log(tweet.text);
    console.log("----");
  }
}

/** "--slot=affiliate" 形式の引数から値を取り出す。未指定ならundefined */
function readArgValue(args: string[], flag: string): string | undefined {
  const prefix = `${flag}=`;
  const found = args.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : undefined;
}

async function main() {
  loadDotEnvIfPresent();
  const args = process.argv.slice(2);
  // ドライランは既定でアフィリエイト投稿履歴(ローテーション・冪等性判定用)を汚さない。
  const writeHistory = args.includes("--write-history");
  const account = getAccountProfile(readArgValue(args, "--account"));
  let slot = readArgValue(args, "--slot");
  let scheduledAt = readArgValue(args, "--scheduled-at");

  // --force 指定時は、投稿枠の時間帯チェック(--auto-slotの時刻判定)をスキップし即座に実行する
  // (手動テスト用。19:00 JST以外の時間帯でも動作確認したい場合に使う)。ただし冪等性チェック
  // (同一slot・同日の重複投稿防止、runAffiliatePostingPipeline内のhasPostedAffiliateSlotOnDate)は
  // slotをAFFILIATE_SLOT_IDに設定することで引き続き有効にする。scheduledAtは設定しないため、
  // 不発リカバリの許容範囲チェック(時間帯チェック)だけがスキップされる。
  const force = args.includes("--force");

  // --auto-slot 指定時は、現在時刻(または --now で注入したテスト用時刻)からアフィリエイト投稿枠
  // (既定19:00 JST)に該当するかを自動判定する。外部cronサービスからはこのフラグで起動する想定。
  const autoSlot = args.includes("--auto-slot");
  if (autoSlot) {
    const nowRaw = readArgValue(args, "--now");
    const now = nowRaw ? new Date(nowRaw) : new Date();
    const resolved = resolveCurrentAffiliateSlot(now);
    if (!resolved) {
      log.info("auto-slot: affiliate posting slot is not currently active; nothing to do", {
        now: now.toISOString(),
      });
      const outDir = path.join(process.cwd(), "data", "output");
      await mkdir(outDir, { recursive: true });
      await writeFile(
        path.join(outDir, "latest-affiliate-dryrun.json"),
        JSON.stringify(
          {
            ranAt: new Date().toISOString(),
            dryRun: true,
            success: false,
            stage: "skipped",
            skipReason: "no-active-slot",
            error: "現在時刻はアフィリエイト投稿枠の実行タイミングではありません",
          },
          null,
          2
        ),
        "utf-8"
      );
      return;
    }
    slot = resolved.slot;
    scheduledAt = resolved.scheduledAt;
    log.info(`auto-slot resolved to "${resolved.label}" (${resolved.slot})`, { scheduledAt });
  } else if (force) {
    slot = AFFILIATE_SLOT_ID;
    log.info("force: skipping affiliate posting slot timing check; running immediately", { slot });
  }

  log.info("running affiliate dry run pipeline (select -> generate -> thread, no posting to X)", {
    accountId: account.id,
    writeHistory,
    slot,
    scheduledAt,
  });

  const result = await runAffiliatePostingPipeline({
    writeHistory,
    publish: dryRunAffiliatePublish,
    slot,
    scheduledAt,
    accountId: account.id,
  });

  const outDir = path.join(process.cwd(), "data", "output");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "latest-affiliate-dryrun.json");

  if (!result.success) {
    log.warn(`affiliate dry run stopped at stage "${result.stage}"`, {
      reason: result.error,
      skipReason: result.skipReason,
    });
    await writeFile(
      outFile,
      JSON.stringify(
        {
          ranAt: new Date().toISOString(),
          dryRun: true,
          success: false,
          accountId: result.accountId,
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

  console.log(`アカウント: ${account.label} (${result.accountId})`);
  console.log(`選定商品: ${result.product?.name} (${result.product?.id})`);
  console.log(`選定理由: ${result.selectionReason}`);
  console.log("");
  printPreview(result.tweets ?? []);
  console.log("");
  console.log(
    result.historyWritten
      ? "アフィリエイト投稿履歴に記録しました(--write-history 指定)"
      : "アフィリエイト投稿履歴には記録していません(ドライランの既定動作。ローテーション判定用データは汚れません)"
  );

  await writeFile(
    outFile,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        dryRun: true,
        success: true,
        accountId: result.accountId,
        product: result.product,
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
  log.info(`wrote affiliate dry run result to ${outFile}`, { tweetCount: result.tweets?.length ?? 0 });
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    log.error("fatal error during affiliate dry run", {
      message: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  });
}
