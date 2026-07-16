/**
 * F4: 文字数上限を超える本文をスレッド(複数ツイート)に自動分割する。
 * F5: 分割後のスレッド末尾に、元記事URLを含むリンクツイートを付与する。
 *
 * 分割方針(意味のまとまりを保つため、粗い区切りから順に試す):
 *   1. 文単位(句点「。」「!」「?」「\n」)
 *   2. (1文がそれでも長すぎる場合)読点「、」「,」単位
 *   3. (それでも長すぎる場合)空白単位(英単語の区切り)
 *   4. (区切りが一切無い場合の最終手段)文字単位のハード分割
 * のいずれかで、各断片を上限内のツイートに詰め込む(greedy packing)。
 */
import { calculateTweetLength, TWEET_CHAR_LIMIT } from "./tweetLength.js";

/** 1スレッドに含める本文ツイートの上限本数(リンクツイートを除く)。極端に長い入力でも無限に増やさないための歯止め */
export const MAX_BODY_TWEETS = 6;

/** 本文が上限本数を超えて丸められた際に末尾へ付与する省略記号 */
const ELLIPSIS = "…";

/** 順序表記の書式。本文が複数ツイートに分かれる場合のみ各ツイートに付与する(例: "\n(1/3)") */
function numberingSuffix(index: number, total: number): string {
  return `\n(${index}/${total})`;
}

/**
 * 順序表記のために予約しておく最大の重み。
 * MAX_BODY_TWEETSが単一桁の間は "(N/M)" のNとMは常に単一桁なので、
 * 実際の合計本数によらず一定の重みになる(=分割時に一貫した上限を使える)。
 */
function suffixReserveWeight(maxBodyTweets: number): number {
  return calculateTweetLength(numberingSuffix(maxBodyTweets, maxBodyTweets));
}

/** 文単位に分割する(句点等の直後で区切り、区切り文字自体は残す) */
function splitIntoSentenceUnits(text: string): string[] {
  return text
    .split(/(?<=[。!?！？\n])/)
    .map((s) => s)
    .filter((s) => s.length > 0);
}

/** 読点単位に分割する */
function splitIntoClauseUnits(text: string): string[] {
  return text
    .split(/(?<=[、,])/)
    .map((s) => s)
    .filter((s) => s.length > 0);
}

/** 空白単位に分割する(英語混じりの文などのフォールバック) */
function splitIntoWordUnits(text: string): string[] {
  return text
    .split(/(?<=\s)/)
    .map((s) => s)
    .filter((s) => s.length > 0);
}

/** 区切り文字が一切無い場合の最終手段: サロゲートペアを壊さずコードポイント単位で上限まで詰める */
function hardSplitByCodePoint(text: string, limit: number): string[] {
  const chars = Array.from(text);
  const result: string[] = [];
  let current = "";
  let currentWeight = 0;
  for (const ch of chars) {
    const w = calculateTweetLength(ch);
    if (current.length > 0 && currentWeight + w > limit) {
      result.push(current);
      current = "";
      currentWeight = 0;
    }
    current += ch;
    currentWeight += w;
  }
  if (current.length > 0) {
    result.push(current);
  }
  return result.length > 0 ? result : [text];
}

/**
 * 1つの断片(unit)が上限を超えている場合に、意味のまとまりをできるだけ保ちながら
 * より細かい単位へ再帰的に分割する。分割できない場合のみ文字単位のハード分割に落ちる。
 */
function splitUnitToFit(unit: string, limit: number): string[] {
  if (calculateTweetLength(unit) <= limit) {
    return [unit];
  }
  const clauses = splitIntoClauseUnits(unit);
  if (clauses.length > 1) {
    return clauses.flatMap((c) => splitUnitToFit(c, limit));
  }
  const words = splitIntoWordUnits(unit);
  if (words.length > 1) {
    return words.flatMap((w) => splitUnitToFit(w, limit));
  }
  return hardSplitByCodePoint(unit, limit);
}

/** 断片群を、上限を超えない範囲でできるだけ多く詰め込みながら連結し、ツイート単位の配列にする(greedy packing) */
function packUnits(units: string[], limit: number): string[] {
  const atomicUnits = units.flatMap((u) => splitUnitToFit(u, limit));
  const chunks: string[] = [];
  let current = "";
  let currentWeight = 0;
  for (const u of atomicUnits) {
    const w = calculateTweetLength(u);
    if (current.length > 0 && currentWeight + w > limit) {
      chunks.push(current);
      current = "";
      currentWeight = 0;
    }
    current += u;
    currentWeight += w;
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

export interface ThreadTweet {
  /** スレッド全体(本文+リンク)における1始まりの投稿順序 */
  index: number;
  /** ツイート本文(順序表記等を含む、実際に投稿される文字列) */
  text: string;
  /** Xの文字数計算方式での重み(必ずTWEET_CHAR_LIMIT以下になる) */
  charLength: number;
  /** "body": 生成された記事紹介文の一部 / "link": 元記事リンク */
  kind: "body" | "link";
}

/**
 * 本文テキストを、上限本数(maxBodyTweets)以内のツイート文字列配列に分割する。
 * - 単一ツイートに収まる場合は順序表記を付けず、そのまま1件で返す。
 * - 複数ツイートに分かれる場合、各ツイートに "(N/M)" の順序表記を付けたうえで上限内に収める。
 * - 分割しても上限本数に収まらないほど長い場合は、末尾のツイートを省略記号で切り詰めて本数を打ち切る。
 */
export function splitIntoBodyTweets(text: string, maxBodyTweets: number = MAX_BODY_TWEETS): string[] {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return [];
  }
  if (calculateTweetLength(trimmed) <= TWEET_CHAR_LIMIT) {
    return [trimmed];
  }

  const reserve = suffixReserveWeight(maxBodyTweets);
  const limit = TWEET_CHAR_LIMIT - reserve;
  const sentences = splitIntoSentenceUnits(trimmed);
  let chunks = packUnits(sentences, limit).map((c) => c.trim());

  if (chunks.length > maxBodyTweets) {
    const kept = chunks.slice(0, maxBodyTweets - 1);
    const restText = chunks.slice(maxBodyTweets - 1).join("").trim();
    const ellipsisWeight = calculateTweetLength(ELLIPSIS);
    const truncatedParts = hardSplitByCodePoint(restText, Math.max(limit - ellipsisWeight, 0));
    const truncated = `${truncatedParts[0] ?? ""}${ELLIPSIS}`;
    kept.push(truncated);
    chunks = kept;
  }

  return chunks.map((c, i) => `${c}${numberingSuffix(i + 1, chunks.length)}`);
}

/** F5: 元記事URLを含むリンクツイートの本文を組み立てる */
export function buildLinkTweetText(url: string): string {
  return `元記事: ${url}`;
}

export interface ComposeThreadOptions {
  maxBodyTweets?: number;
}

/**
 * 生成済み本文と元記事URLから、投稿予定のツイート配列(本文N件+リンク1件)を組み立てる。
 * 本文側はURLを含まないため文字数計算に影響せず、リンクはスレッド末尾の別ツイートとして続く。
 */
export function composeThread(
  bodyText: string,
  url: string,
  options: ComposeThreadOptions = {}
): ThreadTweet[] {
  const bodyTexts = splitIntoBodyTweets(bodyText, options.maxBodyTweets ?? MAX_BODY_TWEETS);
  const tweets: ThreadTweet[] = bodyTexts.map((text, i) => ({
    index: i + 1,
    text,
    charLength: calculateTweetLength(text),
    kind: "body",
  }));

  const linkText = buildLinkTweetText(url);
  tweets.push({
    index: tweets.length + 1,
    text: linkText,
    charLength: calculateTweetLength(linkText),
    kind: "link",
  });

  return tweets;
}
