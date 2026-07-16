#!/usr/bin/env node
/**
 * F2: F1の候補リストから、その回に投稿する1件を既出回避しつつ選定する。
 *
 * このスプリントではXへの投稿・文面生成は行わない。「候補から1件確定させる」
 * ところまでがスコープ。
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";
import { normalizeUrl } from "./urlUtil.js";
import { extractKeywords, jaccardSimilarity, CLUSTER_SIMILARITY_THRESHOLD } from "./scoring.js";
import { loadHistory, appendHistoryEntry, DEFAULT_HISTORY_FILE } from "./postHistory.js";
import { collectAndScoreNews } from "./collectNews.js";
import type { NewsCandidate, PostHistoryEntry } from "./types.js";

/**
 * 選定対象と見なす最低スコア。急上昇スコアがこれ以下(候補群の中で最も鮮度・話題性が
 * 無いに等しい)候補は、既出でなくても「しきい値未満」として投稿しない。
 */
export const MIN_SELECTION_SCORE = 0;

export interface SelectionResult {
  /** 選定された候補。有効な候補が無ければnull */
  selected: NewsCandidate | null;
  /** 選定/スキップの理由(ログ・出力用の人間可読な文字列) */
  reason: string;
  /** 候補総数 */
  consideredCount: number;
  /** 既出(URL一致または実質同一記事)として除外された件数 */
  excludedAsDuplicateCount: number;
  /** スコアしきい値未満で除外された件数 */
  excludedByThresholdCount: number;
}

function isSameUrlAsHistory(candidateUrl: string, history: PostHistoryEntry[]): boolean {
  const normalized = normalizeUrl(candidateUrl);
  return history.some((h) => h.normalizedUrl === normalized);
}

/** 候補のタイトルが、過去に選定済みのいずれかのタイトルと実質同一(高い類似度)かどうか */
function isSameTopicAsHistory(candidateTitle: string, history: PostHistoryEntry[]): boolean {
  const candidateKeywords = extractKeywords(candidateTitle);
  return history.some(
    (h) => jaccardSimilarity(candidateKeywords, extractKeywords(h.title)) >= CLUSTER_SIMILARITY_THRESHOLD
  );
}

/**
 * 候補リストと履歴から、投稿対象の1件を選ぶ純粋関数(I/Oなし、テスト容易性のため分離)。
 * スコア降順を前提とせず、内部で再ソートする。
 */
export function selectNextPost(
  candidates: NewsCandidate[],
  history: PostHistoryEntry[]
): SelectionResult {
  const consideredCount = candidates.length;

  let excludedAsDuplicateCount = 0;
  let excludedByThresholdCount = 0;

  const eligible = candidates.filter((c) => {
    if (isSameUrlAsHistory(c.url, history) || isSameTopicAsHistory(c.title, history)) {
      excludedAsDuplicateCount++;
      return false;
    }
    if ((c.score ?? 0) <= MIN_SELECTION_SCORE) {
      excludedByThresholdCount++;
      return false;
    }
    return true;
  });

  if (eligible.length === 0) {
    return {
      selected: null,
      reason: `有効な候補が0件のため投稿をスキップ(候補${consideredCount}件中、既出/実質同一記事で${excludedAsDuplicateCount}件除外、スコアしきい値(${MIN_SELECTION_SCORE})未満で${excludedByThresholdCount}件除外)`,
      consideredCount,
      excludedAsDuplicateCount,
      excludedByThresholdCount,
    };
  }

  eligible.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const selected = eligible[0];

  return {
    selected,
    reason: `候補${consideredCount}件中、既出/実質同一記事${excludedAsDuplicateCount}件・しきい値未満${excludedByThresholdCount}件を除外した上で、最高スコア(${selected.score})の候補を選定`,
    consideredCount,
    excludedAsDuplicateCount,
    excludedByThresholdCount,
  };
}

async function loadCandidatesFromCache(): Promise<NewsCandidate[]> {
  const cacheFile = path.join(process.cwd(), "data", "output", "latest-candidates.json");
  const raw = await readFile(cacheFile, "utf-8");
  const parsed = JSON.parse(raw) as { candidates: NewsCandidate[] };
  return parsed.candidates;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry");
  const fromCache = args.includes("--from-cache");

  log.info("selecting next post from candidates", { fromCache, dryRun });

  const candidates = fromCache
    ? await loadCandidatesFromCache()
    : (await collectAndScoreNews()).scored;

  const history = await loadHistory();
  const result = selectNextPost(candidates, history);

  if (!result.selected) {
    log.warn("no eligible candidate to post, skipping", { reason: result.reason });
  } else {
    log.info("selected post candidate", {
      title: result.selected.title,
      url: result.selected.url,
      score: result.selected.score,
      reason: result.reason,
    });

    if (!dryRun) {
      await appendHistoryEntry({
        url: result.selected.url,
        title: result.selected.title,
        score: result.selected.score,
        selectedAt: new Date().toISOString(),
      });
    } else {
      log.info("dry run: not recording selection into history", { historyFile: DEFAULT_HISTORY_FILE });
    }
  }

  const outDir = path.join(process.cwd(), "data", "output");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "latest-selection.json");
  await writeFile(
    outFile,
    JSON.stringify(
      {
        evaluatedAt: new Date().toISOString(),
        dryRun,
        selected: result.selected,
        reason: result.reason,
        consideredCount: result.consideredCount,
        excludedAsDuplicateCount: result.excludedAsDuplicateCount,
        excludedByThresholdCount: result.excludedByThresholdCount,
      },
      null,
      2
    ),
    "utf-8"
  );
  log.info(`wrote selection result to ${outFile}`);
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    log.error("fatal error during post selection", {
      message: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  });
}
