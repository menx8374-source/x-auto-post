#!/usr/bin/env node
/**
 * アフィリエイト商品の「おすすめ候補」参考情報(読み取り専用のヒント)を生成する。
 *
 * ユーザー要望「アフィリエイト商品の内容もおすすめのものを教えるようにしてほしい」に対応するための
 * 参考情報。実際のアフィリエイトリンクはA8.net等への実登録が必要でユーザー本人にしかできないため、
 * ここで自動生成するのはあくまで「最近話題になっているAI関連ニュース・トピック」の一覧(参考情報)の
 * みにとどめる(商品そのものやアフィリエイトリンクを自動生成・自動登録することはしない)。
 *
 * 既存の本番投稿パイプライン(src/pipeline.ts, src/publish.ts, src/dryRun.ts)とは完全に独立しており、
 * それらをimportも変更もしない。既存の `src/collectNews.ts` の `collectAndScoreNews()` を
 * 読み取り専用で呼び出すだけ(引数なし=デフォルトアカウント)。
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.js";
import { collectAndScoreNews } from "./collectNews.js";
import { isHttpUrl } from "./ogpImage.js";
import type { NewsCandidate } from "./types.js";

export const DEFAULT_CANDIDATE_HINTS_FILE = path.join(process.cwd(), "data", "affiliate-candidate-hints.json");

/** 書き出す候補ヒントの上限件数 */
export const TOP_N_HINTS = 15;

export interface CandidateHintItem {
  title: string;
  url: string;
  source: string;
  score?: number;
}

export interface CandidateHintsFile {
  generatedAt: string;
  items: CandidateHintItem[];
}

/**
 * 収集・スコアリング済みのニュース候補から、参考情報として書き出すヒント一覧を組み立てる。
 * `collectFn`はテスト用の差し替えポイント(既定は本物の`collectAndScoreNews`)。
 */
export async function generateCandidateHints(
  outFile: string = DEFAULT_CANDIDATE_HINTS_FILE,
  collectFn: () => Promise<{ scored: NewsCandidate[] }> = collectAndScoreNews
): Promise<CandidateHintsFile> {
  const { scored } = await collectFn();

  // admin/public/app.jsはこのファイルのurlをそのまま<a href>に埋め込むため、他のURLフィールド
  // (officialUrl/affiliateUrl/imageUrl、src/affiliateProducts.ts等)と同じくhttp:/https:以外
  // (javascript:等)のURLはここで除外する。収集元(HN/Reddit/RSS)は通常http/httpsのみ返すが、
  // ソース側の不具合・将来の情報源追加に備えた安全網。
  const httpOnlyScored = scored.filter((c) => {
    if (!isHttpUrl(c.url)) {
      log.warn("excluded candidate hint: url is not http:/https:", { url: c.url, source: c.source });
      return false;
    }
    return true;
  });

  const items: CandidateHintItem[] = httpOnlyScored.slice(0, TOP_N_HINTS).map((c) => ({
    title: c.title,
    url: c.url,
    source: c.source,
    score: c.score,
  }));

  const payload: CandidateHintsFile = {
    generatedAt: new Date().toISOString(),
    items,
  };

  await writeFile(outFile, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  log.info(`wrote ${items.length} affiliate candidate hint(s) to ${outFile}`);
  return payload;
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  generateCandidateHints().catch((err) => {
    log.error("fatal error during affiliate candidate hints generation", {
      message: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  });
}
