import { test } from "node:test";
import assert from "node:assert/strict";
import { selectNextPost, MAX_OGP_ATTEMPTS_PER_GROUP, type FetchOgpImageFn } from "../src/selectPost.js";
import type { OgpImage } from "../src/ogpImage.js";
import type { NewsCandidate, PostHistoryEntry } from "../src/types.js";

function candidate(overrides: Partial<NewsCandidate> & { url: string; title: string }): NewsCandidate {
  return {
    source: "Hacker News",
    publishedAt: "2026-07-16T00:00:00.000Z",
    score: 50,
    ...overrides,
  };
}

function historyEntry(overrides: Partial<PostHistoryEntry> & { url: string; title: string }): PostHistoryEntry {
  return {
    normalizedUrl: overrides.url.trim().replace(/\/$/, "").toLowerCase(),
    selectedAt: "2026-07-15T00:00:00.000Z",
    ...overrides,
  };
}

function fakeOgpImage(url: string): OgpImage {
  return { url: `${url}/ogp.png`, buffer: Buffer.from("fake-image-bytes"), contentType: "image/png" };
}

/** すべての候補についてOGP画像が取得できたことにするモック(既存の言語優先ロジックのみを検証するテスト用) */
const alwaysHasOgp: FetchOgpImageFn = async (url) => fakeOgpImage(url);

/** 指定したURL集合の候補だけOGP画像が取得できることにするモック */
function ogpForUrls(urls: string[]): FetchOgpImageFn {
  const allowed = new Set(urls);
  return async (url) => (allowed.has(url) ? fakeOgpImage(url) : null);
}

/** どの候補もOGP画像を取得できないモック */
const neverHasOgp: FetchOgpImageFn = async () => null;

test("候補から最高スコアの1件が選定され、タイトル・URL・スコアが結果に含まれる", async () => {
  const candidates = [
    candidate({ url: "https://a.example.com/1", title: "OpenAI releases GPT-6", score: 80 }),
    candidate({ url: "https://b.example.com/1", title: "Startup raises funding for AI tool", score: 40 }),
  ];

  const result = await selectNextPost(candidates, [], alwaysHasOgp);

  assert.ok(result.selected);
  assert.equal(result.selected?.url, "https://a.example.com/1");
  assert.equal(result.selected?.score, 80);
  assert.match(result.reason, /80/);
  assert.equal(result.consideredCount, 2);
  assert.ok(result.ogpImage);
});

test("履歴に記録済みのURL(既出)は選定対象から除外される", async () => {
  const candidates = [
    candidate({ url: "https://a.example.com/1", title: "OpenAI releases GPT-6", score: 90 }),
    candidate({ url: "https://b.example.com/1", title: "Startup raises funding for AI tool", score: 40 }),
  ];
  const history = [historyEntry({ url: "https://a.example.com/1", title: "OpenAI releases GPT-6" })];

  const result = await selectNextPost(candidates, history, alwaysHasOgp);

  assert.ok(result.selected);
  assert.equal(result.selected?.url, "https://b.example.com/1");
  assert.equal(result.excludedAsDuplicateCount, 1);
});

test("URLの表記ゆれ(末尾スラッシュ・大文字小文字)があっても既出として除外される", async () => {
  const candidates = [candidate({ url: "https://A.example.com/Article/", title: "OpenAI releases GPT-6", score: 90 })];
  const history = [historyEntry({ url: "https://a.example.com/article", title: "OpenAI releases GPT-6" })];

  const result = await selectNextPost(candidates, history, alwaysHasOgp);

  assert.equal(result.selected, null);
  assert.equal(result.excludedAsDuplicateCount, 1);
});

test("URLが異なっても実質同一記事(タイトルが酷似)は既出として除外される", async () => {
  const candidates = [
    candidate({
      url: "https://mirror.example.com/gpt6-launch",
      title: "OpenAI releases GPT-6 with major reasoning upgrade",
      score: 90,
    }),
  ];
  const history = [
    historyEntry({ url: "https://a.example.com/1", title: "OpenAI releases GPT-6 with major reasoning upgrade today" }),
  ];

  const result = await selectNextPost(candidates, history, alwaysHasOgp);

  assert.equal(result.selected, null);
  assert.equal(result.excludedAsDuplicateCount, 1);
});

test("有効な候補が0件の場合、選定結果はnullで理由がログに残せる文字列になる", async () => {
  const candidates = [candidate({ url: "https://a.example.com/1", title: "OpenAI releases GPT-6", score: 90 })];
  const history = [historyEntry({ url: "https://a.example.com/1", title: "OpenAI releases GPT-6" })];

  const result = await selectNextPost(candidates, history, alwaysHasOgp);

  assert.equal(result.selected, null);
  assert.ok(result.reason.length > 0);
  assert.match(result.reason, /スキップ/);
});

test("候補が空配列でも(有効候補0件として)安全にスキップ扱いになる", async () => {
  const result = await selectNextPost([], [], alwaysHasOgp);
  assert.equal(result.selected, null);
  assert.equal(result.consideredCount, 0);
});

test("スコアがしきい値以下の候補は既出でなくても選定されない", async () => {
  const candidates = [candidate({ url: "https://a.example.com/1", title: "Old and cold AI article", score: 0 })];
  const result = await selectNextPost(candidates, [], alwaysHasOgp);
  assert.equal(result.selected, null);
  assert.equal(result.excludedByThresholdCount, 1);
});

test("同一日に2回選定すると、1回目の記事は2回目で除外され別の記事が選ばれる(擬似的な同日2回実行)", async () => {
  const candidates = [
    candidate({ url: "https://a.example.com/1", title: "OpenAI releases GPT-6", score: 90 }),
    candidate({ url: "https://b.example.com/1", title: "Google DeepMind unveils new Gemini model", score: 70 }),
  ];

  // 1回目の実行(履歴なし)
  const firstRun = await selectNextPost(candidates, [], alwaysHasOgp);
  assert.equal(firstRun.selected?.url, "https://a.example.com/1");

  // 1回目の選定結果を履歴に反映してから2回目を同日に実行
  const historyAfterFirstRun: PostHistoryEntry[] = [
    historyEntry({ url: firstRun.selected!.url, title: firstRun.selected!.title }),
  ];
  const secondRun = await selectNextPost(candidates, historyAfterFirstRun, alwaysHasOgp);

  assert.ok(secondRun.selected);
  assert.notEqual(secondRun.selected?.url, firstRun.selected?.url);
  assert.equal(secondRun.selected?.url, "https://b.example.com/1");
});

test("日本語ソースと英語ソースの候補が混在する場合、日本語ソースが優先して選定される(英語ソースの方が高スコアでも)", async () => {
  const candidates = [
    candidate({
      url: "https://en.example.com/1",
      title: "OpenAI releases GPT-6",
      source: "TechCrunch AI",
      language: "en",
      score: 95,
    }),
    candidate({
      url: "https://ja.example.com/1",
      title: "OpenAIが新モデルGPT-6を発表",
      source: "ITmedia AI+",
      language: "ja",
      score: 60,
    }),
  ];

  const result = await selectNextPost(candidates, [], alwaysHasOgp);

  assert.ok(result.selected);
  assert.equal(result.selected?.url, "https://ja.example.com/1");
  assert.match(result.reason, /日本語ソースを優先選定/);
});

test("有効な日本語候補が複数ある場合はその中で最高スコアの1件が選ばれる", async () => {
  const candidates = [
    candidate({
      url: "https://en.example.com/1",
      title: "OpenAI releases GPT-6",
      source: "TechCrunch AI",
      language: "en",
      score: 95,
    }),
    candidate({
      url: "https://ja.example.com/1",
      title: "OpenAIが新モデルGPT-6を発表",
      source: "ITmedia AI+",
      language: "ja",
      score: 60,
    }),
    candidate({
      url: "https://ja.example.com/2",
      title: "生成AIの新サービスがリリース",
      source: "AINOW",
      language: "ja",
      score: 75,
    }),
  ];

  const result = await selectNextPost(candidates, [], alwaysHasOgp);

  assert.equal(result.selected?.url, "https://ja.example.com/2");
});

test("有効な日本語候補が0件の場合は英語ソースを含めた全候補から最高スコアが選ばれる(フォールバック)", async () => {
  const candidates = [
    candidate({
      url: "https://en.example.com/1",
      title: "OpenAI releases GPT-6",
      source: "TechCrunch AI",
      language: "en",
      score: 95,
    }),
    candidate({
      url: "https://en.example.com/2",
      title: "Google DeepMind unveils new Gemini model",
      source: "The Verge AI",
      language: "en",
      score: 40,
    }),
  ];

  const result = await selectNextPost(candidates, [], alwaysHasOgp);

  assert.equal(result.selected?.url, "https://en.example.com/1");
  assert.match(result.reason, /日本語候補が無かったため英語ソースから選定/);
});

test("日本語候補が既出/しきい値未満で除外され有効候補として残らない場合、英語ソースへフォールバックする", async () => {
  const candidates = [
    candidate({
      url: "https://ja.example.com/1",
      title: "OpenAIが新モデルGPT-6を発表",
      source: "ITmedia AI+",
      language: "ja",
      score: 60,
    }),
    candidate({
      url: "https://en.example.com/1",
      title: "OpenAI releases GPT-6",
      source: "TechCrunch AI",
      language: "en",
      score: 95,
    }),
  ];
  const history = [historyEntry({ url: "https://ja.example.com/1", title: "OpenAIが新モデルGPT-6を発表" })];

  const result = await selectNextPost(candidates, history, alwaysHasOgp);

  assert.equal(result.selected?.url, "https://en.example.com/1");
  assert.match(result.reason, /日本語候補が無かったため英語ソースから選定/);
});

test("同日3回実行し候補が尽きると3回目は理由付きでスキップされる", async () => {
  const candidates = [
    candidate({ url: "https://a.example.com/1", title: "OpenAI releases GPT-6", score: 90 }),
    candidate({ url: "https://b.example.com/1", title: "Google DeepMind unveils new Gemini model", score: 70 }),
  ];

  let history: PostHistoryEntry[] = [];
  const run1 = await selectNextPost(candidates, history, alwaysHasOgp);
  history = [...history, historyEntry({ url: run1.selected!.url, title: run1.selected!.title })];

  const run2 = await selectNextPost(candidates, history, alwaysHasOgp);
  history = [...history, historyEntry({ url: run2.selected!.url, title: run2.selected!.title })];

  const run3 = await selectNextPost(candidates, history, alwaysHasOgp);

  assert.equal(run3.selected, null);
  assert.equal(run3.excludedAsDuplicateCount, 2);
});

// --- OGP画像を選定条件に含める機能のテスト ---

test("OGP画像: 日本語優先グループ内で、OGP画像を持たない最高スコア候補は棄却され、画像を持つ次点の候補が選定される", async () => {
  const candidates = [
    candidate({
      url: "https://ja.example.com/no-ogp",
      title: "OGP画像が無いニュース",
      source: "ITmedia AI+",
      language: "ja",
      score: 90, // 最高スコアだがOGP画像なし
    }),
    candidate({
      url: "https://ja.example.com/has-ogp",
      title: "OGP画像があるニュース",
      source: "AINOW",
      language: "ja",
      score: 70,
    }),
    candidate({
      url: "https://en.example.com/has-ogp",
      title: "English news with OGP image",
      source: "TechCrunch AI",
      language: "en",
      score: 99,
    }),
  ];

  const fetchOgpImage = ogpForUrls(["https://ja.example.com/has-ogp", "https://en.example.com/has-ogp"]);

  const result = await selectNextPost(candidates, [], fetchOgpImage);

  assert.ok(result.selected);
  assert.equal(result.selected?.url, "https://ja.example.com/has-ogp");
  assert.ok(result.ogpImage);
  assert.equal(result.ogpImage?.url, "https://ja.example.com/has-ogp/ogp.png");
});

test("OGP画像: 日本語グループが全滅した場合、英語フォールバックグループ内でもOGP画像を持たない最高スコア候補は棄却され、画像を持つ次点の候補が選定される", async () => {
  const candidates = [
    candidate({
      url: "https://ja.example.com/no-ogp",
      title: "OGP画像が無い日本語ニュース",
      source: "ITmedia AI+",
      language: "ja",
      score: 95,
    }),
    candidate({
      url: "https://en.example.com/no-ogp",
      title: "OGP画像が無い英語ニュース(最高スコア)",
      source: "TechCrunch AI",
      language: "en",
      score: 90,
    }),
    candidate({
      url: "https://en.example.com/has-ogp",
      title: "OGP画像がある英語ニュース",
      source: "The Verge AI",
      language: "en",
      score: 60,
    }),
  ];

  const fetchOgpImage = ogpForUrls(["https://en.example.com/has-ogp"]);

  const result = await selectNextPost(candidates, [], fetchOgpImage);

  assert.ok(result.selected);
  assert.equal(result.selected?.url, "https://en.example.com/has-ogp");
  assert.match(result.reason, /日本語候補にOGP画像を持つものが無かったため英語ソースから選定/);
  assert.ok(result.ogpImage);
});

test("OGP画像: 全候補(日本語・英語とも)がOGP画像を持たない場合、投稿はスキップされ理由がログに残る", async () => {
  const candidates = [
    candidate({
      url: "https://ja.example.com/1",
      title: "OGP画像が無い日本語ニュース",
      source: "ITmedia AI+",
      language: "ja",
      score: 90,
    }),
    candidate({
      url: "https://en.example.com/1",
      title: "OGP画像が無い英語ニュース",
      source: "TechCrunch AI",
      language: "en",
      score: 80,
    }),
  ];

  const result = await selectNextPost(candidates, [], neverHasOgp);

  assert.equal(result.selected, null);
  assert.equal(result.ogpImage, null);
  assert.match(result.reason, /OGP画像を持つ候補が見つからなかったためスキップ/);
});

test("OGP画像: 候補が多数あっても各優先順位グループにつき試行件数には上限があり無制限探索にはならない", async () => {
  // MAX_OGP_ATTEMPTS_PER_GROUP件を超える数の英語候補を用意し、上限を超えた分は試されないことを
  // fetchOgpImage呼び出し回数で確認する(全滅させ、最終的にスキップされることも合わせて確認)。
  const totalCandidates = MAX_OGP_ATTEMPTS_PER_GROUP + 10;
  const candidates: NewsCandidate[] = Array.from({ length: totalCandidates }, (_, i) =>
    candidate({
      url: `https://en.example.com/${i}`,
      title: `English AI news number ${i}`,
      language: "en",
      score: totalCandidates - i, // 降順スコア
    })
  );

  let callCount = 0;
  const fetchOgpImage: FetchOgpImageFn = async () => {
    callCount++;
    return null;
  };

  const result = await selectNextPost(candidates, [], fetchOgpImage);

  assert.equal(result.selected, null);
  assert.equal(callCount, MAX_OGP_ATTEMPTS_PER_GROUP);
});
