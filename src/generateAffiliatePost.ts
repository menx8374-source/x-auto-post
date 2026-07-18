/**
 * アフィリエイト商品の紹介文生成。
 *
 * AIニュースの生成ロジック(src/generatePost.ts)からレスポンス整形(extractTextFromResponse/
 * cleanGeneratedText)・クライアント構築(createAnthropicClient)を再利用しつつ、プロンプト構築・
 * 検証(ensurePrLabel/validateAffiliateGeneratedText)はアフィリエイト固有のものとして実装する。
 *
 * 生成方針(景品表示法のステルスマーケティング規制対応、実体験捏造の防止):
 * - 「【PR】」を本文の先頭に必ず含める(最重要・省略不可)。プロンプトで指示するだけでなく、
 *   モデルが指示に従わなかった場合の安全網として ensurePrLabel() でコード側からも強制する
 *   (src/logger.tsの認証情報マスキングと同じ「多層防御」の考え方)。
 * - `facts`(ユーザーが公式情報から手動記入した事実)に無い特長・効果を創作しない。
 * - 「私は使ってみて〜」のような一人称の体験談は書かない(実体験の捏造禁止)。
 * - 誇大な効果効能・断定的な優良性の主張を避ける。
 *
 * ANTHROPIC_API_KEY が未設定の場合は生成を行わず、安全にエラーとして扱う(壊れた/空の投稿をしない)。
 */
import type Anthropic from "@anthropic-ai/sdk";
import { log } from "./logger.js";
import {
  extractTextFromResponse,
  cleanGeneratedText,
  createAnthropicClient,
  DEFAULT_MODEL,
  type AnthropicMessageClient,
} from "./generatePost.js";
import { getAccountProfile, resolveCredentialEnvVarName, type AccountProfile } from "./accounts.js";
import type { AffiliateProduct } from "./affiliateProducts.js";

/** 景品表示法のステルスマーケティング規制対応: 広告であることを示す必須表記 */
export const PR_LABEL = "【PR】";

/** 生成に使う最大出力トークン数(短い投稿文面のため小さめに設定) */
export const MAX_OUTPUT_TOKENS = 400;

/** 生成文の最大文字数目安(極端に長い/壊れた出力を弾く安全弁) */
export const MAX_GENERATED_LENGTH = 600;

export interface AffiliateGenerationPrompt {
  system: string;
  user: string;
}

/** 選定商品から、Claudeへ渡すsystem/userプロンプトを組み立てる純粋関数(テスト容易性のため分離) */
export function buildAffiliateGenerationPrompt(product: AffiliateProduct): AffiliateGenerationPrompt {
  const system = [
    "あなたはアフィリエイト商品・サービスを紹介するXアカウントの編集者です。",
    "以下の制約を厳守して投稿文面を作成してください。いずれも例外なく守るべき制約です。",
    `- 【最重要・省略不可】投稿本文の先頭に必ず「${PR_LABEL}」という表記を含めてください。これは広告であることを示す、景品表示法上必須の表記です。`,
    "- これから提示する「事実」のリストに書かれている範囲でのみ紹介してください。事実に書かれていない特長・効果・スペック・数値を創作したり誇張したりしないでください。",
    "- 「私は使ってみて」「実際に使用してみたところ」「愛用しています」のような一人称の利用体験・感想は、実際には体験していないため絶対に書かないでください(体験談の捏造は禁止です)。",
    "- 「絶対に痩せる」「必ず効果がある」のような誇大な効果効能や、断定的な優良性の主張は避け、提示された事実の範囲で客観的に紹介してください。個別の投資助言(売買を推奨する等)、健康/美容/医療の断定的な効果効能は書かないでください。",
    "- 前置きや挨拶、説明文、引用符での囲みは書かず、投稿本文のみを出力してください。ハッシュタグの羅列も付けないでください。",
    "- リンクURLは本文に含めないでください(別のツイートとして後から付与されます)。",
  ].join("\n");

  const user = [
    "以下の商品/サービスについて、事実ベースの紹介文を1つ作成してください。",
    "",
    `商品名: ${product.name}`,
    `公式サイト: ${product.officialUrl}`,
    "事実(この範囲でのみ紹介してください。ここに書かれていない情報は書かないでください):",
    ...(product.facts.length > 0 ? product.facts.map((f) => `- ${f}`) : ["(事実情報が登録されていません)"]),
  ].join("\n");

  return { system, user };
}

/**
 * 生成結果に必ず【PR】表記を先頭に含める安全網(多層防御)。
 * モデルが指示に従わずPR_LABELを省略・本文途中に置いた場合でも、本文中の既存のPR_LABEL出現を
 * 取り除いた上で先頭に付け直すことで、常に「先頭に1つだけ」存在する状態を保証する。
 */
export function ensurePrLabel(text: string): string {
  const withoutLabel = text.split(PR_LABEL).join("").trim();
  return `${PR_LABEL} ${withoutLabel}`.trim();
}

export interface AffiliateValidationResult {
  valid: boolean;
  reason?: string;
}

/** 生成文面の安全弁チェック(空/長すぎ/PR表記の欠落を検知する) */
export function validateAffiliateGeneratedText(text: string): AffiliateValidationResult {
  if (!text || text.length === 0) {
    return { valid: false, reason: "生成結果が空文字列でした" };
  }
  if (text.length > MAX_GENERATED_LENGTH) {
    return {
      valid: false,
      reason: `生成結果が長すぎます(${text.length}文字 > 上限${MAX_GENERATED_LENGTH}文字)`,
    };
  }
  if (!text.startsWith(PR_LABEL)) {
    return {
      valid: false,
      reason: `生成結果の先頭に「${PR_LABEL}」が含まれていません(景品表示法対応のため必須)`,
    };
  }
  return { valid: true };
}

export type AffiliatePostGenerationResult =
  | { success: true; text: string; product: AffiliateProduct }
  | { success: false; error: string; product: AffiliateProduct };

/**
 * 選定商品から投稿本文を生成する。
 * APIキー未設定・API呼び出し失敗・生成結果が検証を通らない場合は、いずれもsuccess:falseで返す
 * (例外は投げない。呼び出し側がこの結果を見て「投稿せず安全に終了する」判断をするため)。
 */
export async function generateAffiliatePostText(
  product: AffiliateProduct,
  client?: AnthropicMessageClient | null,
  account: AccountProfile = getAccountProfile()
): Promise<AffiliatePostGenerationResult> {
  const resolvedClient = client === undefined ? createAnthropicClient(account) : client;
  if (!resolvedClient) {
    const envVarName = resolveCredentialEnvVarName("ANTHROPIC_API_KEY", account);
    const error = `${envVarName} が未設定のためアフィリエイト投稿文面を生成できません`;
    log.error(error, { productId: product.id, accountId: account.id });
    return { success: false, error, product };
  }

  const prompt = buildAffiliateGenerationPrompt(product);

  let message: Anthropic.Message;
  try {
    message = await resolvedClient.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: prompt.system,
      messages: [{ role: "user", content: prompt.user }],
    });
  } catch (err) {
    const errMessage = err instanceof Error ? err.message : String(err);
    log.error("failed to call Anthropic API for affiliate post generation", {
      message: errMessage,
      productId: product.id,
    });
    return { success: false, error: `Anthropic API呼び出しに失敗しました: ${errMessage}`, product };
  }

  const rawText = cleanGeneratedText(extractTextFromResponse(message));
  const text = ensurePrLabel(rawText);
  const validation = validateAffiliateGeneratedText(text);
  if (!validation.valid) {
    log.error("generated affiliate post text failed validation, aborting without posting", {
      reason: validation.reason,
      productId: product.id,
    });
    return { success: false, error: validation.reason ?? "生成結果の検証に失敗しました", product };
  }

  // 実行ログに生成本文そのものを残す(監査・障害調査用)。認証情報ではないためマスク対象外。
  log.info("generated affiliate post text", { productId: product.id, length: text.length, text });
  return { success: true, text, product };
}
