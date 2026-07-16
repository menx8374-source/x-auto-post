import type { NewsCandidate } from "./types.js";

/** スコアリング前の候補。ソース固有の生エンゲージメント値(HNのpoints等)を持てる */
export interface ScorableCandidate extends NewsCandidate {
  /** ソース固有の生エンゲージメント値(例: HNの points+comments*2、Redditの score+comments*2)。無い場合は0扱い */
  engagementRaw?: number;
}

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "with", "is", "at",
  "by", "as", "its", "it", "this", "that", "are", "be", "will", "how", "why",
  "what", "new", "says", "said", "after", "into", "from", "your", "you",
  "about", "than", "now", "can", "could", "has", "have", "not", "but", "or",
]);

/** タイトルから話題クラスタリング用の重要キーワード集合を抽出する */
function extractKeywords(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return new Set(words);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) {
    if (b.has(w)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const CLUSTER_SIMILARITY_THRESHOLD = 0.4;

/**
 * 各候補について、タイトルが直接類似している(閾値以上の)候補群の情報源数を
 * 「同一トピックを報じている異なる情報源の数(mentionCount)」として付与する。
 * 複数ソースでの言及=話題性シグナル。
 *
 * 注意: Union-Find等で推移的にクラスタを併合すると、A~B・B~Cがそれぞれ閾値以上でも
 * A~C自体は閾値未満という「橋渡し」パターンで無関係なAとCが同一クラスタに
 * 併合されてしまう(Cのmention countが無関係なAの存在で不当に加算される)。
 * これを避けるため、各候補ペアの直接類似度のみを見て判定する(推移的併合はしない)。
 */
function computeMentionCounts(candidates: ScorableCandidate[]): number[] {
  const keywordSets = candidates.map((c) => extractKeywords(c.title));
  const n = candidates.length;
  return candidates.map((c, i) => {
    const sources = new Set<string>([c.source]);
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      if (jaccardSimilarity(keywordSets[i], keywordSets[j]) >= CLUSTER_SIMILARITY_THRESHOLD) {
        sources.add(candidates[j].source);
      }
    }
    return sources.size;
  });
}

function minMaxNormalize(values: number[]): number[] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max - min < 1e-9) {
    return values.map(() => 50);
  }
  return values.map((v) => ((v - min) / (max - min)) * 100);
}

export interface ScoringOptions {
  /** 現在時刻(テスト用に注入可能) */
  now?: Date;
  /** 直近性の半減期(時間)。小さいほど新しさを重視する */
  freshnessHalfLifeHours?: number;
  /** 最終スコアにおける直近性の重み(0-1)。残りがbuzzの重み */
  freshnessWeight?: number;
}

/**
 * F1: 「新しさ(直近性)」と「話題の伸び(複数ソース言及・エンゲージメント)」の
 * 両方を反映した急上昇スコアを付与し、スコア降順にソートして返す。
 */
export function scoreCandidates(
  candidates: ScorableCandidate[],
  options: ScoringOptions = {}
): NewsCandidate[] {
  const now = options.now ?? new Date();
  const halfLife = options.freshnessHalfLifeHours ?? 8;
  const freshnessWeight = options.freshnessWeight ?? 0.5;
  const buzzWeight = 1 - freshnessWeight;

  if (candidates.length === 0) return [];

  const freshnessScores = candidates.map((c) => {
    // 公開時刻が不明な候補は、収集実行時刻へのフォールバックによって
    // 不当に「最大の新しさ」を得ることがないよう、鮮度スコアを最小(0)にする。
    if (c.publishedAtUnknown) return 0;
    const hoursSince = (now.getTime() - new Date(c.publishedAt).getTime()) / (1000 * 60 * 60);
    const clamped = Math.max(hoursSince, 0);
    return Math.exp(-clamped / halfLife) * 100;
  });

  const mentionCounts = computeMentionCounts(candidates);

  const buzzRaw = candidates.map((c, i) => {
    const mentionBoost = Math.log2(mentionCounts[i] + 1) * 10;
    const engagementBoost = Math.log2((c.engagementRaw ?? 0) + 1) * 5;
    return mentionBoost + engagementBoost;
  });
  const buzzScores = minMaxNormalize(buzzRaw);

  const scored: NewsCandidate[] = candidates.map((c, i) => {
    const finalScore = freshnessWeight * freshnessScores[i] + buzzWeight * buzzScores[i];
    return {
      title: c.title,
      url: c.url,
      source: c.source,
      publishedAt: c.publishedAt,
      score: Math.round(finalScore * 100) / 100,
      scoreBreakdown: {
        freshness: Math.round(freshnessScores[i] * 100) / 100,
        buzz: Math.round(buzzScores[i] * 100) / 100,
        mentionCount: mentionCounts[i],
        engagement: c.engagementRaw ?? 0,
      },
    };
  });

  scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return scored;
}
