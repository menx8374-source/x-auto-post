/**
 * バリデーション用の純粋関数群。
 *
 * Workers runtimeはNode組み込みモジュールに依存できないため、ルート側
 * `src/ogpImage.ts`(isHttpUrl)・`src/generateAffiliateRedirects.ts`(SAFE_PRODUCT_ID)と
 * 同じロジックをここで独立して再実装する(import不可のため)。
 */
import type { AffiliateProduct } from "./types";

/** http:/https:のURLのみ許可する(javascript:等の不正スキームを拒否) */
export function isHttpUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === "http:" || parsed.protocol === "https:";
}

/**
 * 商品IDとして許可する形式(英数字・ハイフン・アンダースコアのみ)。
 * IDはリダイレクトページのファイルパス(`docs/go/<id>.html`)の一部になるため、
 * パストラバーサル対策として必ずこの正規表現で検証してから使う。
 */
export const SAFE_PRODUCT_ID = /^[a-zA-Z0-9_-]+$/;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * `/api/products` POSTのリクエストボディを検証する。
 * 型・必須項目・URLスキーム・商品ID形式のすべてを1回で検証し、エラー一覧を返す
 * (壊れたデータをGitHubへコミットしないための最終防衛ライン)。
 */
export function validateProductInput(input: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { valid: false, errors: ["リクエストボディはオブジェクトである必要があります"] };
  }
  const p = input as Record<string, unknown>;

  if (typeof p.id !== "string" || p.id.length === 0) {
    errors.push("idは必須の文字列です");
  } else if (!SAFE_PRODUCT_ID.test(p.id)) {
    errors.push("idは英数字・ハイフン(-)・アンダースコア(_)のみ使用できます");
  }

  if (typeof p.name !== "string" || p.name.trim().length === 0) {
    errors.push("nameは必須の文字列です");
  }

  if (typeof p.officialUrl !== "string" || p.officialUrl.length === 0) {
    errors.push("officialUrlは必須の文字列です");
  } else if (!isHttpUrl(p.officialUrl)) {
    errors.push("officialUrlはhttp:またはhttps:のURLである必要があります");
  }

  if (p.imageUrl !== undefined && p.imageUrl !== "" && p.imageUrl !== null) {
    if (typeof p.imageUrl !== "string" || !isHttpUrl(p.imageUrl)) {
      errors.push("imageUrlを指定する場合はhttp:またはhttps:のURLである必要があります");
    }
  }

  if (typeof p.affiliateUrl !== "string" || p.affiliateUrl.length === 0) {
    errors.push("affiliateUrlは必須の文字列です");
  } else if (!isHttpUrl(p.affiliateUrl)) {
    errors.push("affiliateUrlはhttp:またはhttps:のURLである必要があります");
  }

  if (!Array.isArray(p.facts) || p.facts.length === 0 || p.facts.some((f) => typeof f !== "string" || f.trim().length === 0)) {
    errors.push("factsは1件以上の空でない文字列を含む配列である必要があります");
  }

  if (p.category !== undefined && p.category !== "" && p.category !== null && typeof p.category !== "string") {
    errors.push("categoryを指定する場合は文字列である必要があります");
  }

  if (typeof p.enabled !== "boolean") {
    errors.push("enabledはboolean(true/false)である必要があります");
  }

  return { valid: errors.length === 0, errors };
}

/** バリデーション済みのリクエストボディをAffiliateProduct型に整形する(未定義の任意項目を除去) */
export function toAffiliateProduct(input: Record<string, unknown>): AffiliateProduct {
  const product: AffiliateProduct = {
    id: input.id as string,
    name: input.name as string,
    officialUrl: input.officialUrl as string,
    affiliateUrl: input.affiliateUrl as string,
    facts: input.facts as string[],
    enabled: input.enabled as boolean,
  };
  if (typeof input.imageUrl === "string" && input.imageUrl.length > 0) {
    product.imageUrl = input.imageUrl;
  }
  if (typeof input.category === "string" && input.category.length > 0) {
    product.category = input.category;
  }
  return product;
}
