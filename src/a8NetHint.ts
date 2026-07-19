/**
 * A8.net存在ヒント(ヒューリスティック、断定ではない)。
 *
 * 【重要な設計制約(ユーザーと合意済み)】A8.netへの自動ログイン・自動検索・自動提携申請・
 * スクレイピングは一切行わない。ここで判定するのはあくまで以下2種類の「ヒント」のみ:
 *   (a) A8.net公式の公開ページ(ログイン不要)に実際に掲載されている主要ブランド広告主の
 *       一覧との名前一致(`matchKnownAdvertiser`)。
 *   (b) 商品の公式サイト自体(A8.net自体ではなく商品側のページ)に、A8.netドメインへの
 *       リンク(提携申請ページ・広告主募集ページ等)が掲載されているかのスキャン
 *       (`scanHtmlForA8NetLinks`)。
 * いずれも「A8.netに実在する可能性が高い」ことを示唆するヒントに過ぎず、「存在しない」
 * ことの証明にはならない(一致しない場合は"unknown"=不明であり、"存在しない"ではない)。
 * 提携申請が実際に受理されたかどうかはユーザー本人がA8.netにログインしないと分からないため、
 * この判定には一切含まない(admin側で手動管理する)。
 */

/** A8.net広告主(ブランド)情報 */
export interface KnownA8Advertiser {
  /** ブランド名(表記ゆれの吸収は`matchKnownAdvertiser`側の正規化で行う) */
  name: string;
  /** A8.net広告主ID(参考情報。リンク遷移には使わずA8.net内検索のキーワードのみ使う) */
  a8AdvertiserId: string;
}

/**
 * A8.net公式の公開ページ(https://support.a8.net/as/HintOfProgram/selection.php、ログイン不要)に
 * 実際に掲載されている主要ブランド広告主の一覧(ハードコードされた静的配列)。
 *
 * 【拡張方法】このページに新たに掲載されているブランドを見つけた場合、name(表示名)と
 * a8AdvertiserId(同ページのHTMLソースから確認できる広告主ID)の組を1件追記するだけでよい。
 * 件数を無理に増やす必要はない(過剰な推測ブランド名を作らないこと。実在確認済みのものだけを追加する)。
 */
export const KNOWN_A8_ADVERTISERS: KnownA8Advertiser[] = [
  { name: "楽天市場", a8AdvertiserId: "s00000011623" },
  { name: "Amazon", a8AdvertiserId: "s00000009884" },
  { name: "アイリスプラザ", a8AdvertiserId: "s00000001618" },
  { name: "Qoo10", a8AdvertiserId: "s00000022156" },
  { name: "ダイレクトテレショップ", a8AdvertiserId: "s00000013791" },
];

/** 大小文字・全角半角の表記ゆれを吸収するための正規化 */
function normalizeForMatch(text: string): string {
  return text.normalize("NFKC").toLowerCase().trim();
}

/**
 * 商品名を`KNOWN_A8_ADVERTISERS`と大小文字・全角半角を問わない部分一致で照合する純粋関数。
 * 一致するブランドが見つかった場合のみそのエントリを返す。見つからない場合は`null`
 * (「A8.netに存在しない」ことの判定ではなく、単に既知の主要ブランド一覧には無かったというだけ)。
 */
export function matchKnownAdvertiser(productName: string): KnownA8Advertiser | null {
  if (typeof productName !== "string" || productName.trim().length === 0) return null;
  const normalizedProduct = normalizeForMatch(productName);
  if (normalizedProduct.length === 0) return null;

  for (const advertiser of KNOWN_A8_ADVERTISERS) {
    const normalizedAdvertiser = normalizeForMatch(advertiser.name);
    if (normalizedAdvertiser.length > 0 && normalizedProduct.includes(normalizedAdvertiser)) {
      return advertiser;
    }
  }
  return null;
}

/**
 * タグ文字列から指定した属性の値を取り出す(属性の順序は問わない)。
 * ダブルクォート囲み・シングルクォート囲みを別パターンとして扱い、開始と同じ種類の
 * 引用符が閉じ引用符になるまでをキャプチャする(`admin/functions/_lib/ogpMeta.ts`と同じ対策。
 * `[^"']`のような両方除外にすると、値中にアポストロフィを含む場合に途中で切れてしまうため)。
 */
function extractAttr(tag: string, attr: string): string | undefined {
  const re = new RegExp(`(?<![\\w-])${attr}(?![\\w-])\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const match = re.exec(tag);
  if (!match) return undefined;
  return match[1] !== undefined ? match[1] : match[2];
}

/** URLの文字列がa8.netドメイン(a8.net自身、またはそのサブドメイン)を指しているかを判定する */
function isA8NetUrl(rawUrl: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return false; // 相対URL・不正なURLはa8.netへのリンクとしては扱わない
  }
  return hostname === "a8.net" || hostname.endsWith(".a8.net");
}

/**
 * HTML文字列内に、a8.netドメインを含む`<a href="...">`リンクが存在するかを判定する純粋関数
 * (正規表現ベース)。商品の公式サイトのHTMLを対象とし、A8.net自体へはアクセスしない
 * (呼び出し側が既にA8.net以外のドメインから取得したHTML文字列を渡す前提)。
 */
export function scanHtmlForA8NetLinks(html: string): boolean {
  if (typeof html !== "string" || html.length === 0) return false;

  const anchorTags = html.match(/<a\b[^>]*>/gi) ?? [];
  for (const tag of anchorTags) {
    const href = extractAttr(tag, "href");
    if (href && isA8NetUrl(href)) {
      return true;
    }
  }
  return false;
}
