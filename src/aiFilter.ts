/**
 * F1: 収集対象をAI関連(生成AI・LLM・機械学習・AI製品/企業/研究等)に限定するフィルタ。
 */

// 単語境界つきで判定するキーワード(大文字小文字を区別しない)。
// "AI" のような短い略語は誤マッチ(chair, said 等)を避けるため \b で挟む。
const AI_KEYWORD_PATTERNS: RegExp[] = [
  /\bAI\b/i,
  // "A.I." のようなピリオド付き表記。末尾のピリオドの直後は非単語文字同士の遷移になり
  // \b が成立しないため、代わりに直後が単語文字ではないこと(スペース・句読点・行末等)を
  // 否定先読みで確認する。
  /\bA\.I\.(?!\w)/i,
  /artificial intelligence/i,
  /machine learning/i,
  /\bML\b/i,
  /deep learning/i,
  /neural network/i,
  /\bLLMs?\b/i,
  /large language model/i,
  /generative AI/i,
  /\bGPT-?\d*\b/i,
  /ChatGPT/i,
  /\bOpenAI\b/i,
  /\bAnthropic\b/i,
  /\bClaude\b/i,
  /\bGemini\b/i,
  /\bDeepMind\b/i,
  /\bCopilot\b/i,
  /\bchatbot\b/i,
  /\bLLaMA\b/i,
  /\bMidjourney\b/i,
  /\bStable Diffusion\b/i,
  /\bhugging ?face\b/i,
  /\bAGI\b/i,
  /\bxAI\b/i,
  /\bGrok\b/i,
  /\bMistral\b/i,
  /\bPerplexity\b/i,
  /\bNVIDIA\b.*\b(AI|chip|GPU)\b/i,
  // 日本語ソース向けキーワード。"AI"のようなASCII表記は日本語文中でも\bが単語境界として
  // 機能する(前後の日本語文字は\wに含まれないため)ため上記の英語パターンで既にマッチするが、
  // 念のため日本語特有の表記を明示的に追加する。日本語は分かち書きされないため単語境界(\b)は
  // 使わず、単純な部分一致で判定する。
  /人工知能/,
  /生成AI/i,
  /機械学習/,
  /深層学習/,
  /ディープラーニング/,
  /大規模言語モデル/,
  /チャットボット/,
  /自律型AI/i,
];

/** タイトル(と任意で概要)がAI関連かどうかを判定する */
export function isAiRelated(title: string, summary?: string): boolean {
  const text = `${title} ${summary ?? ""}`;
  return AI_KEYWORD_PATTERNS.some((pattern) => pattern.test(text));
}

/** 候補リストをAI関連のみにフィルタする */
export function filterAiRelated<T extends { title: string; summary?: string }>(
  items: T[]
): T[] {
  return items.filter((item) => isAiRelated(item.title, item.summary));
}
