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
import { fetchOgpImageForArticle, type OgpImage } from "./ogpImage.js";
import type { NewsCandidate, PostHistoryEntry } from "./types.js";

/**
 * 選定対象と見なす最低スコア。急上昇スコアがこれ以下(候補群の中で最も鮮度・話題性が
 * 無いに等しい)候補は、既出でなくても「しきい値未満」として投稿しない。
 */
export const MIN_SELECTION_SCORE = 0;

/**
 * OGP画像が実際に取得できるかを1候補ごとに試す際、優先順位グループ(日本語/英語)ごとに
 * 試行する上限件数。OGP画像取得はネットワークI/O(タイムアウト8秒、src/ogpImage.ts参照)を
 * 伴うため、候補が多い場合に無制限に試すと選定フェーズが際限なく遅くなる。
 * スコア降順で上位からこの件数まで試し、見つからなければそのグループは諦めて次へ進む。
 */
export const MAX_OGP_ATTEMPTS_PER_GROUP = 20;

/** OGP画像取得関数の型(テスト用に差し替え可能。既定は`fetchOgpImageForArticle`) */
export type FetchOgpImageFn = (url: string) => Promise<OgpImage | null>;

export interface SelectionResult {
  /** 選定された候補。有効な候補が無い/OGP画像を持つ候補が無ければnull */
  selected: NewsCandidate | null;
  /**
   * 選定時に取得できたOGP画像。selectedがある場合、OGP画像の取得可否は選定条件の一部のため
   * 必ず設定される。selectedがnullの場合はnull。後続のパイプラインはこれを再利用し、
   * 記事URLへの二重フェッチを避ける。
   */
  ogpImage?: OgpImage | null;
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
 * プール内をスコア降順に並べ、上位から`MAX_OGP_ATTEMPTS_PER_GROUP`件までOGP画像が
 * 実際に取得できる候補を順に試す。見つかった時点でその候補とOGP画像を返す。
 * 上限まで試しても見つからなければ(そのグループは諦めて)nullを返す。
 */
async function findWithOgpImage(
  pool: NewsCandidate[],
  fetchOgpImage: FetchOgpImageFn
): Promise<{ candidate: NewsCandidate; ogpImage: OgpImage } | null> {
  const sorted = [...pool].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const attempts = sorted.slice(0, MAX_OGP_ATTEMPTS_PER_GROUP);
  for (const candidate of attempts) {
    const ogpImage = await fetchOgpImage(candidate.url);
    if (ogpImage) {
      return { candidate, ogpImage };
    }
  }
  return null;
}

/**
 * 候補リストと履歴から、投稿対象の1件を選ぶ(OGP画像が実際に取得できることを選定条件に含む)。
 * スコア降順を前提とせず、内部で再ソートする。
 *
 * 選定順序:
 *   1. 既出(URL一致・実質同一記事)・スコアしきい値未満を除外し「有効な候補」を得る。
 *   2. 有効な候補の中に日本語ソース(language:"ja")があれば、まずそちらをスコア降順で
 *      上位から順にOGP画像取得を試し、取得できた最初の候補を選定する。
 *   3. 日本語候補が無い、または日本語候補では1件もOGP画像が取得できなかった場合、
 *      英語ソースの候補について同様にスコア降順でOGP画像取得を試す。
 *   4. 日本語・英語いずれの候補も(上限件数まで試して)OGP画像が取得できなかった場合、
 *      有効な候補が0件の場合と同様に投稿をスキップする。
 */
export async function selectNextPost(
  candidates: NewsCandidate[],
  history: PostHistoryEntry[],
  fetchOgpImage: FetchOgpImageFn = fetchOgpImageForArticle
): Promise<SelectionResult> {
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
      ogpImage: null,
      reason: `有効な候補が0件のため投稿をスキップ(候補${consideredCount}件中、既出/実質同一記事で${excludedAsDuplicateCount}件除外、スコアしきい値(${MIN_SELECTION_SCORE})未満で${excludedByThresholdCount}件除外)`,
      consideredCount,
      excludedAsDuplicateCount,
      excludedByThresholdCount,
    };
  }

  // 日本語の読者向けのため、有効な候補の中に日本語ソース(language: "ja")があれば
  // まずそちらだけでOGP画像を取得できる最高スコアの1件を選ぶことを試みる。
  // 未設定の候補は過去データ等の可能性があるため"en"(日本語ではない)扱いにする。
  const eligibleJa = eligible.filter((c) => c.language === "ja");
  const eligibleEn = eligible.filter((c) => c.language !== "ja");

  let found: { candidate: NewsCandidate; ogpImage: OgpImage } | null = null;
  let languageNote = "";

  if (eligibleJa.length > 0) {
    found = await findWithOgpImage(eligibleJa, fetchOgpImage);
    if (found) {
      languageNote = `日本語ソースを優先選定(有効な日本語候補${eligibleJa.length}件中、OGP画像を取得できた候補を選定)`;
    }
  }

  if (!found && eligibleEn.length > 0) {
    found = await findWithOgpImage(eligibleEn, fetchOgpImage);
    if (found) {
      languageNote =
        eligibleJa.length === 0
          ? `日本語候補が無かったため英語ソースから選定(有効候補${eligible.length}件は全て英語ソース)`
          : `日本語候補にOGP画像を持つものが無かったため英語ソースから選定(有効な英語候補${eligibleEn.length}件中から選定)`;
    }
  }

  if (!found) {
    return {
      selected: null,
      ogpImage: null,
      reason: `OGP画像を持つ候補が見つからなかったためスキップ(候補${consideredCount}件中、既出/実質同一記事${excludedAsDuplicateCount}件・しきい値未満${excludedByThresholdCount}件を除外した有効候補${eligible.length}件(日本語${eligibleJa.length}件・英語${eligibleEn.length}件)のうち、各優先順位グループ上位最大${MAX_OGP_ATTEMPTS_PER_GROUP}件を試したがいずれもOGP画像を取得できなかった)`,
      consideredCount,
      excludedAsDuplicateCount,
      excludedByThresholdCount,
    };
  }

  return {
    selected: found.candidate,
    ogpImage: found.ogpImage,
    reason: `候補${consideredCount}件中、既出/実質同一記事${excludedAsDuplicateCount}件・しきい値未満${excludedByThresholdCount}件を除外した上で、OGP画像を取得できた最高スコア(${found.candidate.score})の候補を選定。${languageNote}`,
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
  const result = await selectNextPost(candidates, history);

  if (!result.selected) {
    log.warn("no eligible candidate to post, skipping", { reason: result.reason });
  } else {
    log.info("selected post candidate", {
      title: result.selected.title,
      url: result.selected.url,
      score: result.selected.score,
      reason: result.reason,
      ogpImageUrl: result.ogpImage?.url,
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
        ogpImageUrl: result.ogpImage?.url,
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
