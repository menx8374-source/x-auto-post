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
 *
 * 追加(商品候補の自動検出): 各ニュース項目が「特定の名前を持つ商業的なAI関連の製品・ツール・
 * サービス」を主題にしているかをClaude(Anthropic API)で分類し、該当する場合は商品候補情報
 * (productCandidate)を付加する。
 *
 * 【重要な設計制約(ハルシネーション対策・法令順守)】ニュースのタイトルだけを情報源とするため、
 * モデルには「分類(製品か否か)・製品名の抽出・(記事URL自体がその製品の公式サイトらしい場合のみ)
 * 公式URLの推測」のみを行わせ、商品の特長・スペック・効果等の「事実」情報は一切生成させない。
 * src/generateAffiliatePost.tsと同じく「事実に無い特長を創作しない」が最重要制約(景品表示法対応)。
 * facts配列は空のまま返し、ユーザーが公式サイトを見て自分で入力する運用を維持する。
 *
 * トークン節約のため、15件のタイトルを1件ずつAPI呼び出しするのではなく、まとめて1回のAPI呼び出しで
 * JSON配列として分類結果を受け取る(docs/spec/x-ai-news-autopost-architecture.mdの方針に合わせる)。
 */
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type Anthropic from "@anthropic-ai/sdk";
import { log } from "./logger.js";
import { collectAndScoreNews } from "./collectNews.js";
import { isHttpUrl } from "./ogpImage.js";
import {
  extractTextFromResponse,
  createAnthropicClient,
  DEFAULT_MODEL,
  type AnthropicMessageClient,
} from "./generatePost.js";
import { getAccountProfile, resolveCredentialEnvVarName, type AccountProfile } from "./accounts.js";
import type { NewsCandidate } from "./types.js";

export const DEFAULT_CANDIDATE_HINTS_FILE = path.join(process.cwd(), "data", "affiliate-candidate-hints.json");

/** 書き出す候補ヒントの上限件数 */
export const TOP_N_HINTS = 15;

/** 商品候補分類の呼び出しに使う最大出力トークン数(最大15件分のJSON配列を返すため多めに確保) */
export const MAX_CLASSIFICATION_OUTPUT_TOKENS = 1500;

export interface ProductCandidate {
  /** ニュースタイトルから抽出した製品/ツール/サービス名(事実情報は含まない、名称のみ) */
  name: string;
  /** タイトル/URLから明確に読み取れる場合のみの公式サイトURL推測。不明な場合はnull */
  officialUrlGuess: string | null;
}

export interface CandidateHintItem {
  title: string;
  url: string;
  source: string;
  score?: number;
  /** 特定の名前を持つ商業的なAI製品・ツール・サービスが主題と判定された場合のみ付加される */
  productCandidate?: ProductCandidate | null;
}

export interface CandidateHintsFile {
  generatedAt: string;
  items: CandidateHintItem[];
}

/** Claudeへ渡す分類対象の最小情報(title/url/source) */
interface ClassificationInputItem {
  title: string;
  url: string;
  source: string;
}

export interface ProductCandidatePrompt {
  system: string;
  user: string;
}

/**
 * 商品候補の分類・抽出用のsystem/userプロンプトを組み立てる純粋関数(テスト容易性のため分離)。
 * モデルには分類・名称抽出・URL推測のみを指示し、事実情報(特長・スペック・効果)は書かせない。
 */
export function buildProductCandidatePrompt(items: ClassificationInputItem[]): ProductCandidatePrompt {
  const system = [
    "あなたはニュースタイトルの一覧から、特定の名前を持つ商業的なAI関連の製品・ツール・サービスを",
    "主題にしている記事を判定するアシスタントです。各ニュースについて、次の作業のみを行ってください。",
    "1. そのニュースが特定の名前を持つ商業的なAI製品・ツール・サービス(例: 固有名詞を持つ商用の",
    "   AIプロダクト)を主題にしているかを判定する。単なる技術トレンド・企業動向・研究論文の",
    "   ニュースで、特定の製品名が主題でないものは該当しないと判定する。",
    "2. 該当する場合のみ、その製品名(productName)を抽出する。",
    "3. 記事タイトル・URLから、その製品の公式サイトのURLが明確に読み取れる場合のみ",
    "   officialUrlGuessとして推測する。少しでも不確かな場合はnullにする。",
    "【最重要・厳守】商品の特長・スペック・効果・評判等の「事実」情報は一切生成しないでください。",
    "分類・名称抽出・URL推測のみを行い、それ以外の情報(説明文・紹介文等)は出力しないでください。",
    "該当する項目のみを、以下のJSON配列形式で出力してください。該当しない項目は配列に含めないでください。",
    '出力形式: [{"index": 0, "productName": "...", "officialUrlGuess": "https://..." または null}, ...]',
    "JSON配列以外の文字(説明・前置き・コードブロックの```等)は一切出力しないでください。",
  ].join("\n");

  const user = items
    .map((item, index) => `${index}. タイトル: ${item.title} / URL: ${item.url} / 情報源: ${item.source}`)
    .join("\n");

  return { system, user };
}

/**
 * Claudeのレスポンス文字列を、index -> ProductCandidate のMapへパースする。
 * JSON形式でない・配列でない・要素の型が不正等、パースに失敗した場合は例外を投げず、
 * 判明した範囲(または空)のMapを返す(安全側に倒して既存の動作にフォールバックするため)。
 */
export function parseProductCandidateResponse(raw: string, itemCount: number): Map<number, ProductCandidate> {
  const result = new Map<number, ProductCandidate>();

  // モデルがコードブロック(```json ... ```)で囲んで返すことがあるため、先頭/末尾の
  // フェンスを取り除いてからパースする(cleanGeneratedTextと同種の安全網)。
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    log.warn("failed to parse product candidate classification response as JSON; skipping product candidate detection", {
      message: err instanceof Error ? err.message : String(err),
    });
    return result;
  }

  if (!Array.isArray(parsed)) {
    log.warn("product candidate classification response was not a JSON array; skipping product candidate detection");
    return result;
  }

  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as Record<string, unknown>;

    const index = record.index;
    if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= itemCount) {
      continue; // 不正・範囲外な要素はスキップ(安全側に倒す。全体を失敗にはしない)
    }

    const productName = record.productName;
    if (typeof productName !== "string" || productName.trim().length === 0) {
      continue;
    }

    const rawUrlGuess = record.officialUrlGuess;
    const officialUrlGuess = typeof rawUrlGuess === "string" && isHttpUrl(rawUrlGuess) ? rawUrlGuess : null;

    result.set(index, { name: productName.trim(), officialUrlGuess });
  }

  return result;
}

/**
 * 収集したニュース項目一覧から、商品候補(productCandidate)をindexごとに検出する。
 * ANTHROPIC_API_KEY未設定・API呼び出し失敗・レスポンスのパース失敗、いずれの場合も
 * 例外を投げず空のMapを返す(呼び出し側は拡張情報なしで既存の動作にフォールバックする)。
 */
export async function detectProductCandidates(
  items: ClassificationInputItem[],
  client?: AnthropicMessageClient | null,
  account: AccountProfile = getAccountProfile()
): Promise<Map<number, ProductCandidate>> {
  if (items.length === 0) return new Map();

  const resolvedClient = client === undefined ? createAnthropicClient(account) : client;
  if (!resolvedClient) {
    const envVarName = resolveCredentialEnvVarName("ANTHROPIC_API_KEY", account);
    log.info(`${envVarName} が未設定のため商品候補の自動検出をスキップします(タイトル一覧のみを書き出します)`);
    return new Map();
  }

  const prompt = buildProductCandidatePrompt(items);

  let message: Anthropic.Message;
  try {
    message = await resolvedClient.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: MAX_CLASSIFICATION_OUTPUT_TOKENS,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    });
  } catch (err) {
    log.warn("failed to call Anthropic API for product candidate classification; continuing without product candidates", {
      message: err instanceof Error ? err.message : String(err),
    });
    return new Map();
  }

  const rawText = extractTextFromResponse(message);
  return parseProductCandidateResponse(rawText, items.length);
}

/**
 * 収集・スコアリング済みのニュース候補から、参考情報として書き出すヒント一覧を組み立てる。
 * `collectFn`はテスト用の差し替えポイント(既定は本物の`collectAndScoreNews`)。
 * `client`はテスト用の差し替えポイント(既定はundefinedで、ANTHROPIC_API_KEY環境変数から自動構築する。
 * 既存呼び出し元(.github/workflows/update-candidate-hints.yml)には影響しない後方互換な追加引数)。
 */
export async function generateCandidateHints(
  outFile: string = DEFAULT_CANDIDATE_HINTS_FILE,
  collectFn: () => Promise<{ scored: NewsCandidate[] }> = collectAndScoreNews,
  client?: AnthropicMessageClient | null
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

  const candidateMap = await detectProductCandidates(
    items.map(({ title, url, source }) => ({ title, url, source })),
    client
  );
  for (const [index, productCandidate] of candidateMap) {
    items[index].productCandidate = productCandidate;
  }

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
