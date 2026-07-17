import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getPostSlots,
  getGenerationStyle,
  getMaxBodyTweets,
  getLinkTweetConfig,
  getRecoveryWindowHours,
  getCredentialsStatus,
  assertValidConfig,
  ConfigError,
  DEFAULT_TONE,
} from "../src/config.js";

test("F12: 環境変数が未設定なら既定値(投稿時刻07:30/12:15/21:00等)を返す", () => {
  const env = {} as NodeJS.ProcessEnv;
  assert.deepEqual(
    getPostSlots(env).map((s) => ({ id: s.id, label: s.label, hourJst: s.hourJst, minuteJst: s.minuteJst })),
    [
      { id: "morning", label: "朝", hourJst: 7, minuteJst: 30 },
      { id: "noon", label: "昼", hourJst: 12, minuteJst: 15 },
      { id: "evening", label: "夜", hourJst: 21, minuteJst: 0 },
    ]
  );
  assert.equal(getGenerationStyle(env).language, "ja");
  assert.equal(getMaxBodyTweets(env), 6);
  assert.deepEqual(getLinkTweetConfig(env), { enabled: true, position: "end" });
  assert.equal(getRecoveryWindowHours(env), 3);
});

test("F12: 有効な環境変数を指定すると値が反映される(1箇所の設定変更が処理に反映される)", () => {
  const env = {
    POST_SLOT_MORNING_TIME: "08:00",
    POST_LANGUAGE: "en",
    POST_TONE: "casual and friendly",
    POST_MAX_BODY_TWEETS: "3",
    POST_LINK_TWEET_ENABLED: "false",
    POST_LINK_TWEET_POSITION: "start",
    POST_RECOVERY_WINDOW_HOURS: "5",
  } as NodeJS.ProcessEnv;

  assert.equal(getPostSlots(env).find((s) => s.id === "morning")?.hourJst, 8);
  assert.deepEqual(getGenerationStyle(env), { language: "en", tone: "casual and friendly" });
  assert.equal(getMaxBodyTweets(env), 3);
  assert.deepEqual(getLinkTweetConfig(env), { enabled: false, position: "start" });
  assert.equal(getRecoveryWindowHours(env), 5);
});

test("F12: 不正な時刻形式(POST_SLOT_MORNING_TIME)は既定値にフォールバックする(getter単体呼び出し時)", () => {
  const env = { POST_SLOT_MORNING_TIME: "25:99" } as NodeJS.ProcessEnv;
  assert.equal(getPostSlots(env).find((s) => s.id === "morning")?.hourJst, 7);
});

test("F12: getCredentialsStatusは実値を返さず真偽値のみを返す", () => {
  const env = {
    ANTHROPIC_API_KEY: "sk-ant-secret",
    X_API_KEY: "key",
    X_API_SECRET: "secret",
    X_ACCESS_TOKEN: "token",
    X_ACCESS_SECRET: "accesssecret",
  } as NodeJS.ProcessEnv;
  const status = getCredentialsStatus(env);
  assert.deepEqual(status, {
    anthropicApiKeyConfigured: true,
    xCredentialsConfigured: true,
    xCredentialsPartiallyConfigured: false,
  });
  // 実値がstatusオブジェクトのどのプロパティにも含まれていないこと
  assert.doesNotMatch(JSON.stringify(status), /sk-ant-secret|accesssecret/);
});

test("F12: assertValidConfigは全項目が有効なら何も投げない", () => {
  const env = {} as NodeJS.ProcessEnv;
  assert.doesNotThrow(() => assertValidConfig(env));
});

test("F12: assertValidConfigは不正な時刻形式を検知してConfigErrorを投げる", () => {
  const env = { POST_SLOT_MORNING_TIME: "25:99" } as NodeJS.ProcessEnv;
  assert.throws(() => assertValidConfig(env), ConfigError);
  try {
    assertValidConfig(env);
    assert.fail("ConfigErrorが投げられるべき");
  } catch (err) {
    assert.ok(err instanceof ConfigError);
    assert.match(err.errors.join("\n"), /POST_SLOT_MORNING_TIME/);
  }
});

test("F12: assertValidConfigは不正なPOST_MAX_BODY_TWEETS(0以下・非整数)を検知する", () => {
  assert.throws(() => assertValidConfig({ POST_MAX_BODY_TWEETS: "0" } as NodeJS.ProcessEnv), ConfigError);
  assert.throws(() => assertValidConfig({ POST_MAX_BODY_TWEETS: "abc" } as NodeJS.ProcessEnv), ConfigError);
  assert.throws(() => assertValidConfig({ POST_MAX_BODY_TWEETS: "2.5" } as NodeJS.ProcessEnv), ConfigError);
});

test("F12: assertValidConfigは不正なPOST_LINK_TWEET_ENABLED/POST_LINK_TWEET_POSITIONを検知する", () => {
  assert.throws(() => assertValidConfig({ POST_LINK_TWEET_ENABLED: "yes" } as NodeJS.ProcessEnv), ConfigError);
  assert.throws(() => assertValidConfig({ POST_LINK_TWEET_POSITION: "middle" } as NodeJS.ProcessEnv), ConfigError);
});

test("F12: assertValidConfigは負の値のPOST_RECOVERY_WINDOW_HOURSを検知する", () => {
  assert.throws(() => assertValidConfig({ POST_RECOVERY_WINDOW_HOURS: "-1" } as NodeJS.ProcessEnv), ConfigError);
});

test("F12: 空文字列(または空白のみ)のPOST_LANGUAGE/POST_TONEは未設定同様デフォルト値にフォールバックする(GitHub Actionsでrepository variable未設定時に空文字列が渡るケース)", () => {
  assert.doesNotThrow(() => assertValidConfig({ POST_LANGUAGE: "   " } as NodeJS.ProcessEnv));
  assert.doesNotThrow(() => assertValidConfig({ POST_TONE: "" } as NodeJS.ProcessEnv));
  assert.equal(getGenerationStyle({ POST_LANGUAGE: "   " } as NodeJS.ProcessEnv).language, "ja");
  assert.equal(getGenerationStyle({ POST_TONE: "" } as NodeJS.ProcessEnv).tone, DEFAULT_TONE);
});

test("F12: assertValidConfigはX API認証情報が1〜3個だけ設定されている(設定ミス)場合を検知する", () => {
  const env = { X_API_KEY: "key-only" } as NodeJS.ProcessEnv;
  assert.throws(() => assertValidConfig(env), ConfigError);
  try {
    assertValidConfig(env);
  } catch (err) {
    assert.ok(err instanceof ConfigError);
    assert.match(err.errors.join("\n"), /X API認証情報が一部だけ/);
  }
});

test("F12: assertValidConfigはX API認証情報が4つとも未設定、または4つとも設定済みならエラーにしない", () => {
  assert.doesNotThrow(() => assertValidConfig({} as NodeJS.ProcessEnv));
  assert.doesNotThrow(() =>
    assertValidConfig({
      X_API_KEY: "a",
      X_API_SECRET: "b",
      X_ACCESS_TOKEN: "c",
      X_ACCESS_SECRET: "d",
    } as NodeJS.ProcessEnv)
  );
});

test("F12: assertValidConfigは複数の不正値を一度にまとめて検知する", () => {
  const env = {
    POST_SLOT_MORNING_TIME: "bad",
    POST_MAX_BODY_TWEETS: "0",
    POST_LINK_TWEET_POSITION: "middle",
  } as NodeJS.ProcessEnv;
  try {
    assertValidConfig(env);
    assert.fail("ConfigErrorが投げられるべき");
  } catch (err) {
    assert.ok(err instanceof ConfigError);
    assert.equal(err.errors.length, 3);
  }
});
