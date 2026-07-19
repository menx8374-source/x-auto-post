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

const SAMPLE_PROGRAM_URL =
  "https://media-console.a8.net/program/detail-not-partnered?programId=s00000024524003&fromSearch=true";

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
    body: JSON.stringify({ programName: "テストプログラム", a8ProgramUrl: SAMPLE_PROGRAM_URL }),
  });
  const res = await onRequestPost({ request, env: ENV } as any);
  assert.equal(res.status, 401);
});

test("onRequestGetはGitHub Contents APIからentriesを取得して返す", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ content: utf8ToBase64(JSON.stringify([{ id: "a", programName: "P" }])), sha: "sha1" }), {
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

test("onRequestPostはprogramName未指定・既知programId不一致(新規作成)でもnullとして保存し成功する", async () => {
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
    const request = await authedRequest("POST", { a8ProgramUrl: SAMPLE_PROGRAM_URL });
    const res = await onRequestPost({ request, env: ENV } as any);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { ok?: boolean; entry?: { programName?: string | null } };
    assert.equal(data.ok, true);
    assert.equal(data.entry?.programName, null);

    const committed = JSON.parse(Buffer.from(putBody.content, "base64").toString("utf-8"));
    assert.equal(committed[0].programName, null);
  } finally {
    globalThis.fetch = original;
  }
});

test("onRequestPostはprogramNameが空文字列/空白のみ(新規作成)の場合400を返す", async () => {
  const request = await authedRequest("POST", { programName: "   ", a8ProgramUrl: SAMPLE_PROGRAM_URL });
  const res = await onRequestPost({ request, env: ENV } as any);
  assert.equal(res.status, 400);
});

test("onRequestPostはa8ProgramUrlが未指定の場合400を返す", async () => {
  const request = await authedRequest("POST", { programName: "テストプログラム" });
  const res = await onRequestPost({ request, env: ENV } as any);
  assert.equal(res.status, 400);
});

test("onRequestPostはa8ProgramUrlがa8.net以外のドメインの場合400を返す", async () => {
  const request = await authedRequest("POST", {
    programName: "テストプログラム",
    a8ProgramUrl: "https://example.com/program/detail?programId=s1",
  });
  const res = await onRequestPost({ request, env: ENV } as any);
  assert.equal(res.status, 400);
});

test("onRequestPostはstatusが不正な値(更新)の場合400を返す", async () => {
  const request = await authedRequest("POST", { id: "entry-1", status: "rejected" });
  const res = await onRequestPost({ request, env: ENV } as any);
  assert.equal(res.status, 400);
});

test("onRequestPostは新規作成: idをサーバー側で発行し、a8ProgramIdを抽出して既存配列に追記しGitHubへコミットする", async () => {
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
      programName: "SuperAI Tool",
      a8ProgramUrl: SAMPLE_PROGRAM_URL,
    });
    const res = await onRequestPost({ request, env: ENV } as any);
    assert.equal(res.status, 200);
    const data = (await res.json()) as {
      ok?: boolean;
      entry?: { id?: string; status?: string; a8ProgramId?: string | null; a8ProgramUrl?: string | null };
    };
    assert.equal(data.ok, true);
    assert.ok(data.entry?.id);
    assert.equal(data.entry?.status, "applying");
    assert.equal(data.entry?.a8ProgramId, "s00000024524003");
    assert.equal(data.entry?.a8ProgramUrl, SAMPLE_PROGRAM_URL);

    const committed = JSON.parse(Buffer.from(putBody.content, "base64").toString("utf-8"));
    assert.equal(committed.length, 1);
    assert.equal(committed[0].programName, "SuperAI Tool");
    assert.equal(committed[0].a8ProgramId, "s00000024524003");
    assert.equal(putBody.sha, "old-sha");
  } finally {
    globalThis.fetch = original;
  }
});

test("onRequestPostは新規作成: a8ProgramUrlにprogramIdが含まれない場合、a8ProgramIdをnullとして保存する", async () => {
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
      programName: "楽天市場",
      a8ProgramUrl: "https://www.a8.net/",
    });
    const res = await onRequestPost({ request, env: ENV } as any);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { ok?: boolean; entry?: { a8ProgramId?: string | null } };
    assert.equal(data.ok, true);
    assert.equal(data.entry?.a8ProgramId, null);

    const committed = JSON.parse(Buffer.from(putBody.content, "base64").toString("utf-8"));
    assert.equal(committed[0].a8ProgramId, null);
  } finally {
    globalThis.fetch = original;
  }
});

test("onRequestPostは新規作成: programName未指定でも既知の主要ブランドprogramIdと一致すればプログラム名を自動補完する", async () => {
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
      a8ProgramUrl: "https://media-console.a8.net/program/detail-not-partnered?programId=s00000011623",
    });
    const res = await onRequestPost({ request, env: ENV } as any);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { ok?: boolean; entry?: { programName?: string | null } };
    assert.equal(data.ok, true);
    assert.equal(data.entry?.programName, "楽天市場");

    const committed = JSON.parse(Buffer.from(putBody.content, "base64").toString("utf-8"));
    assert.equal(committed[0].programName, "楽天市場");
  } finally {
    globalThis.fetch = original;
  }
});

test("onRequestPostは新規作成: programNameが明示的に指定されていれば既知プログラム名で上書きしない", async () => {
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
      programName: "楽天市場(カスタム表記)",
      a8ProgramUrl: "https://media-console.a8.net/program/detail-not-partnered?programId=s00000011623",
    });
    const res = await onRequestPost({ request, env: ENV } as any);
    assert.equal(res.status, 200);
    const data = (await res.json()) as { entry?: { programName?: string | null } };
    assert.equal(data.entry?.programName, "楽天市場(カスタム表記)");

    const committed = JSON.parse(Buffer.from(putBody.content, "base64").toString("utf-8"));
    assert.equal(committed[0].programName, "楽天市場(カスタム表記)");
  } finally {
    globalThis.fetch = original;
  }
});

test("onRequestPostは既存エントリのステータス更新({id, status})を正しく反映する", async () => {
  const original = globalThis.fetch;
  let putBody: any = null;
  const existing = [
    {
      id: "entry-1",
      programName: "SuperAI Tool",
      a8ProgramId: "s00000024524003",
      a8ProgramUrl: SAMPLE_PROGRAM_URL,
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
      programName: "テストプログラム",
      a8ProgramUrl: SAMPLE_PROGRAM_URL,
    });
    const res = await onRequestPost({ request, env: ENV } as any);
    assert.equal(res.status, 409);
  } finally {
    globalThis.fetch = original;
  }
});
