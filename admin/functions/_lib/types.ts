/**
 * Cloudflare Pages Functionsのバインディング/環境変数の型定義。
 * 実値はCloudflareダッシュボード(本番)・`.dev.vars`(ローカル開発)側で設定する。
 */
export interface Env {
  /** GitHub PAT(Contents読み書き・Actions workflow_dispatch起動権限が必要) */
  GITHUB_PAT: string;
  /** 対象リポジトリ("owner/repo"形式) */
  GITHUB_REPO: string;
  /** 対象ブランチ */
  GITHUB_BRANCH: string;
  /** GitHub OAuth AppのクライアントID */
  GITHUB_OAUTH_CLIENT_ID: string;
  /** GitHub OAuth Appのクライアントシークレット */
  GITHUB_OAUTH_CLIENT_SECRET: string;
  /** ログインを許可する唯一のGitHubユーザー名(大小無視で厳密一致) */
  ALLOWED_GITHUB_LOGIN: string;
  /** セッションCookie署名用のシークレット */
  SESSION_SECRET: string;
}

/**
 * アフィリエイト投稿用の商品情報。
 * ルート側の `src/affiliateProducts.ts` の `AffiliateProduct` 型と同じ形にする
 * (Workers runtimeはNode組み込みモジュールに依存する`src/`をimportできないため、
 * このファイルで独立して再定義する)。
 */
export interface AffiliateProduct {
  /** 一意識別子(ローテーション・投稿履歴の紐付けキー、ファイルパスの一部にもなる) */
  id: string;
  /** 商品・サービス名 */
  name: string;
  /** 公式サイトURL */
  officialUrl: string;
  /** 商品のメイン画像URL(任意) */
  imageUrl?: string;
  /** アフィリエイトリンク */
  affiliateUrl: string;
  /** 事実ベースの特長・スペックの箇条書き */
  facts: string[];
  /** カテゴリ(任意) */
  category?: string;
  /** trueの場合のみ投稿対象に含める */
  enabled: boolean;
}
