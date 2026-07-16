import { test } from "node:test";
import assert from "node:assert/strict";
import { selectNextPost } from "../src/selectPost.js";
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

test("候補から最高スコアの1件が選定され、タイトル・URL・スコアが結果に含まれる", () => {
  const candidates = [
    candidate({ url: "https://a.example.com/1", title: "OpenAI releases GPT-6", score: 80 }),
    candidate({ url: "https://b.example.com/1", title: "Startup raises funding for AI tool", score: 40 }),
  ];

  const result = selectNextPost(candidates, []);

  assert.ok(result.selected);
  assert.equal(result.selected?.url, "https://a.example.com/1");
  assert.equal(result.selected?.score, 80);
  assert.match(result.reason, /80/);
  assert.equal(result.consideredCount, 2);
});

test("履歴に記録済みのURL(既出)は選定対象から除外される", () => {
  const candidates = [
    candidate({ url: "https://a.example.com/1", title: "OpenAI releases GPT-6", score: 90 }),
    candidate({ url: "https://b.example.com/1", title: "Startup raises funding for AI tool", score: 40 }),
  ];
  const history = [historyEntry({ url: "https://a.example.com/1", title: "OpenAI releases GPT-6" })];

  const result = selectNextPost(candidates, history);

  assert.ok(result.selected);
  assert.equal(result.selected?.url, "https://b.example.com/1");
  assert.equal(result.excludedAsDuplicateCount, 1);
});

test("URLの表記ゆれ(末尾スラッシュ・大文字小文字)があっても既出として除外される", () => {
  const candidates = [candidate({ url: "https://A.example.com/Article/", title: "OpenAI releases GPT-6", score: 90 })];
  const history = [historyEntry({ url: "https://a.example.com/article", title: "OpenAI releases GPT-6" })];

  const result = selectNextPost(candidates, history);

  assert.equal(result.selected, null);
  assert.equal(result.excludedAsDuplicateCount, 1);
});

test("URLが異なっても実質同一記事(タイトルが酷似)は既出として除外される", () => {
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

  const result = selectNextPost(candidates, history);

  assert.equal(result.selected, null);
  assert.equal(result.excludedAsDuplicateCount, 1);
});

test("有効な候補が0件の場合、選定結果はnullで理由がログに残せる文字列になる", () => {
  const candidates = [candidate({ url: "https://a.example.com/1", title: "OpenAI releases GPT-6", score: 90 })];
  const history = [historyEntry({ url: "https://a.example.com/1", title: "OpenAI releases GPT-6" })];

  const result = selectNextPost(candidates, history);

  assert.equal(result.selected, null);
  assert.ok(result.reason.length > 0);
  assert.match(result.reason, /スキップ/);
});

test("候補が空配列でも(有効候補0件として)安全にスキップ扱いになる", () => {
  const result = selectNextPost([], []);
  assert.equal(result.selected, null);
  assert.equal(result.consideredCount, 0);
});

test("スコアがしきい値以下の候補は既出でなくても選定されない", () => {
  const candidates = [candidate({ url: "https://a.example.com/1", title: "Old and cold AI article", score: 0 })];
  const result = selectNextPost(candidates, []);
  assert.equal(result.selected, null);
  assert.equal(result.excludedByThresholdCount, 1);
});

test("同一日に2回選定すると、1回目の記事は2回目で除外され別の記事が選ばれる(擬似的な同日2回実行)", () => {
  const candidates = [
    candidate({ url: "https://a.example.com/1", title: "OpenAI releases GPT-6", score: 90 }),
    candidate({ url: "https://b.example.com/1", title: "Google DeepMind unveils new Gemini model", score: 70 }),
  ];

  // 1回目の実行(履歴なし)
  const firstRun = selectNextPost(candidates, []);
  assert.equal(firstRun.selected?.url, "https://a.example.com/1");

  // 1回目の選定結果を履歴に反映してから2回目を同日に実行
  const historyAfterFirstRun: PostHistoryEntry[] = [
    historyEntry({ url: firstRun.selected!.url, title: firstRun.selected!.title }),
  ];
  const secondRun = selectNextPost(candidates, historyAfterFirstRun);

  assert.ok(secondRun.selected);
  assert.notEqual(secondRun.selected?.url, firstRun.selected?.url);
  assert.equal(secondRun.selected?.url, "https://b.example.com/1");
});

test("同日3回実行し候補が尽きると3回目は理由付きでスキップされる", () => {
  const candidates = [
    candidate({ url: "https://a.example.com/1", title: "OpenAI releases GPT-6", score: 90 }),
    candidate({ url: "https://b.example.com/1", title: "Google DeepMind unveils new Gemini model", score: 70 }),
  ];

  let history: PostHistoryEntry[] = [];
  const run1 = selectNextPost(candidates, history);
  history = [...history, historyEntry({ url: run1.selected!.url, title: run1.selected!.title })];

  const run2 = selectNextPost(candidates, history);
  history = [...history, historyEntry({ url: run2.selected!.url, title: run2.selected!.title })];

  const run3 = selectNextPost(candidates, history);

  assert.equal(run3.selected, null);
  assert.equal(run3.excludedAsDuplicateCount, 2);
});
