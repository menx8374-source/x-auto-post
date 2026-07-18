#!/usr/bin/env node
/**
 * アフィリエイト投稿の本番実行(Xへ実際にスレッド投稿する)。
 *
 * `runAffiliatePostingPipeline` (src/affiliatePipeline.ts) を、実際にX APIへ送信する
 * `createXApiPublishForAffiliateAccount` (src/affiliateXPublish.ts) を渡して実行する。
 * 既存のAIニュースの `npm run post`(src/publish.ts)とはコード上完全に独立しており、
 * こちらの実行は既存のAIニュース投稿の動作・履歴に一切影響しない
 * (投稿履歴ファイルも data/history/affiliate-post-history.json と別)。
 *
 * X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET が未設定の場合、
 * publish段階でAPIを呼び出さず安全にエラーとして終了する。
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";
import { runAffiliatePostingPipeline } from "./affiliatePipeline.js";
import { createXApiPublishForAffiliateAccount } from "./affiliateXPublish.js";
import { resolveCurrentAffiliateSlot } from "./postSchedule.js";
import { notify } from "./notify.js";
import { getAccountProfile } from "./accounts.js";
import { AFFILIATE_SLOT_ID } from "./config.js";

/** CLIから直接実行された場合のみ、リポジトリ直下の.env(存在すれば)をprocess.envへ読み込む */
function loadDotEnvIfPresent(): void {
  const envFile = path.join(process.cwd(), ".env");
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
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
        path.join(outDir, "latest-affiliate-publish.json"),
        JSON.stringify(
          {
            ranAt: new Date().toISOString(),
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

  log.info("running live affiliate posting pipeline (select -> generate -> thread -> post to X)", {
    accountId: account.id,
    slot,
    scheduledAt,
  });

  const result = await runAffiliatePostingPipeline({
    writeHistory: true,
    publish: createXApiPublishForAffiliateAccount(account),
    slot,
    scheduledAt,
    accountId: account.id,
  });

  const outDir = path.join(process.cwd(), "data", "output");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "latest-affiliate-publish.json");

  if (!result.success) {
    log.warn(`affiliate posting pipeline stopped at stage "${result.stage}"`, {
      reason: result.error,
      skipReason: result.skipReason,
    });

    if (result.skipReason === "outside-recovery-window") {
      await notify({
        level: "warning",
        title: "アフィリエイト投稿枠を逃しました(不発リカバリの許容範囲外)",
        detail: result.error ?? "詳細不明",
      });
    } else if (result.stage === "select") {
      await notify({
        level: "warning",
        title: "アフィリエイト投稿対象の商品がありませんでした",
        detail: result.error ?? "詳細不明",
      });
    } else if (result.stage === "generate") {
      await notify({
        level: "error",
        title: "アフィリエイト投稿文面の生成に失敗しました",
        detail: result.error ?? "詳細不明",
      });
    }

    await writeFile(
      outFile,
      JSON.stringify(
        {
          ranAt: new Date().toISOString(),
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
    // stage:"skipped"(冪等性/不発リカバリの許容範囲外)はcron連携上の正常な動作のため異常終了にしない。
    if (result.stage !== "skipped") {
      process.exitCode = 1;
    }
    return;
  }

  const publishResult = result.publishResult;
  if (!publishResult?.posted) {
    log.error("posting affiliate thread to X did not complete successfully", {
      detail: publishResult?.detail,
      tweetIds: publishResult?.tweetIds,
      failedAtIndex: publishResult?.failedAtIndex,
    });
    await notify({
      level: "error",
      title: "アフィリエイト投稿のXへの送信に失敗しました",
      detail: publishResult?.detail ?? publishResult?.error ?? "詳細不明",
    });
  } else {
    log.info("posted affiliate thread to X successfully", {
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
        accountId: result.accountId,
        product: result.product,
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
  log.info(`wrote affiliate publish result to ${outFile}`);

  if (!publishResult?.posted) {
    process.exitCode = 1;
  }
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    log.error("fatal error during live affiliate posting", {
      message: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  });
}
