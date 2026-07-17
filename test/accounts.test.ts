import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  getAccountProfile,
  resolveCredentialEnvVarName,
  getGenerationStyleForAccount,
  DEFAULT_ACCOUNT_ID,
  type AccountProfile,
} from "../src/accounts.js";
import { DEFAULT_HISTORY_FILE, loadHistory, appendHistoryEntry } from "../src/postHistory.js";
import { createAnthropicClient } from "../src/generatePost.js";
import { createXClient } from "../src/xPublish.js";

/** process.envの複数キーを一時的に差し替え、必ず元に戻すヘルパー(非同期のfnも安全に待ち合わせる) */
async function withEnvVars<T>(vars: Record<string, string>, fn: () => T | Promise<T>): Promise<T> {
  const originals: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    originals[key] = process.env[key];
    process.env[key] = vars[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (originals[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originals[key];
      }
    }
  }
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), "accounts-test-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** テスト用の仮アカウントプロファイル(登録済みレジストリには追加しない、テストコード内でのみ使う) */
function buildTestAccount(overrides: Partial<AccountProfile> & { historyFilePath: string }): AccountProfile {
  return {
    id: "test-genre",
    label: "テストジャンル",
    genre: "テスト用の仮ジャンル",
    language: "ja",
    tone: "テスト用の仮トーン",
    sources: [],
    filterCandidates: (items) => items,
    credentialsEnvSuffix: "TESTGENRE",
    ...overrides,
  };
}

test("getAccountProfile()はaccountId省略時にデフォルトアカウント(ai-news)を返し、既存の履歴ファイル・サフィックス無しを使う(後方互換)", () => {
  const account = getAccountProfile();
  assert.equal(account.id, DEFAULT_ACCOUNT_ID);
  assert.equal(account.historyFilePath, DEFAULT_HISTORY_FILE);
  assert.equal(account.credentialsEnvSuffix, undefined);
});

test("getAccountProfile(\"ai-news\")を明示指定しても省略時と同じデフォルトアカウントが返る", () => {
  const implicit = getAccountProfile();
  const explicit = getAccountProfile("ai-news");
  assert.deepEqual(explicit, implicit);
});

test("getAccountProfile()は未登録のaccountIdに対して例外を投げる(壊れたアカウントで処理を進めない)", () => {
  assert.throws(() => getAccountProfile("unknown-account-id"), /未知のアカウントID/);
});

test("resolveCredentialEnvVarName: デフォルトアカウント(サフィックス無し)はベース名をそのまま返す", () => {
  const account = getAccountProfile();
  assert.equal(resolveCredentialEnvVarName("X_API_KEY", account), "X_API_KEY");
  assert.equal(resolveCredentialEnvVarName("ANTHROPIC_API_KEY", account), "ANTHROPIC_API_KEY");
});

test("resolveCredentialEnvVarName: credentialsEnvSuffix指定時は`<ベース名>__<サフィックス>`を返す", async () => {
  await withTempDir(async (dir) => {
    const testAccount = buildTestAccount({ historyFilePath: path.join(dir, "post-history-test-genre.json") });
    assert.equal(resolveCredentialEnvVarName("X_API_KEY", testAccount), "X_API_KEY__TESTGENRE");
    assert.equal(resolveCredentialEnvVarName("ANTHROPIC_API_KEY", testAccount), "ANTHROPIC_API_KEY__TESTGENRE");
  });
});

test("getGenerationStyleForAccount: デフォルトアカウントのみPOST_LANGUAGE/POST_TONE環境変数で上書きされる", async () => {
  await withEnvVars({ POST_LANGUAGE: "en", POST_TONE: "casual test tone" }, async () => {
    const defaultAccount = getAccountProfile();
    const style = getGenerationStyleForAccount(defaultAccount);
    assert.equal(style.language, "en");
    assert.equal(style.tone, "casual test tone");
  });
});

test("getGenerationStyleForAccount: デフォルト以外のアカウントはPOST_LANGUAGE/POST_TONEの影響を受けず、プロファイルの固定値を使う", async () => {
  await withTempDir(async (dir) => {
    await withEnvVars({ POST_LANGUAGE: "en", POST_TONE: "should not be used" }, async () => {
      const testAccount = buildTestAccount({ historyFilePath: path.join(dir, "post-history-test-genre.json") });
      const style = getGenerationStyleForAccount(testAccount);
      assert.equal(style.language, "ja");
      assert.equal(style.tone, "テスト用の仮トーン");
    });
  });
});

test("複数アカウント基盤: 仮登録した新規アカウントの認証情報環境変数(サフィックス付き)がデフォルトアカウントと分離される", async () => {
  await withTempDir(async (dir) => {
    const testAccount = buildTestAccount({ historyFilePath: path.join(dir, "post-history-test-genre.json") });

    await withEnvVars(
      {
        ANTHROPIC_API_KEY: "default-account-anthropic-key",
        X_API_KEY: "default-account-x-key",
        X_API_SECRET: "default-account-x-secret",
        X_ACCESS_TOKEN: "default-account-x-token",
        X_ACCESS_SECRET: "default-account-x-access-secret",
        ANTHROPIC_API_KEY__TESTGENRE: "test-genre-anthropic-key",
        X_API_KEY__TESTGENRE: "test-genre-x-key",
        X_API_SECRET__TESTGENRE: "test-genre-x-secret",
        X_ACCESS_TOKEN__TESTGENRE: "test-genre-x-token",
        X_ACCESS_SECRET__TESTGENRE: "test-genre-x-access-secret",
      },
      async () => {
        // デフォルトアカウントは引き続きサフィックス無しの変数を使う(後方互換)
        assert.ok(createAnthropicClient(getAccountProfile()));
        assert.ok(createXClient(getAccountProfile()));

        // 仮登録したアカウントはサフィックス付きの変数が揃っていればクライアントを構築できる
        assert.ok(createAnthropicClient(testAccount));
        assert.ok(createXClient(testAccount));
      }
    );

    // サフィックス付きの変数だけを外すと、仮登録アカウントのクライアントは構築できなくなる
    // (デフォルトアカウントのX_API_KEY等が誤って使われないことの確認)
    await withEnvVars(
      {
        ANTHROPIC_API_KEY: "default-account-anthropic-key",
        X_API_KEY: "default-account-x-key",
        X_API_SECRET: "default-account-x-secret",
        X_ACCESS_TOKEN: "default-account-x-token",
        X_ACCESS_SECRET: "default-account-x-access-secret",
      },
      async () => {
        assert.equal(createAnthropicClient(testAccount), null);
        assert.equal(createXClient(testAccount), null);
      }
    );
  });
});

test("複数アカウント基盤: 仮登録した新規アカウントの投稿履歴ファイルがデフォルトアカウントの履歴ファイルと分離される", async () => {
  await withTempDir(async (dir) => {
    const testAccount = buildTestAccount({ historyFilePath: path.join(dir, "post-history-test-genre.json") });
    const defaultHistoryFilePathInTempDir = path.join(dir, "post-history.json");

    await appendHistoryEntry(
      { url: "https://example.com/default-account-article", title: "デフォルトアカウント記事", selectedAt: "2026-07-16T00:00:00.000Z" },
      defaultHistoryFilePathInTempDir
    );
    await appendHistoryEntry(
      { url: "https://example.com/test-genre-article", title: "仮登録アカウント記事", selectedAt: "2026-07-16T00:00:00.000Z" },
      testAccount.historyFilePath
    );

    const defaultHistory = await loadHistory(defaultHistoryFilePathInTempDir);
    const testGenreHistory = await loadHistory(testAccount.historyFilePath);

    assert.equal(defaultHistory.length, 1);
    assert.equal(defaultHistory[0].title, "デフォルトアカウント記事");
    assert.equal(testGenreHistory.length, 1);
    assert.equal(testGenreHistory[0].title, "仮登録アカウント記事");
  });
});
