#!/usr/bin/env node
/**
 * F3: 選定記事(NewsCandidate)から、Claude(Anthropic API)を用いて日本語の投稿本文を生成する。
 *
 * プロンプト構築(buildGenerationPrompt)・レスポンス整形(extractTextFromResponse/cleanGeneratedText)・
 * 検証(validateGeneratedText)をAPI呼び出し本体から分離し、実APIを呼ばずにモックでユニットテストできる形にしている。
 *
 * ANTHROPIC_API_KEY が未設定の場合は生成を行わず、安全にエラーとして扱う(壊れた/空の投稿をしない)。
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { log } from "./logger.js";
import { extractKeywords, jaccardSimilarity } from "./scoring.js";
import type { NewsCandidate } from "./types.js";

/**
 * 生成のトーン/言語設定。
 * Sprint 8(F12: 設定管理)で外部設定ファイル化される前提の暫定デフォルト値。
 * このスプリントでは「毎回同じ値を使うことで結果のブレを抑える」ことが目的のため、
 * 定数として1箇所にまとめている。
 */
export const GENERATION_STYLE = {
  language: "ja",
  tone: "AIニュースを紹介するXアカウントとして中立的・正確で、煽りすぎない自然なトーン。",
} as const;

/** 使用するClaudeモデル。環境変数で上書き可能(モデルIDの陳腐化・利用者の選好に対応するため) */
export const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-3-5-haiku-20241022";

/** 生成に使う最大出力トークン数(短い投稿文面のため小さめに設定) */
export const MAX_OUTPUT_TOKENS = 400;

/** タイトルと生成文の類似度がこれ以上だと「タイトルの丸写し」とみなし失敗扱いにする */
export const TITLE_COPY_SIMILARITY_THRESHOLD = 0.8;

/** 生成文の最大文字数目安。F4(文字数厳守・分割)より前の安全弁で、極端に長い/壊れた出力を弾く */
export const MAX_GENERATED_LENGTH = 600;

export interface GenerationPrompt {
  system: string;
  user: string;
}

/** 選定記事から、Claudeへ渡すsystem/userプロンプトを組み立てる純粋関数(テスト容易性のため分離) */
export function buildGenerationPrompt(candidate: NewsCandidate): GenerationPrompt {
  const system = [
    "あなたはAIニュースを紹介するXアカウントの編集者です。",
    "以下の制約を厳守して投稿文面を作成してください。",
    `- 出力は${GENERATION_STYLE.language === "ja" ? "日本語" : GENERATION_STYLE.language}のみ。`,
    `- トーン: ${GENERATION_STYLE.tone}`,
    "- 記事タイトルをそのまま書き写さず、要点(何が・どう新しいか)を要約・言い換えて伝える。",
    "- 与えられた記事情報(タイトル・概要)に書かれていない事実を付け加えたり、断定的な誇張・憶測をしない。",
    "- 前置きや挨拶、説明文、引用符での囲みは書かず、投稿本文のみを出力する。ハッシュタグの羅列も付けない。",
  ].join("\n");

  const user = [
    "以下のAIニュース記事について、投稿文面を1つ作成してください。",
    "",
    `タイトル: ${candidate.title}`,
    candidate.summary ? `概要: ${candidate.summary}` : undefined,
    `情報源: ${candidate.source}`,
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");

  return { system, user };
}

/** Anthropicのレスポンス(content配列)からテキスト部分だけを連結して取り出す */
export function extractTextFromResponse(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

/** モデルが引用符・かぎ括弧で囲って返すことがあるため、先頭/末尾の囲み記号を取り除く */
export function cleanGeneratedText(raw: string): string {
  return raw
    .trim()
    .replace(/^["「『]+/, "")
    .replace(/["」』]+$/, "")
    .trim();
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * 生成文面の安全弁チェック。
 * - 空文字列や異常に長い出力を弾く。
 * - タイトルとのキーワード類似度が高すぎる(=丸写しに近い)場合を弾く。
 */
export function validateGeneratedText(text: string, candidate: NewsCandidate): ValidationResult {
  if (!text || text.length === 0) {
    return { valid: false, reason: "生成結果が空文字列でした" };
  }
  if (text.length > MAX_GENERATED_LENGTH) {
    return {
      valid: false,
      reason: `生成結果が長すぎます(${text.length}文字 > 上限${MAX_GENERATED_LENGTH}文字)`,
    };
  }
  const similarity = jaccardSimilarity(extractKeywords(text), extractKeywords(candidate.title));
  if (similarity >= TITLE_COPY_SIMILARITY_THRESHOLD) {
    return {
      valid: false,
      reason: `生成結果がタイトルの丸写しに近すぎます(キーワード類似度${similarity.toFixed(2)} >= ${TITLE_COPY_SIMILARITY_THRESHOLD})`,
    };
  }
  return { valid: true };
}

/**
 * generatePostText()が依存するAnthropicクライアントの最小インターフェース。
 * テストではこの形を満たすモックオブジェクトを注入する(実SDK/実APIを呼ばない)。
 */
export interface AnthropicMessageClient {
  messages: {
    create: (params: {
      model: string;
      max_tokens: number;
      system: string;
      messages: Anthropic.MessageParam[];
    }) => Promise<Anthropic.Message>;
  };
}

/** 環境変数ANTHROPIC_API_KEYからクライアントを構築する。未設定ならnullを返す(呼び出し側でエラー扱い) */
export function createAnthropicClient(): AnthropicMessageClient | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new Anthropic({ apiKey });
}

export type PostGenerationResult =
  | { success: true; text: string; candidate: NewsCandidate }
  | { success: false; error: string; candidate: NewsCandidate };

/**
 * 選定記事から投稿本文を生成する。
 * APIキー未設定・API呼び出し失敗・生成結果が検証を通らない場合は、いずれもsuccess:falseで返す
 * (例外は投げない。呼び出し側がこの結果を見て「投稿せず安全に終了する」判断をするため)。
 */
export async function generatePostText(
  candidate: NewsCandidate,
  client: AnthropicMessageClient | null = createAnthropicClient()
): Promise<PostGenerationResult> {
  if (!client) {
    const error = "ANTHROPIC_API_KEY が未設定のため投稿文面を生成できません";
    log.error(error, { url: candidate.url });
    return { success: false, error, candidate };
  }

  const prompt = buildGenerationPrompt(candidate);

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error("failed to call Anthropic API for post generation", { message, url: candidate.url });
    return { success: false, error: `Anthropic API呼び出しに失敗しました: ${message}`, candidate };
  }

  const text = cleanGeneratedText(extractTextFromResponse(message));
  const validation = validateGeneratedText(text, candidate);
  if (!validation.valid) {
    log.error("generated post text failed validation, aborting without posting", {
      reason: validation.reason,
      url: candidate.url,
    });
    return { success: false, error: validation.reason ?? "生成結果の検証に失敗しました", candidate };
  }

  log.info("generated post text", { url: candidate.url, length: text.length });
  return { success: true, text, candidate };
}

async function loadSelectedCandidateFromCache(): Promise<NewsCandidate | null> {
  const file = path.join(process.cwd(), "data", "output", "latest-selection.json");
  const raw = await readFile(file, "utf-8");
  const parsed = JSON.parse(raw) as { selected: NewsCandidate | null };
  return parsed.selected;
}

/** CLIから直接実行された場合のみ、リポジトリ直下の.env(存在すれば)をprocess.envへ読み込む */
function loadDotEnvIfPresent(): void {
  const envFile = path.join(process.cwd(), ".env");
  if (existsSync(envFile)) {
    process.loadEnvFile(envFile);
  }
}

async function main() {
  loadDotEnvIfPresent();
  const candidate = await loadSelectedCandidateFromCache();

  if (!candidate) {
    log.warn("no selected candidate found (run `npm run select` first), nothing to generate");
    return;
  }

  log.info("generating post text for selected candidate", { title: candidate.title, url: candidate.url });
  const result = await generatePostText(candidate);

  const outDir = path.join(process.cwd(), "data", "output");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "latest-post.json");

  if (!result.success) {
    log.error("post text generation failed; not proceeding to post", { error: result.error });
    await writeFile(
      outFile,
      JSON.stringify(
        { generatedAt: new Date().toISOString(), success: false, error: result.error, candidate },
        null,
        2
      ),
      "utf-8"
    );
    process.exitCode = 1;
    return;
  }

  console.log("---- 生成された投稿文面 ----");
  console.log(result.text);
  console.log("----------------------------");

  await writeFile(
    outFile,
    JSON.stringify(
      { generatedAt: new Date().toISOString(), success: true, text: result.text, candidate },
      null,
      2
    ),
    "utf-8"
  );
  log.info(`wrote generated post text to ${outFile}`);
}

const isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    log.error("fatal error during post text generation", {
      message: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = 1;
  });
}
