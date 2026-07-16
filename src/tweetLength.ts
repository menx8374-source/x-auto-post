/**
 * F4: Xの文字数計算方式(半角1・全角2換算)での文字数算出。
 *
 * Xは実際には twitter-text ライブラリのUnicode範囲表に基づいて文字の重みを決めているが、
 * このプロジェクトでは仕様書の「半角1・全角2換算(280相当)」という簡略化された定義に従い、
 * 東アジアの全角文字(ひらがな・カタカナ・漢字・全角記号等)を重み2、それ以外を重み1として計算する。
 * URLはXが自動的にt.co形式へ短縮するため、実際の文字数に関わらず固定重み(23)として扱う。
 */

/** Xの非Premiumアカウントにおける1ツイートの文字数上限(重み換算後) */
export const TWEET_CHAR_LIMIT = 280;

/** X(t.co)がURLを短縮した際の固定重み。http/https問わず23として扱う(実際のXの仕様に準拠) */
export const URL_WEIGHT = 23;

/** 本文中のURLを検出する正規表現(空白文字より前までをURLとみなす) */
const URL_REGEX = /https?:\/\/\S+/g;

/**
 * コードポイント単位で「全角(重み2)」かどうかを判定する。
 * ひらがな・カタカナ・CJK統合漢字・全角記号・ハングル・および基本多言語面外(絵文字等)を全角扱いとする。
 */
function isWideCodePoint(codePoint: number): boolean {
  if (codePoint > 0xffff) {
    // 基本多言語面外(絵文字等のサロゲートペア文字)は全角相当として扱う
    return true;
  }
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) || // ハングル字母
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) || // CJK部首・ひらがな・カタカナ・CJK統合漢字等
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) || // ハングル音節
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK互換漢字
    (codePoint >= 0xff00 && codePoint <= 0xff60) || // 全角形
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) // 全角記号
  );
}

/** 1文字(サロゲートペア考慮済みの1コードポイント文字列)の重みを返す */
export function charWeight(char: string): number {
  const codePoint = char.codePointAt(0);
  if (codePoint === undefined) {
    return 0;
  }
  return isWideCodePoint(codePoint) ? 2 : 1;
}

/**
 * テキスト全体の重み(Xの文字数計算方式での文字数)を算出する。
 * URLはt.co短縮後の固定重み(URL_WEIGHT)として計算し、実際のURL長は無視する。
 */
export function calculateTweetLength(text: string): number {
  let weight = 0;
  let lastIndex = 0;
  URL_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = URL_REGEX.exec(text)) !== null) {
    if (match.index > lastIndex) {
      weight += weighNonUrlText(text.slice(lastIndex, match.index));
    }
    weight += URL_WEIGHT;
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    weight += weighNonUrlText(text.slice(lastIndex));
  }
  return weight;
}

function weighNonUrlText(text: string): number {
  let weight = 0;
  for (const char of text) {
    weight += charWeight(char);
  }
  return weight;
}

/** テキストが単一ツイートの文字数上限内に収まるかどうか */
export function fitsInSingleTweet(text: string): boolean {
  return calculateTweetLength(text) <= TWEET_CHAR_LIMIT;
}
