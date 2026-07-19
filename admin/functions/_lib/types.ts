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
  /**
   * Anthropic APIキー(`/api/suggestFacts`用)。任意設定(未設定の場合、当該機能は
   * 「利用できません」エラーを返すのみで、既存の他機能には影響しない)。
   */
  ANTHROPIC_API_KEY?: string;
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

/**
 * A8.net提携申請のステータス追跡エントリ。提携申請が実際に受理されたかどうかは
 * ユーザー本人がA8.netにログインしないと分からないため、statusは自動検知ではなく
 * ユーザーがadmin管理ページ上で手動切り替えする(applying→approvedの一方向遷移を想定)。
 *
 * A8.netのプログラム詳細ページURL(ユーザーがA8.net検索結果から開いてコピー&ペーストしたもの)から
 * 記録する。このURL自体はA8.netのログイン後管理画面内のページのため、サーバー側からfetchで
 * 内容を取得することはできない・しない(URL文字列からのprogramIdクエリパラメータ抽出のみ行う)。
 */
export interface ApplicationTrackingEntry {
  id: string;
  /** A8.netのプログラム詳細ページから自動取得できないため、ユーザーが分かる場合のみ手入力する任意項目 */
  productName: string | null;
  /** A8.netのプログラム詳細ページURLの`programId`クエリパラメータの値。抽出できなかった場合はnull */
  a8ProgramId: string | null;
  /** ユーザーが貼り付けたA8.netのプログラム詳細ページURLそのもの */
  a8ProgramUrl: string | null;
  status: "applying" | "approved";
  createdAt: string;
  updatedAt: string;
}
