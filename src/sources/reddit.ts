import { fetchWithTimeout } from "../http.js";
import type { SourceFetcher } from "../types.js";
import type { ScorableCandidate } from "../scoring.js";

interface RedditPostData {
  title: string;
  url: string;
  permalink: string;
  created_utc: number;
  score: number;
  num_comments: number;
  is_self: boolean;
}

interface RedditListing {
  data: {
    children: { data: RedditPostData }[];
  };
}

const SUBREDDITS = ["artificial", "MachineLearning", "OpenAI"];

function buildFetcher(subreddit: string): SourceFetcher {
  return {
    name: `Reddit r/${subreddit}`,
    async fetch(): Promise<ScorableCandidate[]> {
      const res = await fetchWithTimeout(
        `https://www.reddit.com/r/${subreddit}/top.json?t=day&limit=25`,
        {
          headers: {
            // Reddit は User-Agent 未設定のリクエストを弾くことがあるため付与
            "User-Agent": "xautomode-news-collector/1.0 (by u/xautomode)",
          },
        }
      );
      const data = (await res.json()) as RedditListing;
      return data.data.children
        .filter((c) => !!c.data.title)
        .map((c) => ({
          title: c.data.title,
          url: c.data.is_self
            ? `https://www.reddit.com${c.data.permalink}`
            : c.data.url,
          source: `Reddit r/${subreddit}`,
          publishedAt: new Date(c.data.created_utc * 1000).toISOString(),
          language: "en",
          engagementRaw: (c.data.score ?? 0) + (c.data.num_comments ?? 0) * 2,
        }));
    },
  };
}

/** 主要AIサブレディットの当日トップ投稿。認証不要の公開JSONエンドポイント */
export const redditSources: SourceFetcher[] = SUBREDDITS.map(buildFetcher);
