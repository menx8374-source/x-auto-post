import { test } from "node:test";
import assert from "node:assert/strict";
import { readTextWithLimit } from "../functions/_lib/fetchLimited";

function responseFromChunks(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
  return new Response(stream);
}

test("readTextWithLimitは上限以内のレスポンスをそのまま読み取る(truncated=false)", async () => {
  const res = responseFromChunks(["hello ", "world"]);
  const result = await readTextWithLimit(res, 1_000_000);
  assert.equal(result.text, "hello world");
  assert.equal(result.truncated, false);
});

test("readTextWithLimitは上限を超えるレスポンスを打ち切る(truncated=true)", async () => {
  const res = responseFromChunks(["a".repeat(10), "b".repeat(10)]);
  const result = await readTextWithLimit(res, 15);
  assert.equal(result.truncated, true);
  assert.ok(result.text.length <= 15);
  assert.equal(result.text, "a".repeat(10) + "b".repeat(5));
});

test("readTextWithLimitは空のレスポンスに対して空文字列・truncated=falseを返す", async () => {
  const res = responseFromChunks([]);
  const result = await readTextWithLimit(res, 1000);
  assert.equal(result.text, "");
  assert.equal(result.truncated, false);
});

test("readTextWithLimitはbody未指定(nullボディ)のレスポンスでも例外を投げず読み取る", async () => {
  const res = new Response("plain text body");
  const result = await readTextWithLimit(res, 1_000_000);
  assert.equal(result.text, "plain text body");
  assert.equal(result.truncated, false);
});
