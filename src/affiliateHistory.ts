/**
 * アフィリエイト投稿専用の投稿状態・履歴管理。
 *
 * AIニュースの投稿履歴(`data/history/post-history.json`、src/postHistory.ts)とは完全に分離した
 * 専用ファイル(`data/history/affiliate-post-history.json`)を使う。これにより:
 * - 同一商品のローテーション上限判定(countPostedByProduct/lastPostedAtByProduct)
 * - アフィリエイト投稿専用の同日重複投稿防止(冪等性、hasPostedAffiliateSlotOnDate)
 * が、既存のAIニュースの`hasPostedSlotOnDate`等のロジックと独立に動作する。
 *
 * JST基準の日付キー変換(toDateKey)は、UTC/JST日境界のバグ(Sprint 7で実害確認済み)を再発させない
 * ため、postHistory.tsのtoDateKeyをそのまま再利用する(ロジックを複製しない)。
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { log } from "./logger.js";
import { toDateKey } from "./postHistory.js";

export const DEFAULT_AFFILIATE_HISTORY_FILE = path.join(
  process.cwd(),
  "data",
  "history",
  "affiliate-post-history.json"
);

export interface AffiliatePostHistoryEntry {
  /** エントリの一意識別子。選定時に発行し、投稿完了後に同じidでupdateAffiliateHistoryEntry()から結果を反映する */
  id?: string;
  /** 対象商品のid(data/affiliate-products.jsonのAffiliateProduct.id) */
  productId: string;
  /** 商品名(ログ・確認用。商品情報が後から変更・削除されても履歴側の表示が壊れないようスナップショットとして保持) */
  productName: string;
  /** 投稿枠(通常はsrc/config.tsのAFFILIATE_SLOT_ID="affiliate") */
  slot?: string;
  /** この商品が投稿対象として選定された日時(ISO8601) */
  selectedAt: string;
  /** 実際に投稿(全ツイート送信)が完了した日時(ISO8601)。status:"posted"のときのみ設定される */
  postedAt?: string;
  /** 投稿できたツイートIDの配列(投稿順) */
  tweetIds?: string[];
  /** エントリの状態。"selected"(選定のみ) / "posted"(投稿完了) / "failed"(投稿試行して失敗) */
  status?: "selected" | "posted" | "failed";
}

/**
 * 履歴ファイルを読み込む。ファイルが存在しない場合(初回実行)は空配列を返す。
 * ファイルが壊れている(パース失敗)場合は、ローテーション・冪等性判定を誤らせるより安全側に倒すため
 * エラーとして投げる(src/postHistory.tsのloadHistoryと同じ方針)。
 */
export async function loadAffiliateHistory(
  filePath: string = DEFAULT_AFFILIATE_HISTORY_FILE
): Promise<AffiliatePostHistoryEntry[]> {
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
      throw new Error("affiliate history file does not contain a JSON array");
    }
    return parsed as AffiliatePostHistoryEntry[];
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to parse affiliate post history file (${filePath}): ${message}`);
  }
}

/**
 * 選定した商品を履歴ファイルに追記する(既存分は保持)。idを新規発行して返すため、投稿完了後に
 * updateAffiliateHistoryEntry(id, ...) で結果を反映できる。statusを指定しない場合は"selected"として記録する。
 */
export async function appendAffiliateHistoryEntry(
  entry: Omit<AffiliatePostHistoryEntry, "id">,
  filePath: string = DEFAULT_AFFILIATE_HISTORY_FILE
): Promise<AffiliatePostHistoryEntry> {
  const history = await loadAffiliateHistory(filePath);
  const fullEntry: AffiliatePostHistoryEntry = {
    ...entry,
    status: entry.status ?? "selected",
    id: randomUUID(),
  };
  history.push(fullEntry);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(history, null, 2), "utf-8");
  log.info(`recorded affiliate selection into post history: ${filePath}`, {
    productId: entry.productId,
    slot: entry.slot,
  });

  return fullEntry;
}

export type AffiliateHistoryUpdate = Partial<Pick<AffiliatePostHistoryEntry, "status" | "postedAt" | "tweetIds" | "slot">>;

/**
 * idで指定した既存の履歴エントリを更新する。投稿(publish)完了後に、選定時点で
 * appendAffiliateHistoryEntry() が書き込んだエントリへ実際の投稿結果を反映するために使う。
 * 対象idが見つからない場合は書き込まず警告ログのみ残し、呼び出し側の処理は継続させる。
 */
export async function updateAffiliateHistoryEntry(
  id: string,
  updates: AffiliateHistoryUpdate,
  filePath: string = DEFAULT_AFFILIATE_HISTORY_FILE
): Promise<AffiliatePostHistoryEntry | null> {
  const history = await loadAffiliateHistory(filePath);
  const index = history.findIndex((h) => h.id === id);
  if (index === -1) {
    log.warn("affiliate post history entry not found for update; skipping", { id, filePath });
    return null;
  }

  const updated: AffiliatePostHistoryEntry = { ...history[index], ...updates };
  history[index] = updated;

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(history, null, 2), "utf-8");
  log.info("updated affiliate post history entry with publish result", {
    id,
    status: updated.status,
    tweetIds: updated.tweetIds,
  });

  return updated;
}

/**
 * 指定した投稿枠(slot)が、referenceDateの属する日(JST基準)に既に投稿済み(status:"posted")かどうかを判定する。
 * アフィリエイト投稿専用の同日重複投稿防止(冪等性)に使う。AIニュース側のhasPostedSlotOnDateとは
 * 独立(専用の履歴ファイルを見るため)。
 */
export function hasPostedAffiliateSlotOnDate(
  history: AffiliatePostHistoryEntry[],
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

/** 商品ごとの投稿済み(status:"posted")回数を集計する(ローテーション上限判定に使う) */
export function countPostedByProduct(history: AffiliatePostHistoryEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const h of history) {
    if (h.status !== "posted") continue;
    counts.set(h.productId, (counts.get(h.productId) ?? 0) + 1);
  }
  return counts;
}

/** 商品ごとの最終投稿日時(status:"posted"のみ、ISO8601文字列)を返す。未投稿の商品は含まれない */
export function lastPostedAtByProduct(history: AffiliatePostHistoryEntry[]): Map<string, string> {
  const lastPosted = new Map<string, string>();
  for (const h of history) {
    if (h.status !== "posted" || !h.postedAt) continue;
    const current = lastPosted.get(h.productId);
    if (!current || new Date(h.postedAt).getTime() > new Date(current).getTime()) {
      lastPosted.set(h.productId, h.postedAt);
    }
  }
  return lastPosted;
}
