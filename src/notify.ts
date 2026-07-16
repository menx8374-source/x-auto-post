/**
 * F10: 投稿失敗・投稿対象なし(スキップ)・不発リカバリの許容範囲超過など、利用者の対応が必要な
 * 事象を通知する。
 *
 * 通知手段は2系統:
 * 1. 実行基盤のログ(既定・常時): 呼び出し元(src/publish.ts)がログに残し、GitHub Actions実行では
 *    `.github/workflows/post.yml`が`$GITHUB_STEP_SUMMARY`にジョブサマリーとして結果を書き出す
 *    (Actionsの実行一覧から一目で分かる。ワークフロー失敗時はGitHubの標準通知(登録メール等)も届く)。
 * 2. 任意のWebhook: `NOTIFY_WEBHOOK_URL`環境変数(Slack incoming webhook等、JSON POSTを受け付ける
 *    任意のエンドポイントを想定)を設定すると、同じ内容をそこにも送る。未設定なら何もしない。
 *
 * どちらの手段も失敗してよい(通知の失敗でパイプライン本体を失敗させないベストエフォート)。
 */
import { log } from "./logger.js";

export interface NotifyEvent {
  level: "warning" | "error";
  title: string;
  detail: string;
}

async function postToWebhook(url: string, event: NotifyEvent): Promise<void> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text: `[${event.level.toUpperCase()}] ${event.title}\n${event.detail}`,
        level: event.level,
        title: event.title,
        detail: event.detail,
      }),
    });
    if (!res.ok) {
      log.warn("notify webhook responded with non-2xx status", { status: res.status });
    }
  } catch (err) {
    // 通知の失敗でパイプライン自体を失敗させない(ベストエフォート)
    log.warn("failed to send notify webhook", { message: err instanceof Error ? err.message : String(err) });
  }
}

/** 利用者の対応が必要な事象を通知する(ログには必ず残し、NOTIFY_WEBHOOK_URL設定時はそこにも送る) */
export async function notify(event: NotifyEvent): Promise<void> {
  const logFn = event.level === "error" ? log.error : log.warn;
  logFn(`notify: ${event.title}`, { detail: event.detail });

  const webhookUrl = process.env.NOTIFY_WEBHOOK_URL;
  if (webhookUrl) {
    await postToWebhook(webhookUrl, event);
  }
}
