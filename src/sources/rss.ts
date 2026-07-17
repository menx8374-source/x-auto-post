import Parser from "rss-parser";
import { fetchWithTimeout } from "../http.js";
import type { SourceFetcher } from "../types.js";
import type { ScorableCandidate } from "../scoring.js";

const parser = new Parser({ timeout: 10000 });

interface RssFeedDef {
  name: string;
  url: string;
  language: "ja" | "en";
}

// 認証不要で公開されているAI関連RSSフィード。
// エンゲージメント指標(いいね数等)は持たないため、buzzはクラスタリングによる
// 複数ソース言及数(mentionCount)側で評価する。
//
// 日本語ソースは、実際にHTTP取得してRSSとして正しくパースできること・
// AI関連カテゴリ(サイト全体の総合フィードではない)であることを確認した上で採用している
// (2026-07-18時点で動作確認済み。候補として検討したが不採用にしたもの: Impress Watch/
// ASCII.jp/ZDNET Japan/CNET JapanはAI専用カテゴリのRSSフィードが見つからず、
// ledge.ai・robotstart・aismiley・weelはフィード自体が存在しない/空だった)。
const FEEDS: RssFeedDef[] = [
  { name: "TechCrunch AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/", language: "en" },
  { name: "VentureBeat AI", url: "https://venturebeat.com/category/ai/feed/", language: "en" },
  {
    name: "The Verge AI",
    url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
    language: "en",
  },
  {
    name: "Google News (AI)",
    url: "https://news.google.com/rss/search?q=%22artificial+intelligence%22+OR+%22generative+AI%22+when:2d&hl=en-US&gl=US&ceid=US:en",
    language: "en",
  },
  {
    name: "ITmedia AI+",
    url: "https://rss.itmedia.co.jp/rss/2.0/aiplus.xml",
    language: "ja",
  },
  { name: "AINOW", url: "https://ainow.ai/feed/", language: "ja" },
  { name: "AIDB", url: "https://ai-data-base.com/feed", language: "ja" },
];

/**
 * RSS項目から推定公開時刻を解決する。isoDate/pubDateのいずれも無い場合、
 * 収集実行時刻(現在時刻)にフォールバックすると鮮度計算上「最大の新しさ」を
 * 不当に得てしまうため、代わりに「日付不明」を示すプレースホルダ(UNIXエポック=
 * 鮮度スコアが最小になる十分に古い日時)を返し、publishedAtUnknownフラグで
 * それを明示する。
 */
export function resolvePublishedAt(item: {
  isoDate?: string;
  pubDate?: string;
}): { publishedAt: string; publishedAtUnknown: boolean } {
  if (item.isoDate) {
    return { publishedAt: item.isoDate, publishedAtUnknown: false };
  }
  if (item.pubDate) {
    const parsed = new Date(item.pubDate);
    if (!Number.isNaN(parsed.getTime())) {
      return { publishedAt: parsed.toISOString(), publishedAtUnknown: false };
    }
  }
  return { publishedAt: new Date(0).toISOString(), publishedAtUnknown: true };
}

function buildFetcher(def: RssFeedDef): SourceFetcher {
  return {
    name: def.name,
    async fetch(): Promise<ScorableCandidate[]> {
      // rss-parser の parseURL は内部で独自にfetchするため、まずタイムアウト付きfetchで
      // 到達性を確認してから文字列としてparseする(通信失敗を早期に検知するため)。
      const res = await fetchWithTimeout(def.url, {
        headers: { "User-Agent": "xautomode-news-collector/1.0" },
      });
      const xml = await res.text();
      const feed = await parser.parseString(xml);
      return (feed.items ?? [])
        .filter((item) => !!item.title && !!item.link)
        .map((item) => {
          const { publishedAt, publishedAtUnknown } = resolvePublishedAt(item);
          return {
            title: item.title as string,
            url: item.link as string,
            source: def.name,
            publishedAt,
            publishedAtUnknown,
            summary: item.contentSnippet,
            language: def.language,
          };
        });
    },
  };
}

export const rssSources: SourceFetcher[] = FEEDS.map(buildFetcher);
