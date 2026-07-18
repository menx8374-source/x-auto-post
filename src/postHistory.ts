/**
 * F2/F9: 投稿状態・履歴管理の永続化。
 *
 * 保存形式: JSON配列(data/history/post-history.json)。Sprint 2の「選定履歴」を、
 * Sprint 7でslot(投稿枠)・status・postedAt・tweetIdsを持つ正式な投稿履歴に拡張した。
 * 追加フィールドはすべて任意のため、Sprint 2形式の既存データもそのまま読み込める(後方互換)。
 *
 * F9で提供する主な機能:
 * - appendHistoryEntry / updateHistoryEntry: 選定時に記録し、投稿完了後に結果を反映する2段階書き込み。
 * - hasPostedSlotOnDate: 同一枠・同一日の二重投稿防止(冪等性)判定。
 * - isWithinRecoveryWindow: トリガー不発時、次の起動で投稿を補ってよいか(許容範囲内か)の判定。
 * - 履歴は明示的に削除しない限りすべて残るため、F2の既出判定に引き続き利用できる。
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { log } from "./logger.js";
import { normalizeUrl } from "./urlUtil.js";
import { DEFAULT_RECOVERY_WINDOW_HOURS, getRecoveryWindowHours } from "./config.js";
import type { PostHistoryEntry } from "./types.js";

export const DEFAULT_HISTORY_FILE = path.join(process.cwd(), "data", "history", "post-history.json");

// F12(Sprint 10): 許容範囲の既定値・取得ロジックはsrc/config.tsに一元化した。
// このモジュールからの既存の呼び出し口(名前)はそのまま維持し、後方互換を保つ薄いラッパーとする。
export { DEFAULT_RECOVERY_WINDOW_HOURS };

/** POST_RECOVERY_WINDOW_HOURS 環境変数で不発リカバリの許容範囲(時間)を上書きできる。未設定/不正値なら既定値を使う */
export function getConfiguredRecoveryWindowHours(): number {
  return getRecoveryWindowHours();
}

/**
 * 履歴ファイルを読み込む。ファイルが存在しない場合(初回実行)は空配列を返す。
 * ファイルが壊れている(パース失敗)場合は、既出判定を誤らせる(壊れた状態で
 * 全件許可してしまう)より安全側に倒すため、エラーとして投げる。
 */
export async function loadHistory(filePath: string = DEFAULT_HISTORY_FILE): Promise<PostHistoryEntry[]> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw err;
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error("history file does not contain a JSON array");
    }
    return parsed as PostHistoryEntry[];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to parse post history file (${filePath}): ${message}`);
  }
}

/**
 * 選定した候補を履歴ファイルに追記する(既存分は保持)。
 * idを新規発行して返すため、投稿完了後に updateHistoryEntry(id, ...) で結果を反映できる。
 * statusを指定しない場合は"selected"(選定のみ)として記録する。
 */
export async function appendHistoryEntry(
  entry: Omit<PostHistoryEntry, "normalizedUrl" | "id">,
  filePath: string = DEFAULT_HISTORY_FILE
): Promise<PostHistoryEntry> {
  const history = await loadHistory(filePath);
  const fullEntry: PostHistoryEntry = {
    ...entry,
    status: entry.status ?? "selected",
    id: randomUUID(),
    normalizedUrl: normalizeUrl(entry.url),
  };
  history.push(fullEntry);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(history, null, 2), "utf-8");
  log.info(`recorded selection into post history: ${filePath}`, { url: entry.url, slot: entry.slot });

  return fullEntry;
}

export type PostHistoryUpdate = Partial<Pick<PostHistoryEntry, "status" | "postedAt" | "tweetIds" | "slot">>;

/**
 * idで指定した既存の履歴エントリを更新する。投稿(publish)完了後に、選定時点で
 * appendHistoryEntry() が書き込んだエントリへ実際の投稿結果(枠・投稿日時・ツイートID・状態)を
 * 反映するために使う(2段階書き込みの後半)。
 * 対象idが見つからない場合(想定外の状況)は書き込まず警告ログのみ残し、呼び出し側の処理は継続させる。
 */
export async function updateHistoryEntry(
  id: string,
  updates: PostHistoryUpdate,
  filePath: string = DEFAULT_HISTORY_FILE
): Promise<PostHistoryEntry | null> {
  const history = await loadHistory(filePath);
  const index = history.findIndex((h) => h.id === id);
  if (index === -1) {
    log.warn("post history entry not found for update; skipping", { id, filePath });
    return null;
  }

  const updated: PostHistoryEntry = { ...history[index], ...updates };
  history[index] = updated;

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(history, null, 2), "utf-8");
  log.info("updated post history entry with publish result", {
    id,
    status: updated.status,
    slot: updated.slot,
    tweetIds: updated.tweetIds,
  });

  return updated;
}

/** JSTとUTCの固定オフセット(ミリ秒)。日本には夏時間が無いため常にUTC+9固定でよい */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * ISO8601文字列(UTC)からJST基準の日付キー"YYYY-MM-DD"を取り出す。
 * 投稿枠の運用がJST基準であるため、UTCのままスライスすると日境界(UTC 00:00 = JST 09:00)付近で
 * 同一JST暦日でも異なる日付キーになってしまい、冪等性判定(hasPostedSlotOnDate)を誤らせる
 * (二重投稿・誤スキップの実害が確認されたためSprint 7で修正)。
 * タイムゾーンライブラリは使わず、+9時間シフトしてから日付部分を取り出すのみで十分(夏時間なし)。
 */
export function toDateKey(iso: string): string {
  const jstDate = new Date(new Date(iso).getTime() + JST_OFFSET_MS);
  return jstDate.toISOString().slice(0, 10);
}

/**
 * 指定した投稿枠(slot)が、referenceDateの属する日(JST基準)に既に投稿済み(status:"posted")かどうかを判定する。
 * 同一枠・同一日への二重投稿防止(1枠1投稿の冪等性)の判定に使う。"failed"のエントリはブロックしない
 * (投稿に失敗した枠は、許容範囲内であれば同日中の再試行を妨げないため)。
 */
export function hasPostedSlotOnDate(
  history: PostHistoryEntry[],
  slot: string,
  referenceDate: Date = new Date()
): boolean {
  const targetDay = toDateKey(referenceDate.toISOString());
  return history.some((h) => {
    if (h.slot !== slot || h.status !== "posted") {
      return false;
    }
    const postedDay = h.postedAt ? toDateKey(h.postedAt) : undefined;
    return postedDay === targetDay;
  });
}

/**
 * 不発リカバリの許容範囲判定。予定時刻(scheduledAt)からnowまでの経過時間がtoleranceHours以内なら
 * 「その枠のトリガーが不発だったので今回の起動で補ってよい」とみなしtrueを返す。
 * 予定時刻よりnowが前(まだ来ていない)場合は常にtrue(許容範囲外にはしない)。
 * 経過時間がtoleranceHoursを超える場合はfalse(例: 深夜に朝枠を投稿するような無制限な遅延投稿を防ぐ)。
 */
export function isWithinRecoveryWindow(
  scheduledAt: Date,
  now: Date = new Date(),
  toleranceHours: number = DEFAULT_RECOVERY_WINDOW_HOURS
): boolean {
  const elapsedMs = now.getTime() - scheduledAt.getTime();
  if (elapsedMs <= 0) {
    return true;
  }
  return elapsedMs <= toleranceHours * 60 * 60 * 1000;
}
