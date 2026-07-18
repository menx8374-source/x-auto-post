/**
 * GET  /api/products : 認証必須。data/affiliate-products.json の内容をGitHub Contents API
 *                       経由で取得して返す。
 * POST /api/products : 認証必須。1商品の追加/更新。バリデーション後、GitHub Contents APIで
 *                       現在のshaを取得してから更新後の配列をコミットする。コミット成功後、
 *                       regenerate-redirects.yml をworkflow_dispatchで起動する。この起動自体が
 *                       失敗しても商品データのコミットは既に成功しているためレスポンスは200を返すが、
 *                       `redirectsRegenerated: false` を含めてクライアント側に「リダイレクトページが
 *                       未更新の可能性がある」ことを伝える(呼び出し側で警告表示・手動再実行を促す)。
 */
import type { Env, AffiliateProduct } from "../_lib/types";
import { getSessionFromRequest } from "../_lib/session";
import { validateProductInput, toAffiliateProduct } from "../_lib/validate";
import { getFileContent, putFileContent, dispatchWorkflow, GitHubApiError } from "../_lib/github";

const PRODUCTS_PATH = "data/affiliate-products.json";
const REDIRECTS_WORKFLOW_FILE = "regenerate-redirects.yml";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function parseProducts(file: { content: string } | null): AffiliateProduct[] {
  if (!file) return [];
  const parsed: unknown = JSON.parse(file.content);
  if (!Array.isArray(parsed)) {
    throw new Error(`${PRODUCTS_PATH} はJSON配列である必要があります`);
  }
  return parsed as AffiliateProduct[];
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSessionFromRequest(request, env);
  if (!session) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  try {
    const file = await getFileContent(env, PRODUCTS_PATH);
    return jsonResponse({ products: parseProducts(file) });
  } catch (err) {
    return jsonResponse({ error: `商品データの取得に失敗しました: ${errorMessage(err)}` }, 502);
  }
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const session = await getSessionFromRequest(request, env);
  if (!session) {
    return jsonResponse({ error: "unauthorized" }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "リクエストボディがJSONとして解釈できません" }, 400);
  }

  const validation = validateProductInput(body);
  if (!validation.valid) {
    return jsonResponse({ error: "バリデーションエラー", details: validation.errors }, 400);
  }
  const product = toAffiliateProduct(body as Record<string, unknown>);

  let file;
  let currentProducts: AffiliateProduct[];
  try {
    file = await getFileContent(env, PRODUCTS_PATH);
    currentProducts = parseProducts(file);
  } catch (err) {
    return jsonResponse({ error: `商品データの取得に失敗しました: ${errorMessage(err)}` }, 502);
  }

  const index = currentProducts.findIndex((p) => p.id === product.id);
  const updatedProducts = [...currentProducts];
  const isUpdate = index >= 0;
  if (isUpdate) {
    updatedProducts[index] = product;
  } else {
    updatedProducts.push(product);
  }

  try {
    // 直前に取得した最新のsha(file?.sha、ファイル未作成ならundefined)を必ず渡すことで、
    // 他プロセスがこの間に更新していた場合はGitHub API側が409を返し上書きを防ぐ。
    await putFileContent(
      env,
      PRODUCTS_PATH,
      `${JSON.stringify(updatedProducts, null, 2)}\n`,
      file?.sha,
      `chore(admin): ${isUpdate ? "update" : "add"} affiliate product ${product.id}`
    );
  } catch (err) {
    // GitHub APIの実際のステータスコードで、真の競合(409、shaの不一致=他プロセスとの同時更新)と
    // それ以外(401=認証切れ、403=権限不足、429=レート制限等)を区別する。すべてを一律「競合」として
    // 扱うと、PAT失効等の運用上の問題が「編集がぶつかった」という誤った原因としてユーザーに伝わってしまう。
    if (err instanceof GitHubApiError && err.status === 409) {
      return jsonResponse(
        {
          error:
            "商品データの更新に失敗しました(他の変更と競合しました。ページを再読み込みしてもう一度お試しください)",
        },
        409
      );
    }
    return jsonResponse({ error: `商品データの更新に失敗しました: ${errorMessage(err)}` }, 502);
  }

  // リダイレクトページ再生成ワークフローの起動はベストエフォート。コミット自体は既に成功しているため
  // ここが失敗してもレスポンス自体は200を返すが、`redirectsRegenerated: false` をクライアントへ返し、
  // 「docs/go/配下のリダイレクトページが未更新のまま商品が有効化されている可能性がある」ことを伝える
  // (呼び出し側がこれを握りつぶすと、次回のpost-affiliate.ymlで壊れたリンクが投稿されるリスクがある)。
  let redirectsRegenerated = true;
  let redirectsError: string | undefined;
  try {
    await dispatchWorkflow(env, REDIRECTS_WORKFLOW_FILE);
  } catch (err) {
    redirectsRegenerated = false;
    redirectsError = errorMessage(err);
    console.error("failed to dispatch regenerate-redirects workflow", redirectsError);
  }

  return jsonResponse({
    ok: true,
    product,
    redirectsRegenerated,
    ...(redirectsError ? { redirectsError } : {}),
  });
};
