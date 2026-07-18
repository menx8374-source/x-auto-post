import { test } from "node:test";
import assert from "node:assert/strict";
import { shortenUrl, type ShortenFetchLike } from "../src/urlShortener.js";

function mockResponse(body: string): Response {
  return new Response(body, { status: 200 });
}

test("shortenUrl: TinyURL APIが成功レスポンス(https://tinyurl.com/...)を返せば、その短縮URLを返す", async () => {
  let requestedUrl = "";
  const fetchImpl: ShortenFetchLike = (async (url: string) => {
    requestedUrl = url;
    return mockResponse("https://tinyurl.com/abcd1234");
  }) as ShortenFetchLike;

  const result = await shortenUrl("https://px.a8.net/svt/ejp?a8mat=4B83D1+D5X2B6+5QLS+HV7V6", fetchImpl);

  assert.equal(result, "https://tinyurl.com/abcd1234");
  assert.match(requestedUrl, /^https:\/\/tinyurl\.com\/api-create\.php\?url=/);
  assert.match(requestedUrl, /a8mat/);
});

test("shortenUrl: リクエストがタイムアウト/例外を投げた場合はnullを返す(例外を外に投げない)", async () => {
  const fetchImpl: ShortenFetchLike = (async () => {
    throw new Error("request timed out");
  }) as ShortenFetchLike;

  const result = await shortenUrl("https://px.a8.net/svt/ejp?a8mat=test", fetchImpl);
  assert.equal(result, null);
});

test("shortenUrl: TinyURLがエラーメッセージ(不正な形式のプレーンテキスト)を返した場合はnullを返す", async () => {
  const fetchImpl: ShortenFetchLike = (async () => {
    return mockResponse("Error: Invalid Url");
  }) as ShortenFetchLike;

  const result = await shortenUrl("https://example.com/broken", fetchImpl);
  assert.equal(result, null);
});

test("shortenUrl: レスポンス本文の読み取り自体が失敗した場合はnullを返す", async () => {
  const fetchImpl: ShortenFetchLike = (async () => {
    return {
      text: async () => {
        throw new Error("body read failed");
      },
    } as unknown as Response;
  }) as ShortenFetchLike;

  const result = await shortenUrl("https://example.com/broken", fetchImpl);
  assert.equal(result, null);
});

test("shortenUrl: http/https以外のスキームは短縮を試みずnullを返す", async () => {
  let called = false;
  const fetchImpl: ShortenFetchLike = (async () => {
    called = true;
    return mockResponse("https://tinyurl.com/should-not-be-called");
  }) as ShortenFetchLike;

  const result = await shortenUrl("javascript:alert(1)", fetchImpl);
  assert.equal(result, null);
  assert.equal(called, false);
});
