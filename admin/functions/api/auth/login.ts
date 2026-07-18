/**
 * GET /api/auth/login
 * GitHub OAuth authorize URLへリダイレクトする。CSRF対策のstateパラメータを生成し、
 * HttpOnly Cookie(短命)に保存しておき、callback側でこのCookieの値とstateパラメータの
 * 一致を検証する。
 */
import type { Env } from "../../_lib/types";
import { serializeOAuthStateCookie } from "../../_lib/session";

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const state = crypto.randomUUID();
  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/callback`;

  const authorizeUrl = new URL("https://github.com/login/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", env.GITHUB_OAUTH_CLIENT_ID);
  authorizeUrl.searchParams.set("redirect_uri", redirectUri);
  authorizeUrl.searchParams.set("scope", "read:user");
  authorizeUrl.searchParams.set("state", state);

  const headers = new Headers();
  headers.set("Location", authorizeUrl.toString());
  headers.set("Set-Cookie", serializeOAuthStateCookie(state));
  return new Response(null, { status: 302, headers });
};
