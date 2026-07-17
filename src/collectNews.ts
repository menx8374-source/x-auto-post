#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";
import { scoreCandidates, type ScorableCandidate } from "./scoring.js";
import type { SourceFetcher } from "./types.js";
import { normalizeUrl } from "./urlUtil.js";
import { getAccountProfile, type AccountProfile } from "./accounts.js";

const MIN_CANDIDATES = 10;

/** 検証用: 意図的に「古く話題も伸びていない」記事を候補に混ぜる(--inject-decoy 時のみ) */
function buildDecoyCandidate(): ScorableCandidate {
  const fortyFiveDaysAgo = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
  return {
    title: "【検証用ダミー】1ヶ月以上前のAI関連記事で話題も伸びていない",
    url: "https://example.com/decoy-old-ai-article",
    source: "デコイ(検証用)",
    publishedAt: fortyFiveDaysAgo.toISOString(),
    engagementRaw: 0,
  };
}

async function collectAllCandidates(sources: SourceFetcher[]): Promise<{
  candidates: ScorableCandidate[];
  failedSources: { source: string; error: string }[];
}> {
  const results = await Promise.allSettled(sources.map((s) => s.fetch()));
  const candidates: ScorableCandidate[] = [];
  const failedSources: { source: string; error: string }[] = [];

  results.forEach((result, i) => {
    const sourceName = sources[i].name;
    if (result.status === "fulfilled") {
      log.info(`source ok: ${sourceName} (${result.value.length} items)`);
      candidates.push(...result.value);
    } else {
      const reason = result.reason instanceof Error ? result.reason.message : String(result.reason);
      // 想定内のソース通信失敗。処理全体は止めずログに残す(warnはエラーに数えない)
      log.warn(`source failed, skipping: ${sourceName}`, { reason });
      failedSources.push({ source: sourceName, error: reason });
    }
  });

  return { candidates, failedSources };
}

function dedupeByUrl(candidates: ScorableCandidate[]): ScorableCandidate[] {
  const seen = new Map<string, ScorableCandidate>();
  for (const c of candidates) {
    const key = normalizeUrl(c.url);
    if (!seen.has(key)) {
      seen.set(key, c);
    }
  }
  return [...seen.values()];
}

export async function collectAndScoreNews(
  options: { injectDecoy?: boolean; account?: AccountProfile } = {}
) {
  const account = options.account ?? getAccountProfile();
  log.info("collecting AI news candidates from sources", {
    sourceCount: account.sources.length,
    accountId: account.id,
  });

  const { candidates: rawCandidates, failedSources } = await collectAllCandidates(account.sources);
  const deduped = dedupeByUrl(rawCandidates);
  const filtered = account.filterCandidates(deduped);

  if (options.injectDecoy) {
    filtered.push(buildDecoyCandidate());
    log.info("injected decoy candidate for demo verification");
  }

  const scored = scoreCandidates(filtered);

  if (scored.length < MIN_CANDIDATES) {
    log.warn(
      `collected only ${scored.length} candidates, below the target minimum of ${MIN_CANDIDATES}`
    );
  } else {
    log.info(`collected ${scored.length} AI news candidates`);
  }

  return { scored, failedSources, rawCount: rawCandidates.length };
}

function printTable(candidates: ReturnType<typeof scoreCandidates>) {
  const rows = candidates.map((c, i) => ({
    rank: i + 1,
    score: c.score,
    title: c.title.length > 60 ? `${c.title.slice(0, 57)}...` : c.title,
    source: c.source,
    publishedAt: c.publishedAt,
  }));
  console.table(rows);
}

async function main() {
  const args = process.argv.slice(2);
  const injectDecoy = args.includes("--inject-decoy");

  const { scored, failedSources } = await collectAndScoreNews({ injectDecoy });

  printTable(scored);

  const outDir = path.join(process.cwd(), "data", "output");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "latest-candidates.json");
  await writeFile(
    outFile,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        candidateCount: scored.length,
        failedSources,
        candidates: scored,
      },
      null,
      2
    ),
    "utf-8"
  );
  log.info(`wrote structured candidate data to ${outFile}`);
}

// このファイルが直接実行された場合のみ main() を走らせる(テストからのimport時は実行しない)
const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    log.error("fatal error during news collection", {
      message: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  });
}
