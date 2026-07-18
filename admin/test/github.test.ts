import { test } from "node:test";
import assert from "node:assert/strict";
import { getFileContent, putFileContent, dispatchWorkflow, GitHubApiError } from "../functions/_lib/github";
import type { Env } from "../functions/_lib/types";

const ENV: Env = {
  GITHUB_PAT: "test-pat-value",
  GITHUB_REPO: "menx8374-source/x-auto-post",
  GITHUB_BRANCH: "main",
  GITHUB_OAUTH_CLIENT_ID: "client-id",
  GITHUB_OAUTH_CLIENT_SECRET: "client-secret",
  ALLOWED_GITHUB_LOGIN: "menx8374-source",
  SESSION_SECRET: "session-secret",
};

function utf8ToBase64(text: string): string {
  return Buffer.from(text, "utf-8").toString("base64");
}

test("getFileContentは正しいURL・Authorizationヘッダでリクエストし、base64デコードした内容とshaを返す", async () => {
  let capturedUrl = "";
  let capturedHeaders: Record<string, string> = {};
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    capturedUrl = input.toString();
    capturedHeaders = (init?.headers as Record<string, string>) || {};
    return new Response(JSON.stringify({ content: utf8ToBase64("[]"), sha: "abc123" }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await getFileContent(ENV, "data/affiliate-products.json");
    assert.equal(result?.content, "[]");
    assert.equal(result?.sha, "abc123");
    assert.match(capturedUrl, /\/repos\/menx8374-source\/x-auto-post\/contents\/data\/affiliate-products\.json\?ref=main$/);
    assert.equal(capturedHeaders.Authorization, "Bearer test-pat-value");
  } finally {
    globalThis.fetch = original;
  }
});

test("getFileContentは404の場合nullを返す(ファイル未作成)", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
  try {
    const result = await getFileContent(ENV, "data/affiliate-products.json");
    assert.equal(result, null);
  } finally {
    globalThis.fetch = original;
  }
});

test("getFileContentは404以外のエラー応答で例外を投げる", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("server error", { status: 500 })) as typeof fetch;
  try {
    await assert.rejects(() => getFileContent(ENV, "data/affiliate-products.json"));
  } finally {
    globalThis.fetch = original;
  }
});

test("putFileContentはPUTで正しいbody(content/branch/sha)を送信し、新しいshaを返す", async () => {
  let capturedBody: any = null;
  let capturedMethod = "";
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    capturedMethod = init?.method || "";
    capturedBody = JSON.parse((init?.body as string) || "{}");
    return new Response(JSON.stringify({ content: { sha: "new-sha" } }), { status: 200 });
  }) as typeof fetch;

  try {
    const result = await putFileContent(ENV, "data/affiliate-products.json", "[]", "old-sha", "chore: update");
    assert.equal(capturedMethod, "PUT");
    assert.equal(capturedBody.sha, "old-sha");
    assert.equal(capturedBody.branch, "main");
    assert.equal(capturedBody.message, "chore: update");
    assert.equal(Buffer.from(capturedBody.content, "base64").toString("utf-8"), "[]");
    assert.equal(result.sha, "new-sha");
  } finally {
    globalThis.fetch = original;
  }
});

test("putFileContentはsha未指定(新規作成)の場合、bodyにshaキーを含めない", async () => {
  let capturedBody: any = null;
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: string | URL, init?: RequestInit) => {
    capturedBody = JSON.parse((init?.body as string) || "{}");
    return new Response(JSON.stringify({ content: { sha: "new-sha" } }), { status: 200 });
  }) as typeof fetch;

  try {
    await putFileContent(ENV, "data/affiliate-products.json", "[]", undefined, "chore: create");
    assert.equal("sha" in capturedBody, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("putFileContentはエラー応答(sha不一致等)で例外を投げる(呼び出し側が上書きしないよう防ぐ)", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("conflict", { status: 409 })) as typeof fetch;
  try {
    await assert.rejects(() =>
      putFileContent(ENV, "data/affiliate-products.json", "[]", "stale-sha", "chore: update")
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("putFileContentが投げる例外はGitHubApiErrorで、実際のGitHub APIステータス(409)を保持する", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("conflict", { status: 409 })) as typeof fetch;
  try {
    await assert.rejects(
      () => putFileContent(ENV, "data/affiliate-products.json", "[]", "stale-sha", "chore: update"),
      (err: unknown) => {
        assert.ok(err instanceof GitHubApiError);
        assert.equal(err.status, 409);
        return true;
      }
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("putFileContentが投げる例外は認証切れ(401)やレート制限(403)等、409以外のステータスも正しく保持する(呼び出し側が真の競合と区別できるようにするため)", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("bad credentials", { status: 401 })) as typeof fetch;
  try {
    await assert.rejects(
      () => putFileContent(ENV, "data/affiliate-products.json", "[]", "stale-sha", "chore: update"),
      (err: unknown) => {
        assert.ok(err instanceof GitHubApiError);
        assert.equal(err.status, 401);
        assert.notEqual(err.status, 409);
        return true;
      }
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("dispatchWorkflowは正しいworkflow_dispatchエンドポイントへPOSTする", async () => {
  let capturedUrl = "";
  let capturedMethod = "";
  let capturedBody: any = null;
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL, init?: RequestInit) => {
    capturedUrl = input.toString();
    capturedMethod = init?.method || "";
    capturedBody = JSON.parse((init?.body as string) || "{}");
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    await dispatchWorkflow(ENV, "regenerate-redirects.yml");
    assert.match(
      capturedUrl,
      /\/repos\/menx8374-source\/x-auto-post\/actions\/workflows\/regenerate-redirects\.yml\/dispatches$/
    );
    assert.equal(capturedMethod, "POST");
    assert.equal(capturedBody.ref, "main");
  } finally {
    globalThis.fetch = original;
  }
});

test("dispatchWorkflowはエラー応答の場合例外を投げる(呼び出し側でベストエフォート処理する想定)", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("forbidden", { status: 403 })) as typeof fetch;
  try {
    await assert.rejects(() => dispatchWorkflow(ENV, "regenerate-redirects.yml"));
  } finally {
    globalThis.fetch = original;
  }
});
