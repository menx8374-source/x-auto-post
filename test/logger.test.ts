import { test } from "node:test";
import assert from "node:assert/strict";
import { log } from "../src/logger.js";

/** console.*を一時的に差し替えて呼び出し引数を記録し、必ず元に戻すヘルパー */
function captureConsole<T>(method: "log" | "warn" | "error", fn: () => T): { result: T; calls: unknown[][] } {
  const original = console[method];
  const calls: unknown[][] = [];
  console[method] = (...args: unknown[]) => {
    calls.push(args);
  };
  try {
    const result = fn();
    return { result, calls };
  } finally {
    console[method] = original;
  }
}

/** process.envの1キーを一時的に差し替え、必ず元に戻すヘルパー */
function withEnvVar<T>(key: string, value: string, fn: () => T): T {
  const original = process.env[key];
  process.env[key] = value;
  try {
    return fn();
  } finally {
    if (original === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = original;
    }
  }
}

test("F10: log.infoはメッセージ中の認証情報の実値をマスクする", () => {
  withEnvVar("ANTHROPIC_API_KEY", "sk-ant-super-secret-value-123", () => {
    const { calls } = captureConsole("log", () => {
      log.info("called API with key sk-ant-super-secret-value-123 embedded in message");
    });
    const serialized = JSON.stringify(calls);
    assert.doesNotMatch(serialized, /sk-ant-super-secret-value-123/);
    assert.match(serialized, /MASKED/);
  });
});

test("F10: log.infoはmeta(付加情報オブジェクト)に含まれる認証情報の実値もネストの深さに関わらずマスクする", () => {
  withEnvVar("X_API_SECRET", "x-secret-token-abcdef", () => {
    const { calls } = captureConsole("log", () => {
      log.info("posted tweet", {
        token: "x-secret-token-abcdef",
        nested: { detail: { apiSecret: "x-secret-token-abcdef" } },
        list: ["x-secret-token-abcdef", "harmless-value"],
      });
    });
    const serialized = JSON.stringify(calls);
    assert.doesNotMatch(serialized, /x-secret-token-abcdef/);
    assert.match(serialized, /harmless-value/, "無関係な値まで消してしまってはいけない");
  });
});

test("F10: log.error/log.warnも同様にマスクする", () => {
  withEnvVar("X_ACCESS_TOKEN", "access-token-value-999", () => {
    const errorCapture = captureConsole("error", () => {
      log.error("failed to post", { message: "reason: access-token-value-999" });
    });
    const warnCapture = captureConsole("warn", () => {
      log.warn("retrying", { token: "access-token-value-999" });
    });
    assert.doesNotMatch(JSON.stringify(errorCapture.calls), /access-token-value-999/);
    assert.doesNotMatch(JSON.stringify(warnCapture.calls), /access-token-value-999/);
  });
});

test("F10: 認証情報の環境変数が未設定の場合、マスク処理は何もせず通常通りログ出力される", () => {
  const { calls } = captureConsole("log", () => {
    log.info("normal message", { url: "https://example.com/article" });
  });
  const serialized = JSON.stringify(calls);
  assert.match(serialized, /example\.com\/article/);
});

test("回帰: 自己参照する配列を含むmetaをログ出力してもスタックオーバーフローでクラッシュしない", () => {
  const self: unknown[] = [];
  self.push(self);
  assert.doesNotThrow(() => {
    captureConsole("log", () => {
      log.info("array with self reference", { arr: self });
    });
  });
});

test("回帰: 自己参照するオブジェクトを含むmetaをログ出力してもスタックオーバーフローでクラッシュせず、循環部分は[circular]で打ち切られる", () => {
  const obj: Record<string, unknown> = { name: "node" };
  obj.self = obj;
  const { calls } = captureConsole("log", () => {
    log.info("object with self reference", { obj });
  });
  const serialized = JSON.stringify(calls);
  assert.match(serialized, /\[circular\]/);
});

test("回帰: 循環していない単純な重複参照(同じオブジェクトを2つの異なるキーで参照)は両方とも実際の値としてログに出力され、[circular]にはならない", () => {
  const shared = { url: "https://example.com/shared-article" };
  const { calls } = withEnvVar("X_API_SECRET", "dup-ref-secret-value", () =>
    captureConsole("log", () => {
      log.info("duplicate (non-circular) reference", {
        first: shared,
        second: shared,
        secret: "dup-ref-secret-value",
      });
    }),
  );
  const serialized = JSON.stringify(calls);
  assert.doesNotMatch(serialized, /\[circular\]/);
  const [, meta] = calls[0] as [string, { first: { url: string }; second: { url: string } }];
  assert.equal(meta.first.url, "https://example.com/shared-article");
  assert.equal(meta.second.url, "https://example.com/shared-article");
  assert.doesNotMatch(serialized, /dup-ref-secret-value/, "重複参照でもマスク処理自体は通常通り適用される");
});
