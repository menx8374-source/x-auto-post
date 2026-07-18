/**
 * GitHub REST API呼び出しの共通ヘルパー。認証はすべて`env.GITHUB_PAT`(Bearerトークン)を使う。
 * PATの実値はこのファイル内でしかヘッダに載せず、レスポンスとして呼び出し元へ返さないこと。
 */
import type { Env } from "./types";

const GITHUB_API_BASE = "https://api.github.com";

function authHeaders(env: Pick<Env, "GITHUB_PAT">): Record<string, string> {
  return {
    Authorization: `Bearer ${env.GITHUB_PAT}`,
    "User-Agent": "x-auto-post-admin",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export interface GitHubFileContent {
  /** UTF-8デコード済みのファイル内容 */
  content: string;
  /** 更新時に必要な現在のblob sha */
  sha: string;
}

/**
 * GitHub REST APIがエラー応答を返した際に投げる例外。実際のHTTPステータスコードを保持することで、
 * 呼び出し側が真の競合(409、shaの不一致等)とそれ以外(401=認証切れ、403=権限不足、429=レート制限等)を
 * 区別できるようにする(単純にすべてを「競合」として扱わない)。
 */
export class GitHubApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
  }
}

async function safeErrorText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function base64EncodeUtf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64DecodeUtf8(base64: string): string {
  // GitHub Contents APIは60文字ごとに改行を挟んだbase64を返すため取り除く
  const cleaned = base64.replace(/\n/g, "");
  const binary = atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * GitHub Contents APIからファイル内容とshaを取得する。
 * ファイルが存在しない(404)場合は例外を投げず`null`を返す(未作成のファイルを
 * 「空」として扱えるようにするため)。それ以外のエラー(認証失敗・リポジトリ不正等)は例外を投げる。
 */
export async function getFileContent(env: Env, path: string): Promise<GitHubFileContent | null> {
  const url = `${GITHUB_API_BASE}/repos/${env.GITHUB_REPO}/contents/${path}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`;
  const res = await fetch(url, { headers: authHeaders(env) });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new GitHubApiError(`GitHub API error fetching ${path}: ${res.status} ${await safeErrorText(res)}`, res.status);
  }
  const data = (await res.json()) as { content: string; sha: string };
  return { content: base64DecodeUtf8(data.content), sha: data.sha };
}

/**
 * GitHub Contents APIでファイルを作成/更新する。
 * 既存ファイルを更新する場合は直前に`getFileContent`で取得した最新のshaを必ず渡すこと
 * (省略した場合は新規作成扱いになり、既存ファイルが存在するとGitHub API側が409を返す)。
 * shaの不一致(他プロセスによる同時更新)を含め、失敗時は例外を投げる(呼び出し側が
 * 「他プロセスの変更を上書きしない」判断をできるようにするため、ここではリトライしない)。
 */
export async function putFileContent(
  env: Env,
  path: string,
  content: string,
  sha: string | undefined,
  message: string
): Promise<{ sha: string }> {
  const url = `${GITHUB_API_BASE}/repos/${env.GITHUB_REPO}/contents/${path}`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { ...authHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: base64EncodeUtf8(content),
      branch: env.GITHUB_BRANCH,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) {
    throw new GitHubApiError(`GitHub API error updating ${path}: ${res.status} ${await safeErrorText(res)}`, res.status);
  }
  const data = (await res.json()) as { content: { sha: string } };
  return { sha: data.content.sha };
}

/**
 * workflow_dispatchでワークフローを起動する(`env.GITHUB_BRANCH`をrefとして渡す)。
 * 失敗時は例外を投げる。呼び出し側(`/api/products` POSTハンドラ)はこれをベストエフォート
 * 扱いとし、失敗してもレスポンス自体は成功扱いにしてよいがログには残すこと。
 */
export async function dispatchWorkflow(env: Env, workflowFileName: string): Promise<void> {
  const url = `${GITHUB_API_BASE}/repos/${env.GITHUB_REPO}/actions/workflows/${workflowFileName}/dispatches`;
  const res = await fetch(url, {
    method: "POST",
    headers: { ...authHeaders(env), "Content-Type": "application/json" },
    body: JSON.stringify({ ref: env.GITHUB_BRANCH }),
  });
  if (!res.ok) {
    throw new GitHubApiError(
      `GitHub API error dispatching workflow ${workflowFileName}: ${res.status} ${await safeErrorText(res)}`,
      res.status
    );
  }
}
