import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreCandidates, type ScorableCandidate } from "../src/scoring.js";

const NOW = new Date("2026-07-16T12:00:00Z");

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

test("古く話題も伸びていない記事は上位3件に入らない", () => {
  const candidates: ScorableCandidate[] = [
    // 直近かつ複数ソースで言及されている(話題が伸びている)候補群
    { title: "OpenAI releases GPT-6 with major reasoning upgrade", url: "https://a.example.com/1", source: "Hacker News", publishedAt: hoursAgo(1), engagementRaw: 400 },
    { title: "OpenAI's GPT-6 launch stuns AI researchers", url: "https://a.example.com/2", source: "TechCrunch AI", publishedAt: hoursAgo(2), engagementRaw: 0 },
    { title: "GPT-6 from OpenAI sets new reasoning benchmark record", url: "https://a.example.com/3", source: "The Verge AI", publishedAt: hoursAgo(3), engagementRaw: 0 },
    { title: "Google DeepMind unveils new Gemini model with video understanding", url: "https://b.example.com/1", source: "Reddit r/artificial", publishedAt: hoursAgo(2), engagementRaw: 250 },
    { title: "DeepMind's Gemini update adds video understanding capability", url: "https://b.example.com/2", source: "VentureBeat AI", publishedAt: hoursAgo(4), engagementRaw: 0 },
    // 直近だが単独ソースのみ(話題性は弱いが新しい)
    { title: "Anthropic publishes new interpretability research paper", url: "https://c.example.com/1", source: "Hacker News", publishedAt: hoursAgo(5), engagementRaw: 30 },
    { title: "Startup raises funding for AI coding assistant", url: "https://d.example.com/1", source: "TechCrunch AI", publishedAt: hoursAgo(6), engagementRaw: 10 },
    { title: "New open source LLM claims state of the art results", url: "https://e.example.com/1", source: "Reddit r/MachineLearning", publishedAt: hoursAgo(8), engagementRaw: 60 },
    { title: "AI chip startup unveils next generation inference hardware", url: "https://f.example.com/1", source: "VentureBeat AI", publishedAt: hoursAgo(10), engagementRaw: 20 },
    // 意図的に混ぜる「古く話題も伸びていない」デコイ記事
    {
      title: "【検証用ダミー】1ヶ月以上前のAI関連記事で話題も伸びていない",
      url: "https://example.com/decoy-old-ai-article",
      source: "デコイ(検証用)",
      publishedAt: hoursAgo(45 * 24),
      engagementRaw: 0,
    },
  ];

  const scored = scoreCandidates(candidates, { now: NOW });

  assert.equal(scored.length, 10);
  // スコア降順になっていること
  for (let i = 1; i < scored.length; i++) {
    assert.ok((scored[i - 1].score ?? 0) >= (scored[i].score ?? 0), "スコアが降順であること");
  }

  const decoyRank = scored.findIndex((c) => c.url === "https://example.com/decoy-old-ai-article");
  assert.ok(decoyRank >= 0, "デコイ記事が候補リストに含まれること");
  assert.ok(decoyRank >= 3, `デコイ記事は上位3件に入らないはず(実際の順位: ${decoyRank + 1}位)`);
});

test("publishedAtUnknownな候補は鮮度で有利にならない(回帰テスト)", () => {
  const candidates: ScorableCandidate[] = [
    {
      title: "Recent AI news with a known publish time",
      url: "https://known.example.com",
      source: "Hacker News",
      publishedAt: hoursAgo(1),
      engagementRaw: 0,
    },
    {
      title: "AI news item with unknown publish time from RSS feed",
      url: "https://unknown.example.com",
      source: "Some RSS Feed",
      // 実装上、日付不明時はエポック等のプレースホルダが入るが、
      // publishedAtUnknown フラグが立っていれば鮮度スコアは常に0になるべき
      publishedAt: new Date(0).toISOString(),
      publishedAtUnknown: true,
      engagementRaw: 0,
    },
  ];
  const scored = scoreCandidates(candidates, { now: NOW });
  const unknown = scored.find((c) => c.url === "https://unknown.example.com")!;
  const known = scored.find((c) => c.url === "https://known.example.com")!;
  assert.equal(unknown.scoreBreakdown?.freshness, 0, "日付不明の候補の鮮度スコアは0であるべき");
  assert.ok((known.score ?? 0) > (unknown.score ?? 0), "日付が判明している新しい記事の方が高スコアであるべき");
});

test("同条件のエンゲージメントなら新しい記事の方が高スコアになる(直近性の反映)", () => {
  const candidates: ScorableCandidate[] = [
    { title: "Recent AI news about a fresh topic X", url: "https://x.example.com/1", source: "Hacker News", publishedAt: hoursAgo(1), engagementRaw: 0 },
    { title: "Older AI news about an unrelated topic Y", url: "https://y.example.com/1", source: "Hacker News", publishedAt: hoursAgo(40), engagementRaw: 0 },
  ];
  const scored = scoreCandidates(candidates, { now: NOW });
  const recent = scored.find((c) => c.url === "https://x.example.com/1")!;
  const older = scored.find((c) => c.url === "https://y.example.com/1")!;
  assert.ok((recent.score ?? 0) > (older.score ?? 0));
});

test("推移的な橋渡しで無関係な候補のmentionCountが不当に加算されない(回帰テスト)", () => {
  // A(トピックX)~B(トピックXY境界)は類似、B~C(トピックY)も類似だが、
  // A~Cは直接には無関係。Union-Findによる推移的併合だとA/B/Cが同一クラスタに
  // なりCのmentionCountにAのソースが混入してしまう。
  const candidates: ScorableCandidate[] = [
    { title: "Quantum computing breakthrough for researchers", url: "https://a.example.com", source: "Source A", publishedAt: hoursAgo(2), engagementRaw: 0 },
    { title: "Quantum computing breakthrough in new hardware release chipset", url: "https://b.example.com", source: "Source B", publishedAt: hoursAgo(2), engagementRaw: 0 },
    { title: "New hardware release chipset for pricing", url: "https://c.example.com", source: "Source C", publishedAt: hoursAgo(2), engagementRaw: 0 },
  ];
  const scored = scoreCandidates(candidates, { now: NOW });
  const a = scored.find((c) => c.url === "https://a.example.com")!;
  const c = scored.find((c) => c.url === "https://c.example.com")!;
  // AとCは直接類似していないため、互いのmentionCountに相手のソースが含まれてはならない(2件=自身+橋渡し1件)
  assert.equal(a.scoreBreakdown?.mentionCount, 2, "Aのmention countはA自身とBのみ(Cを含まない)");
  assert.equal(c.scoreBreakdown?.mentionCount, 2, "Cのmention countはC自身とBのみ(Aを含まない)");
});

test("複数ソースで言及されている話題の方が単独ソースより高い話題性スコアになる", () => {
  const candidates: ScorableCandidate[] = [
    { title: "Big AI model launch announcement today", url: "https://m1.example.com", source: "Hacker News", publishedAt: hoursAgo(2), engagementRaw: 0 },
    { title: "Big AI model launch announcement covered widely", url: "https://m2.example.com", source: "TechCrunch AI", publishedAt: hoursAgo(2), engagementRaw: 0 },
    { title: "Big AI model launch announcement everywhere today", url: "https://m3.example.com", source: "VentureBeat AI", publishedAt: hoursAgo(2), engagementRaw: 0 },
    { title: "Unrelated niche AI tooling update for developers", url: "https://n1.example.com", source: "Hacker News", publishedAt: hoursAgo(2), engagementRaw: 0 },
  ];
  const scored = scoreCandidates(candidates, { now: NOW });
  const clustered = scored.find((c) => c.url === "https://m1.example.com")!;
  const isolated = scored.find((c) => c.url === "https://n1.example.com")!;
  assert.ok((clustered.scoreBreakdown?.mentionCount ?? 0) > (isolated.scoreBreakdown?.mentionCount ?? 0));
  assert.ok((clustered.score ?? 0) > (isolated.score ?? 0));
});
