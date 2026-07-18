/**
 * GET /api/auth/callback
 * 1. state検証(CSRF対策、login.tsが発行したCookieの値とクエリパラメータの一致を確認)
 * 2. codeをaccess_tokenに交換
 * 3. GitHub API `/user` でログイン名を取得
 * 4. `ALLOWED_GITHUB_LOGIN`(env, 単一ユーザー名)と大小無視で一致するか検証
 *    - 一致すれば署名付きセッションCookieを発行して`/`へリダイレクト
 *    - 不一致(または途中のいずれかの検証に失敗)なら401
 */
import type { Env } from "../../_lib/types";
import {
  getCookieValue,
  createSessionToken,
  serializeSessionCookie,
  serializeClearOAuthStateCookie,
  OAUTH_STATE_COOKIE_NAME,
} from "../../_lib/session";

function unauthorized(message: string): Response {
  const headers = new Headers({ "Content-Type": "text/plain; charset=utf-8" });
  // OAuthフローが失敗した場合も、途中で発行した短命stateCookieは残さず必ず削除する
  headers.append("Set-Cookie", serializeClearOAuthStateCookie());
  return new Response(message, { status: 401, headers });
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = getCookieValue(request.headers.get("Cookie"), OAUTH_STATE_COOKIE_NAME);

  if (!code || !state || !cookieState || state !== cookieState) {
    return unauthorized("OAuth state の検証に失敗しました。もう一度ログインし直してください。");
  }

  let tokenRes: Response;
  try {
    tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: env.GITHUB_OAUTH_CLIENT_ID,
        client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
        code,
        redirect_uri: `${url.origin}/api/auth/callback`,
      }),
    });
  } catch {
    return unauthorized("GitHub OAuthトークンエンドポイントへの接続に失敗しました。");
  }

  if (!tokenRes.ok) {
    return unauthorized("GitHub OAuthトークンの取得に失敗しました。");
  }

  let tokenData: { access_token?: string; error?: string };
  try {
    tokenData = await tokenRes.json();
  } catch {
    return unauthorized("GitHub OAuthトークンレスポンスの解析に失敗しました。");
  }

  if (!tokenData.access_token) {
    return unauthorized("GitHub OAuthはアクセストークンを返しませんでした。");
  }

  let userRes: Response;
  try {
    userRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        "User-Agent": "x-auto-post-admin",
        Accept: "application/vnd.github+json",
      },
    });
  } catch {
    return unauthorized("GitHubユーザー情報の取得に失敗しました。");
  }

  if (!userRes.ok) {
    return unauthorized("GitHubユーザー情報の取得に失敗しました。");
  }

  let userData: { login?: string };
  try {
    userData = await userRes.json();
  } catch {
    return unauthorized("GitHubユーザー情報レスポンスの解析に失敗しました。");
  }

  const login = userData.login;
  if (!login || login.toLowerCase() !== env.ALLOWED_GITHUB_LOGIN.toLowerCase()) {
    return unauthorized("このGitHubアカウントにはアクセス権限がありません。");
  }

  const sessionToken = await createSessionToken(login, env.SESSION_SECRET);
  const headers = new Headers();
  headers.set("Location", "/");
  headers.append("Set-Cookie", serializeSessionCookie(sessionToken));
  headers.append("Set-Cookie", serializeClearOAuthStateCookie());
  return new Response(null, { status: 302, headers });
};
