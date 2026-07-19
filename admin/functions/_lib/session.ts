/**
 * 署名付きセッションCookieのsign/verify。
 *
 * Workers runtimeはNode組み込みの`crypto`/`node:crypto`モジュールに依存できないため、
 * Web Crypto API(`crypto.subtle`、HMAC-SHA256)のみを使う(Workers・ブラウザ・Node.js 18+の
 * いずれでもグローバルに利用可能なため、admin配下のNodeベースのユニットテストからもそのまま検証できる)。
 */
import type { Env } from "./types";

/** セッションの有効期限(秒)。発行から7日 */
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export const SESSION_COOKIE_NAME = "admin_session";

/** OAuthのCSRF対策用state一時Cookie。ログイン試行の間だけ有効であればよいため短命(10分) */
export const OAUTH_STATE_COOKIE_NAME = "oauth_state";
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

export interface SessionPayload {
  /** ログインしたGitHubユーザー名 */
  login: string;
  /** 発行時刻(epoch秒) */
  iat: number;
  /** 有効期限(epoch秒) */
  exp: number;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function hmacSignBase64Url(secret: string, data: string): Promise<string> {
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return base64UrlEncode(new Uint8Array(signature));
}

/** 定数時間比較(タイミング攻撃対策)。長さが異なる場合も早期returnせず最後まで比較する */
function timingSafeEqual(a: string, b: string): boolean {
  const maxLength = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < maxLength; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    mismatch |= ca ^ cb;
  }
  return mismatch === 0;
}

/** `<base64urlペイロード>.<base64url署名>` 形式の署名付きセッショントークンを発行する */
export async function createSessionToken(
  login: string,
  secret: string,
  now: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const payload: SessionPayload = { login, iat: now, exp: now + SESSION_MAX_AGE_SECONDS };
  const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await hmacSignBase64Url(secret, payloadB64);
  return `${payloadB64}.${signature}`;
}

/**
 * セッショントークンを検証する。形式不正・署名不一致・期限切れのいずれの場合も
 * 例外を投げず`null`を返す(呼び出し側は「未認証」として一様に扱えばよい)。
 */
export async function verifySessionToken(
  token: string,
  secret: string,
  now: number = Math.floor(Date.now() / 1000)
): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return null;

  const expectedSignature = await hmacSignBase64Url(secret, payloadB64);
  if (!timingSafeEqual(signature, expectedSignature)) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadB64)));
  } catch {
    return null;
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    typeof payload.login !== "string" ||
    typeof payload.iat !== "number" ||
    typeof payload.exp !== "number"
  ) {
    return null;
  }
  if (now >= payload.exp) return null;

  return payload;
}

/** Cookieヘッダから指定した名前の値を取り出す(見つからなければnull) */
export function getCookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    if (key === name) {
      try {
        return decodeURIComponent(trimmed.slice(eq + 1));
      } catch {
        return trimmed.slice(eq + 1);
      }
    }
  }
  return null;
}

/** セッションCookieの`Set-Cookie`ヘッダ値を組み立てる。HttpOnly/Secure/SameSite=Laxを必ず付与する */
export function serializeSessionCookie(token: string): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;
}

/** セッションCookieを削除するための`Set-Cookie`ヘッダ値 */
export function serializeClearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/** OAuth state用の一時Cookie(短命)の`Set-Cookie`ヘッダ値 */
export function serializeOAuthStateCookie(state: string): string {
  return `${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(state)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${OAUTH_STATE_MAX_AGE_SECONDS}`;
}

/** OAuth state用の一時Cookieを削除するための`Set-Cookie`ヘッダ値 */
export function serializeClearOAuthStateCookie(): string {
  return `${OAUTH_STATE_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/**
 * リクエストのCookieからセッションを取得・検証する。認証必須の各APIエンドポイントは
 * 必ずこの関数を先頭で呼び、`null`(未認証)なら401を返してから処理を打ち切ること。
 */
export async function getSessionFromRequest(
  request: Request,
  env: Pick<Env, "SESSION_SECRET">
): Promise<SessionPayload | null> {
  const token = getCookieValue(request.headers.get("Cookie"), SESSION_COOKIE_NAME);
  if (!token) return null;
  return verifySessionToken(token, env.SESSION_SECRET);
}
