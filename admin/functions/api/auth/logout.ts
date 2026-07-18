/**
 * GET/POST /api/auth/logout
 * セッションCookieを削除する。
 */
import type { Env } from "../../_lib/types";
import { serializeClearSessionCookie } from "../../_lib/session";

const handleLogout: PagesFunction<Env> = async () => {
  const headers = new Headers();
  headers.set("Location", "/");
  headers.append("Set-Cookie", serializeClearSessionCookie());
  return new Response(null, { status: 302, headers });
};

export const onRequestGet = handleLogout;
export const onRequestPost = handleLogout;
