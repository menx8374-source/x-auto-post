/**
 * F2(+ F9の既出判定に必要な最小限)の投稿(選定)履歴の永続化。
 *
 * 保存形式: JSON配列(data/history/post-history.json)。シンプルで、
 * Sprint 7でエントリにフィールドを追加するだけで拡張できる形にしている。
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { log } from "./logger.js";
import { normalizeUrl } from "./urlUtil.js";
import type { PostHistoryEntry } from "./types.js";

export const DEFAULT_HISTORY_FILE = path.join(process.cwd(), "data", "history", "post-history.json");

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

/** 選定した候補を履歴ファイルに追記する(既存分は保持) */
export async function appendHistoryEntry(
  entry: Omit<PostHistoryEntry, "normalizedUrl">,
  filePath: string = DEFAULT_HISTORY_FILE
): Promise<PostHistoryEntry> {
  const history = await loadHistory(filePath);
  const fullEntry: PostHistoryEntry = { ...entry, normalizedUrl: normalizeUrl(entry.url) };
  history.push(fullEntry);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(history, null, 2), "utf-8");
  log.info(`recorded selection into post history: ${filePath}`, { url: entry.url });

  return fullEntry;
}
