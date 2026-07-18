import { test } from "node:test";
import assert from "node:assert/strict";
import { isBlockedHostname, isSafeExternalUrl } from "../functions/_lib/ssrf";

test("isBlockedHostnameはlocalhost系のホスト名をブロックする", () => {
  assert.equal(isBlockedHostname("localhost"), true);
  assert.equal(isBlockedHostname("LOCALHOST"), true);
  assert.equal(isBlockedHostname("127.0.0.1"), true);
  assert.equal(isBlockedHostname("127.1.2.3"), true);
  assert.equal(isBlockedHostname("0.0.0.0"), true);
  assert.equal(isBlockedHostname("169.254.169.254"), true);
  assert.equal(isBlockedHostname("::1"), true);
  assert.equal(isBlockedHostname("[::1]"), true);
});

test("isBlockedHostnameは通常の外部ホスト名をブロックしない", () => {
  assert.equal(isBlockedHostname("example.com"), false);
  assert.equal(isBlockedHostname("www.a8.net"), false);
  assert.equal(isBlockedHostname("sub.example.co.jp"), false);
});

test("isBlockedHostnameは空/不正な入力を安全側(true)に倒す", () => {
  assert.equal(isBlockedHostname(""), true);
  assert.equal(isBlockedHostname(undefined as unknown as string), true);
});

test("isSafeExternalUrlはhttp/https以外のスキームを拒否する", () => {
  assert.equal(isSafeExternalUrl("javascript:alert(1)"), false);
  assert.equal(isSafeExternalUrl("file:///etc/passwd"), false);
});

test("isSafeExternalUrlはローカル/内部向けホストを拒否する", () => {
  assert.equal(isSafeExternalUrl("http://localhost/"), false);
  assert.equal(isSafeExternalUrl("http://127.0.0.1:8080/"), false);
  assert.equal(isSafeExternalUrl("http://169.254.169.254/latest/meta-data/"), false);
  assert.equal(isSafeExternalUrl("http://[::1]/"), false);
});

test("isSafeExternalUrlは通常の外部URLを許可する", () => {
  assert.equal(isSafeExternalUrl("https://example.com/product"), true);
  assert.equal(isSafeExternalUrl("http://example.com/"), true);
});

test("isSafeExternalUrlはパースできない文字列に対してfalseを返す(例外を投げない)", () => {
  assert.equal(isSafeExternalUrl("not a url"), false);
  assert.equal(isSafeExternalUrl(""), false);
});
