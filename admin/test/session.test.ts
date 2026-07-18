import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSessionToken,
  verifySessionToken,
  getCookieValue,
  serializeSessionCookie,
  serializeClearSessionCookie,
  serializeOAuthStateCookie,
  getSessionFromRequest,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "../functions/_lib/session";

const SECRET = "test-secret-value-please-be-long-enough";

test("createSessionToken/verifySessionTokenは正しいsecretでラウンドトリップできる", async () => {
  const token = await createSessionToken("octocat", SECRET);
  const payload = await verifySessionToken(token, SECRET);
  assert.ok(payload);
  assert.equal(payload?.login, "octocat");
});

test("verifySessionTokenは異なるsecretで検証すると署名不一致でnullを返す", async () => {
  const token = await createSessionToken("octocat", SECRET);
  const payload = await verifySessionToken(token, "wrong-secret-value-long-enough");
  assert.equal(payload, null);
});

test("verifySessionTokenは期限切れのトークンをnullで拒否する", async () => {
  const now = Math.floor(Date.now() / 1000);
  const issuedLongAgo = now - SESSION_MAX_AGE_SECONDS - 10;
  const token = await createSessionToken("octocat", SECRET, issuedLongAgo);
  const payload = await verifySessionToken(token, SECRET, now);
  assert.equal(payload, null);
});

test("verifySessionTokenは期限内であればnullを返さない", async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = await createSessionToken("octocat", SECRET, now);
  const payload = await verifySessionToken(token, SECRET, now + SESSION_MAX_AGE_SECONDS - 1);
  assert.ok(payload);
});

test("verifySessionTokenは改ざんされたペイロード(ログイン名の書き換え)をnullで拒否する", async () => {
  const token = await createSessionToken("octocat", SECRET);
  const [payloadB64, signature] = token.split(".");
  const decoded = JSON.parse(Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8"));
  decoded.login = "attacker";
  const tamperedPayloadB64 = Buffer.from(JSON.stringify(decoded))
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const tamperedToken = `${tamperedPayloadB64}.${signature}`;
  const payload = await verifySessionToken(tamperedToken, SECRET);
  assert.equal(payload, null);
});

test("verifySessionTokenは不正な形式のトークン(区切りが無い等)をnullで拒否する", async () => {
  assert.equal(await verifySessionToken("not-a-valid-token", SECRET), null);
  assert.equal(await verifySessionToken("", SECRET), null);
  assert.equal(await verifySessionToken("a.b.c", SECRET), null);
});

test("getCookieValueは複数Cookieの中から指定した名前の値を取り出す", () => {
  const header = `foo=bar; ${SESSION_COOKIE_NAME}=abc123; other=xyz`;
  assert.equal(getCookieValue(header, SESSION_COOKIE_NAME), "abc123");
  assert.equal(getCookieValue(header, "foo"), "bar");
  assert.equal(getCookieValue(header, "missing"), null);
});

test("getCookieValueはCookieヘッダが無い場合nullを返す", () => {
  assert.equal(getCookieValue(null, SESSION_COOKIE_NAME), null);
  assert.equal(getCookieValue(undefined, SESSION_COOKIE_NAME), null);
});

test("serializeSessionCookieはHttpOnly/Secure/SameSite=Laxを必ず含む", () => {
  const cookie = serializeSessionCookie("dummy-token");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE_NAME}=`));
});

test("serializeClearSessionCookieはMax-Age=0で即座に削除する", () => {
  const cookie = serializeClearSessionCookie();
  assert.match(cookie, /Max-Age=0/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
});

test("serializeOAuthStateCookieはHttpOnly/Secure/SameSite=Laxを含む短命Cookieを組み立てる", () => {
  const cookie = serializeOAuthStateCookie("state-value");
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /oauth_state=state-value/);
});

test("getSessionFromRequestは有効なセッションCookieを持つRequestから正しいセッションを返す", async () => {
  const token = await createSessionToken("octocat", SECRET);
  const request = new Request("https://example.com/api/products", {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}` },
  });
  const session = await getSessionFromRequest(request, { SESSION_SECRET: SECRET });
  assert.equal(session?.login, "octocat");
});

test("getSessionFromRequestはCookieが無いRequestに対してnullを返す(未認証)", async () => {
  const request = new Request("https://example.com/api/products");
  const session = await getSessionFromRequest(request, { SESSION_SECRET: SECRET });
  assert.equal(session, null);
});

test("getSessionFromRequestは不正なセッションCookieに対してnullを返す(未認証)", async () => {
  const request = new Request("https://example.com/api/products", {
    headers: { Cookie: `${SESSION_COOKIE_NAME}=garbage-value` },
  });
  const session = await getSessionFromRequest(request, { SESSION_SECRET: SECRET });
  assert.equal(session, null);
});
