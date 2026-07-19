import { test } from "node:test";
import assert from "node:assert/strict";
import { onRequestGet, onRequestPost } from "../functions/api/applicationTracking";
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
};

function utf8ToBase64(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64");
}

async function authedRequest(method: string, body?: unknown): Promise<Request> {
  const token = await createSessionToken("menx8374-source", ENV.SESSION_SECRET);
  return new Request("https://admin.example.com/api/applicationTracking", {
    method,
    headers: { "Content-Type": "application/json", Cookie: `admin_session=${encodeURIComponent(token)}` },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

test("onRequestGetは未認証(Cookie無し)の場合401を返す", async () => {
  const request = new Request("https://admin.example.com/api/applicationTracking");
  const res = await onRequestGet({ request, env: ENV } as any);
  assert.equal(res.status, 401);
});

test("onRequestPostは未認証(Cookie無し)の場合401を返す", async () => {
  const request = new Request("https://admin.example.com/api/applicationTracking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productName: "テスト商品", officialUrl: "https://example.com", a8NetHint: { type: "unknown" }, status: "applying" }),
  });
  const res = await onRequestPost({ request, env: ENV } as any);
  assert.equal(res.status, 401);
});

test("onRequestGetはGitHub Contents APIからentriesを取得して返す", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ content: utf8ToBase64(JSON.stringify([{ id: "a", productName: "P" }])), sha: "sha1" }), {
      status: 200,
    })) as typeof fetch;
  try {
    const request = await authedRequest("GET");
    const res = await onRequestGet({ request, env: ENV } as any);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { entries?: unknown[] };
    assert.equal(data.entries?.length, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test("onRequestGetはファイル未作成(404)の場合、空配列を返す", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
  try {
    const request = await authedRequest("GET");
    const res = await onRequestGet({ request, env: ENV } as any);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { entries?: unknown[] };
    assert.deepEqual(data.entries, []);
  } finally {
    globalThis.fetch = original;
  }
});

test("onRequestPostはproductName未指定(新規作成)の場合400を返す", async () => {
  const request = await authedRequest("POST", { officialUrl: "https://example.com", a8NetHint: { type: "unknown" }, status: "applying" });
  const res = await onRequestPost({ request, env: ENV } as any);
  assert.equal(res.status, 400);
});

test("onRequestPostはofficialUrlが不正スキームの場合400を返す", async () => {
  const request = await authedRequest("POST", {
    productName: "テスト商品",
    officialUrl: "javascript:alert(1)",
    a8NetHint: { type: "unknown" },
    status: "applying",
  });
  const res = await onRequestPost({ request, env: ENV } as any);
  assert.equal(res.status, 400);
});

test("onRequestPostはstatusが不正な値の場合400を返す", async () => {
  const request = await authedRequest("POST", {
    productName: "テスト商品",
    officialUrl: "https://example.com",
    a8NetHint: { type: "unknown" },
    status: "rejected",
  });
  const res = await onRequestPost({ request, env: ENV } as any);
  assert.equal(res.status, 400);
});

test("onRequestPostは新規作成: idをサーバー側で発行し、既存配列に追記してGitHubへコミットする", async () => {
  const original = globalThis.fetch;
  let putBody: any = null;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = input.toString();
    if (init?.method === "PUT") {
      putBody = JSON.parse((init.body as string) || "{}");
      return new Response(JSON.stringify({ content: { sha: "new-sha" } }), { status: 200 });
    }
    if (url.includes("/contents/")) {
      return new Response(JSON.stringify({ content: utf8ToBase64("[]"), sha: "old-sha" }), { status: 200 });
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as typeof fetch;

  try {
    const request = await authedRequest("POST", {
      productName: "SuperAI Tool",
      officialUrl: "https://superai.example.com",
      a8NetHint: { type: "site_link_found" },
      status: "applying",
    });
    const res = await onRequestPost({ request, env: ENV } as any);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { ok?: boolean; entry?: { id?: string; status?: string } };
    assert.equal(data.ok, true);
    assert.ok(data.entry?.id);
    assert.equal(data.entry?.status, "applying");

    const committed = JSON.parse(Buffer.from(putBody.content, "base64").toString("utf-8"));
    assert.equal(committed.length, 1);
    assert.equal(committed[0].productName, "SuperAI Tool");
    assert.equal(putBody.sha, "old-sha");
  } finally {
    globalThis.fetch = original;
  }
});

test(
  "onRequestPostは新規作成: officialUrlGuessが無いknown_brand候補(officialUrl未指定/null)でも" +
    "200で作成できる(/code-review CONFIRMED回帰テスト。officialUrlをnullに正規化して保存する)",
  async () => {
    const original = globalThis.fetch;
    let putBody: any = null;
    globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      if (init?.method === "PUT") {
        putBody = JSON.parse((init.body as string) || "{}");
        return new Response(JSON.stringify({ content: { sha: "new-sha" } }), { status: 200 });
      }
      if (url.includes("/contents/")) {
        return new Response(JSON.stringify({ content: utf8ToBase64("[]"), sha: "old-sha" }), { status: 200 });
      }
      throw new Error(`unexpected fetch to ${url}`);
    }) as typeof fetch;

    try {
      const request = await authedRequest("POST", {
        productName: "楽天市場",
        officialUrl: null,
        a8NetHint: { type: "known_brand", a8AdvertiserId: "s00000011623" },
        status: "applying",
      });
      const res = await onRequestPost({ request, env: ENV } as any);
      assert.equal(res.status, 200);
      const data = (await res.json()) as { ok?: boolean; entry?: { officialUrl?: unknown } };
      assert.equal(data.ok, true);
      assert.equal(data.entry?.officialUrl, null);

      const committed = JSON.parse(Buffer.from(putBody.content, "base64").toString("utf-8"));
      assert.equal(committed[0].officialUrl, null);
    } finally {
      globalThis.fetch = original;
    }
  }
);

test("onRequestPostは既存エントリのステータス更新({id, status})を正しく反映する", async () => {
  const original = globalThis.fetch;
  let putBody: any = null;
  const existing = [
    {
      id: "entry-1",
      productName: "SuperAI Tool",
      officialUrl: "https://superai.example.com",
      a8NetHint: { type: "site_link_found" },
      status: "applying",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
  ];
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = input.toString();
    if (init?.method === "PUT") {
      putBody = JSON.parse((init.body as string) || "{}");
      return new Response(JSON.stringify({ content: { sha: "new-sha" } }), { status: 200 });
    }
    if (url.includes("/contents/")) {
      return new Response(JSON.stringify({ content: utf8ToBase64(JSON.stringify(existing)), sha: "old-sha" }), {
        status: 200,
      });
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as typeof fetch;

  try {
    const request = await authedRequest("POST", { id: "entry-1", status: "approved" });
    const res = await onRequestPost({ request, env: ENV } as any);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { entry?: { id?: string; status?: string } };
    assert.equal(data.entry?.status, "approved");

    const committed = JSON.parse(Buffer.from(putBody.content, "base64").toString("utf-8"));
    assert.equal(committed.length, 1);
    assert.equal(committed[0].status, "approved");
    assert.equal(committed[0].id, "entry-1");
  } finally {
    globalThis.fetch = original;
  }
});

test("onRequestPostは存在しないidのステータス更新の場合404を返す", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL) => {
    const url = input.toString();
    if (url.includes("/contents/")) {
      return new Response(JSON.stringify({ content: utf8ToBase64("[]"), sha: "old-sha" }), { status: 200 });
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as typeof fetch;

  try {
    const request = await authedRequest("POST", { id: "missing-id", status: "approved" });
    const res = await onRequestPost({ request, env: ENV } as any);
    assert.equal(res.status, 404);
  } finally {
    globalThis.fetch = original;
  }
});

test("onRequestPostはGitHub API競合(409)の場合、409を返す", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = input.toString();
    if (init?.method === "PUT") {
      return new Response("conflict", { status: 409 });
    }
    if (url.includes("/contents/")) {
      return new Response(JSON.stringify({ content: utf8ToBase64("[]"), sha: "old-sha" }), { status: 200 });
    }
    throw new Error(`unexpected fetch to ${url}`);
  }) as typeof fetch;

  try {
    const request = await authedRequest("POST", {
      productName: "テスト商品",
      officialUrl: "https://example.com",
      a8NetHint: { type: "unknown" },
      status: "applying",
    });
    const res = await onRequestPost({ request, env: ENV } as any);
    assert.equal(res.status, 409);
  } finally {
    globalThis.fetch = original;
  }
});
