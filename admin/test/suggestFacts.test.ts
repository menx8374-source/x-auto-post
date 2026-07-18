import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestPost } from "../functions/api/suggestFacts";
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

async function buildAuthedRequest(body: unknown): Promise<Request> {
  const token = await createSessionToken("menx8374-source", ENV.SESSION_SECRET);
  return new Request("https://admin.example.com/api/suggestFacts", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `admin_session=${encodeURIComponent(token)}` },
    body: JSON.stringify(body),
  });
}

test("onRequestPostは未認証(Cookie無し)の場合401を返す", async () => {
  const request = new Request("https://admin.example.com/api/suggestFacts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ officialUrl: "https://example.com" }),
  });
  const res = await onRequestPost({ request, env: ENV } as any);
  assert.equal(res.status, 401);
});

test("onRequestPostはofficialUrlが不正スキームの場合400を返し、fetchを一切呼ばない", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("", { status: 200 });
  }) as typeof fetch;
  try {
    const request = await buildAuthedRequest({ officialUrl: "javascript:alert(1)" });
    const res = await onRequestPost({ request, env: ENV } as any);
    assert.equal(res.status, 400);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("onRequestPostは内部向けホストのofficialUrlを400で拒否し、fetchを一切呼ばない", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("", { status: 200 });
  }) as typeof fetch;
  try {
    const request = await buildAuthedRequest({ officialUrl: "http://169.254.169.254/latest/meta-data/" });
    const res = await onRequestPost({ request, env: ENV } as any);
    assert.equal(res.status, 400);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("onRequestPostはANTHROPIC_API_KEY未設定の場合503を返し、公式サイトへのfetchは呼ばない", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response("", { status: 200 });
  }) as typeof fetch;
  try {
    const envWithoutKey: Env = { ...ENV, ANTHROPIC_API_KEY: undefined };
    const request = await buildAuthedRequest({ officialUrl: "https://example.com" });
    const res = await onRequestPost({ request, env: envWithoutKey } as any);
    assert.equal(res.status, 503);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});

test(
  "onRequestPostは、officialUrl自体は安全でもリダイレクトで内部向けホストへ到達した場合、" +
    "ボディを読まず400で拒否する(SSRFガードのリダイレクトによるバイパス対策)",
  async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: string | URL) => {
      const url = input.toString();
      if (url === "https://example.com/product") {
        // redirect: "follow"を追従した結果、最終的に内部向けホストへ到達したことを
        // res.urlで表現する(実際のCloudflare Workers/ブラウザのfetch挙動を模す)。
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("internal metadata secret"));
            controller.close();
          },
        });
        const res = new Response(stream, { status: 200 });
        Object.defineProperty(res, "url", {
          value: "http://169.254.169.254/latest/meta-data/",
          configurable: true,
        });
        return res;
      }
      throw new Error(`unexpected fetch to ${url}`);
    }) as typeof fetch;

    try {
      const request = await buildAuthedRequest({ officialUrl: "https://example.com/product" });
      const res = await onRequestPost({ request, env: ENV } as any);
      assert.equal(res.status, 400);
      const data = (await res.json()) as { error?: string };
      assert.match(data.error || "", /内部向け|リダイレクト/);
    } finally {
      globalThis.fetch = original;
    }
  }
);

test("onRequestPostは正常系: 公式サイト取得(リダイレクトなし)→facts抽出→JSON配列を返す", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL) => {
    const url = input.toString();
    if (url === "https://example.com/product") {
      const res = new Response("<html><body><p>価格は1000円です</p></body></html>", { status: 200 });
      Object.defineProperty(res, "url", { value: url, configurable: true });
      return res;
    }
    if (url === "https://api.anthropic.com/v1/messages") {
      return new Response(JSON.stringify({ content: [{ type: "text", text: '["価格は1000円です"]' }] }), {
        status: 200,
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as typeof fetch;

  try {
    const request = await buildAuthedRequest({ officialUrl: "https://example.com/product" });
    const res = await onRequestPost({ request, env: ENV } as any);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { facts?: string[] };
    assert.deepEqual(data.facts, ["価格は1000円です"]);
  } finally {
    globalThis.fetch = original;
  }
});
