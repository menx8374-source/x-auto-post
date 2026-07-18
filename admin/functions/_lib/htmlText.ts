/**
 * 公式サイトのHTMLから可読テキストを抽出する純粋関数。
 *
 * Cloudflare Workers本番の`HTMLRewriter`APIはNode.js環境(admin/testの`node:test`ランナー)には
 * グローバルに存在せずユニットテストできないため、テスト容易性を優先し正規表現ベースの簡易抽出にする
 * (`<script>`/`<style>`はタグの内容ごと必ず除去し、それ以外のタグは単純に取り除いて空白を正規化する)。
 */
export function extractTextFromHtml(html: string): string {
  if (typeof html !== "string" || html.length === 0) return "";

  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    // ブロック要素の開始/終了タグは改行に変える(単語がくっつくのを防ぐ)
    .replace(/<\/?(p|div|br|li|tr|h[1-6]|section|article|header|footer)\b[^>]*>/gi, "\n")
    // 残りのタグ(nav/footer等の内容そのものは抽出対象に含めてよい簡易実装。仕様上「実装が
    // 複雑になりすぎる場合は正規表現によるタグ除去+空白正規化でもよい」の許容範囲)
    .replace(/<[^>]+>/g, " ");

  text = text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");

  return text
    .split("\n")
    .map((line) => line.replace(/[ \t　]+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}
