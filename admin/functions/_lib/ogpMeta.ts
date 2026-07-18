/**
 * ページHTMLからOGPメタデータ(og:title/og:image)を抽出する純粋関数。
 *
 * `/api/resolveAffiliateLink`が、A8.netアフィリエイトリンクのリダイレクト先(officialUrl)の
 * HTMLから商品名・商品画像を自動抽出するために使う。`src/ogpImage.ts`(Node向け、本体投稿
 * パイプライン用)と同種の正規表現ベースのmetaタグ抽出だが、Workers runtimeはNode組み込み
 * モジュールに依存する`src/`をimportできないため、ここで独立して実装する。
 */

export interface OgpMetadata {
  title: string | null;
  image: string | null;
}

/**
 * タグ文字列から指定した属性の値を取り出す(属性の順序は問わない)。
 * 単語境界を要求し、`data-property`のような別属性名の末尾に誤マッチしないようにする。
 * ダブルクォート囲み・シングルクォート囲みを別パターンとして扱い、開始と同じ種類の
 * 引用符が閉じ引用符になるまでをキャプチャする(`[^"']`のような両方除外にすると、
 * 例えば`content="Trader Joe's Coffee"`のようにダブルクォート値の中にアポストロフィが
 * 含まれる場合、閉じクォートに達する前に途中で切れて誤った値を抽出してしまうため)。
 */
function extractAttr(tag: string, attr: string): string | undefined {
  const re = new RegExp(`(?<![\\w-])${attr}(?![\\w-])\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i");
  const match = re.exec(tag);
  if (!match) return undefined;
  return match[1] !== undefined ? match[1] : match[2];
}

/** HTMLエンティティの簡易デコード(admin/functions/_lib/htmlText.tsと同じ変換対象) */
function unescapeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");
}

/** http:/https:のURLのみ許可する(admin/functions/_lib/validate.tsのisHttpUrlと同じ判定をここで独立実装) */
function isHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * HTML文字列から`og:title`/`og:image`を抽出する。
 * - titleは`og:title`を優先し、無ければ`<title>...</title>`をフォールバックとして使う。
 * - imageは`og:image`の値を`baseUrl`(取得元ページのURL)を基準に絶対URLへ解決する。
 *   相対URLの解決に失敗した場合・解決後のURLがhttp:/https:以外の場合は`null`にする
 *   (呼び出し元の`isSafeExternalUrl`によるSSRF検証は行わない。あくまでレスポンスに含める
 *   参考情報であり、このURL自体をサーバー側で再取得することはないため)。
 * いずれの段階が欠けていても例外を投げず、`null`を返す(安全側に倒す)。
 */
export function extractOgpMetadata(html: string, baseUrl: string): OgpMetadata {
  if (typeof html !== "string" || html.length === 0) {
    return { title: null, image: null };
  }

  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  let ogTitle: string | undefined;
  let ogImage: string | undefined;

  for (const tag of metaTags) {
    const property = (extractAttr(tag, "property") ?? extractAttr(tag, "name"))?.toLowerCase();
    if (!property) continue;
    const content = extractAttr(tag, "content");
    if (content === undefined) continue;

    if (property === "og:title" && ogTitle === undefined) ogTitle = content;
    if (property === "og:image" && ogImage === undefined) ogImage = content;
  }

  let title: string | null = null;
  if (ogTitle !== undefined && ogTitle.trim().length > 0) {
    title = unescapeHtmlEntities(ogTitle).trim();
  } else {
    const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const raw = titleMatch?.[1]?.trim();
    title = raw ? unescapeHtmlEntities(raw).trim() : null;
  }
  if (title === "") title = null;

  let image: string | null = null;
  if (ogImage !== undefined && ogImage.trim().length > 0) {
    try {
      const resolved = new URL(ogImage, baseUrl).href;
      if (isHttpUrl(resolved)) image = resolved;
    } catch {
      image = null;
    }
  }

  return { title, image };
}
