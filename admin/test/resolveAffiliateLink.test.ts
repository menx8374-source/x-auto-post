import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/resolveAffiliateLink";
import { createSessionToken } from "../functions/_lib/session";
import type { Env } from "../functions/_lib/types";

const ENV: Env = {
  GITHUB_PAT: "test-pat",
  GITHUB_REPO: "menx8374-source/x-auto-post",
  GITHUB_BRANCH: "main",
  GITHUB_OAUTH_CLIENT_ID: "client-id",
  GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
  ALLOWED_GITHUB_LOGIN: "menx8374-source",
  SESSION_SECRET: "test-session-secret",
  ANTHROPIC_API_KEY: "test-anthropic-key",
};

const AFFILIATE_URL = "https://px.a8.net/svt/ejp?a8mat=4B83D1+D5X2B6+5QLS+HV7V6";

async function buildAuthedRequest(body: unknown): Promise<Request> {
  const token = await createSessionToken("menx8374-source", ENV.SESSION_SECRET);
  return new Request("https://admin.example.com/api/resolveAffiliateLink", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `admin_session=${encodeURIComponent(token)}` },
    body: JSON.stringify(body),
  });
}

function redirectResponse(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } });
}

test("onRequestPostは未認証(Cookie無し)の場合401を返す", async () => {
  const request = new Request("https://admin.example.com/api/resolveAffiliateLink", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ affiliateUrl: AFFILIATE_URL }),
  });
  const res = await onRequestPost({ request, env: ENV } as any);
  assert.equal(res.status, 401);
});

test("onRequestPostはaffiliateUrlが不正スキームの場合400を返し、fetchを一切呼ばない", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("", { status: 200 });
  }) as typeof fetch;
  try {
    const request = await buildAuthedRequest({ affiliateUrl: "javascript:alert(1)" });
    const res = await onRequestPost({ request, env: ENV } as any);
    assert.equal(res.status, 400);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("onRequestPostはリダイレクト先が内部向けホストの場合、そのホストへは決してfetchせず400で拒否する(事前検証SSRFガード)", async () => {
  const original = globalThis.fetch;
  let callCount = 0;
  const calledUrls: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    callCount++;
    const url = input.toString();
    calledUrls.push(url);
    if (url === AFFILIATE_URL) {
      return redirectResponse("http://169.254.169.254/latest/meta-data/");
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as typeof fetch;

  try {
    const request = await buildAuthedRequest({ affiliateUrl: AFFILIATE_URL });
    const res = await onRequestPost({ request, env: ENV } as any);
    assert.equal(res.status, 400);
    const data = (await res.json()) as { error?: string };
    assert.match(data.error || "", /安全でない|内部向け/);
    // 内部向けホストへのfetchは一度も発生していないこと(事前検証で遮断されるため)
    assert.equal(callCount, 1);
    assert.deepEqual(calledUrls, [AFFILIATE_URL]);
  } finally {
    globalThis.fetch = original;
  }
});

test("onRequestPostはリダイレクトが最大ホップ数(5)を超えた場合502を返す", async () => {
  const original = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount++;
    return redirectResponse("https://example.com/next");
  }) as typeof fetch;

  try {
    const request = await buildAuthedRequest({ affiliateUrl: AFFILIATE_URL });
    const res = await onRequestPost({ request, env: ENV } as any);
    assert.equal(res.status, 502);
    const data = (await res.json()) as { error?: string };
    assert.match(data.error || "", /リダイレクト/);
    assert.equal(callCount, 6); // 初回 + 5ホップ = 6回のfetchで打ち切られる
  } finally {
    globalThis.fetch = original;
  }
});

test("onRequestPostはfetch自体が失敗(タイムアウト等)した場合502を返す", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    throw new Error("The operation was aborted");
  }) as typeof fetch;

  try {
    const request = await buildAuthedRequest({ affiliateUrl: AFFILIATE_URL });
    const res = await onRequestPost({ request, env: ENV } as any);
    assert.equal(res.status, 502);
    const data = (await res.json()) as { error?: string };
    assert.match(data.error || "", /取得に失敗/);
  } finally {
    globalThis.fetch = original;
  }
});

test("onRequestPostはANTHROPIC_API_KEY未設定の場合でもofficialUrl/name/imageUrlは返し、factsのみ空配列にする(AI呼び出しは行わない)", async () => {
  const original = globalThis.fetch;
  let anthropicCalled = false;
  globalThis.fetch = (async (input: string | URL) => {
    const url = input.toString();
    if (url === AFFILIATE_URL) {
      return redirectResponse("https://example.com/product");
    }
    if (url === "https://example.com/product") {
      return new Response(
        `<html><head><meta property="og:title" content="すごい商品"><meta property="og:image" content="https://example.com/img.png"></head></html>`,
        { status: 200 }
      );
    }
    if (url === "https://api.anthropic.com/v1/messages") {
      anthropicCalled = true;
      return new Response(JSON.stringify({ content: [{ type: "text", text: "[]" }] }), { status: 200 });
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as typeof fetch;

  try {
    const envWithoutKey: Env = { ...ENV, ANTHROPIC_API_KEY: undefined };
    const request = await buildAuthedRequest({ affiliateUrl: AFFILIATE_URL });
    const res = await onRequestPost({ request, env: envWithoutKey } as any);
    assert.equal(res.status, 200);
    const data = (await res.json()) as {
      officialUrl?: string;
      name?: string | null;
      imageUrl?: string | null;
      facts?: string[];
      affiliateUrl?: string;
    };
    assert.equal(data.officialUrl, "https://example.com/product");
    assert.equal(data.name, "すごい商品");
    assert.equal(data.imageUrl, "https://example.com/img.png");
    assert.deepEqual(data.facts, []);
    assert.equal(data.affiliateUrl, undefined); // affiliateUrlはレスポンスに含めない
    assert.equal(anthropicCalled, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("onRequestPostは正常系: リダイレクト追跡→OGP抽出→facts抽出まで一貫して成功する", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL) => {
    const url = input.toString();
    if (url === AFFILIATE_URL) {
      return redirectResponse("https://example.com/mid");
    }
    if (url === "https://example.com/mid") {
      return redirectResponse("https://example.com/product");
    }
    if (url === "https://example.com/product") {
      return new Response(
        `<html><head><meta property="og:title" content="すごい商品B">` +
          `<meta property="og:image" content="/images/b.png"></head>` +
          `<body><p>価格は2000円です</p></body></html>`,
        { status: 200 }
      );
    }
    if (url === "https://api.anthropic.com/v1/messages") {
      return new Response(JSON.stringify({ content: [{ type: "text", text: '["価格は2000円です"]' }] }), {
        status: 200,
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as typeof fetch;

  try {
    const request = await buildAuthedRequest({ affiliateUrl: AFFILIATE_URL });
    const res = await onRequestPost({ request, env: ENV } as any);
    assert.equal(res.status, 200);
    const data = (await res.json()) as {
      officialUrl?: string;
      name?: string | null;
      imageUrl?: string | null;
      facts?: string[];
    };
    assert.equal(data.officialUrl, "https://example.com/product");
    assert.equal(data.name, "すごい商品B");
    assert.equal(data.imageUrl, "https://example.com/images/b.png");
    assert.deepEqual(data.facts, ["価格は2000円です"]);
  } finally {
    globalThis.fetch = original;
  }
});
