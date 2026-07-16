import { fetchWithTimeout } from "../http.js";
import type { SourceFetcher } from "../types.js";
import type { ScorableCandidate } from "../scoring.js";

interface AlgoliaHnHit {
  objectID: string;
  title: string | null;
  url: string | null;
  created_at: string;
  points: number | null;
  num_comments: number | null;
}

interface AlgoliaHnResponse {
  hits: AlgoliaHnHit[];
}

// Algolia の検索は複数語をOR結合するブーリアン構文をサポートしないため、
// AI関連で最も広くヒットする単一クエリを使い、細かい絞り込みはaiFilter側で行う。
const QUERY = "AI";
const CUTOFF_HOURS = 72;

function buildEndpoint(): string {
  const cutoffEpochSeconds = Math.floor((Date.now() - CUTOFF_HOURS * 60 * 60 * 1000) / 1000);
  return `https://hn.algolia.com/api/v1/search_by_date?tags=story&query=${encodeURIComponent(
    QUERY
  )}&numericFilters=created_at_i%3E${cutoffEpochSeconds}&hitsPerPage=100`;
}

/** Hacker News (Algolia Search API 経由)。認証不要の無料API */
export const hackerNewsSource: SourceFetcher = {
  name: "Hacker News",
  async fetch(): Promise<ScorableCandidate[]> {
    const res = await fetchWithTimeout(buildEndpoint());
    const data = (await res.json()) as AlgoliaHnResponse;

    return data.hits
      .filter((hit) => !!hit.title)
      .map((hit) => ({
        title: hit.title as string,
        url: hit.url ?? `https://news.ycombinator.com/item?id=${hit.objectID}`,
        source: "Hacker News",
        publishedAt: new Date(hit.created_at).toISOString(),
        engagementRaw: (hit.points ?? 0) + (hit.num_comments ?? 0) * 2,
      }));
  },
};
