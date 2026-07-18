# アフィリエイト商品管理ページ(admin/)

X自動投稿バックエンド(`../src`)とは独立したサブプロジェクト。スマホから本人のみ
アクセスできる、アフィリエイト商品(`data/affiliate-products.json`)の追加・編集・
有効/無効切り替えと、参考情報(候補ヒント)閲覧のための管理ページ。

- 実行環境: Cloudflare Pages + Pages Functions(Workers runtime)
- フロントエンド: フレームワーク不要の素のHTML/CSS/JS(`public/`、ビルドステップなし)
- 認証: GitHub OAuth(許可するGitHubアカウントは1名のみ)
- データ永続化: このリポジトリ自体(GitHub Contents API経由でコミット)

**このサブプロジェクトのセットアップ(Cloudflareアカウント作成・GitHub OAuth App登録・
実デプロイ・実ログイン確認)はユーザー本人が別途行う。** ここではコードとローカル開発・
ユニットテストの手順のみを提供する。

## ディレクトリ構成

```
admin/
  functions/
    api/
      auth/login.ts       # GitHub OAuth authorize URLへリダイレクト
      auth/callback.ts    # OAuthコールバック(state検証→トークン交換→ログイン名検証→セッション発行)
      auth/logout.ts      # セッションCookie削除
      products.ts          # GET: 商品一覧取得 / POST: 商品追加・更新
      candidates.ts         # GET: 候補ヒント(参考情報)取得
      suggestFacts.ts        # POST: 公式サイトURLからfacts候補を提案(Anthropic API呼び出し)
      resolveAffiliateLink.ts  # POST: アフィリエイトリンク1つからofficialUrl/商品名/画像/factsを自動解決
    _lib/
      github.ts            # GitHub REST API呼び出しの共通ヘルパー
      session.ts             # 署名付きセッションCookieのsign/verify(Web Crypto API)
      validate.ts             # URL・商品IDのバリデーション純粋関数
      ssrf.ts                 # SSRF対策の簡易ホスト名チェック(suggestFacts.ts/resolveAffiliateLink.tsが使用)
      htmlText.ts              # HTMLから可読テキストを抽出する純粋関数
      fetchLimited.ts           # fetch応答をサイズ上限つきで読み取る
      factsPrompt.ts             # facts提案プロンプト構築・レスポンス解析の純粋関数
      ogpMeta.ts               # HTMLからOGPメタデータ(og:title/og:image)を抽出する純粋関数
      types.ts                # Env / AffiliateProduct型定義
  public/                    # 配信される静的ファイル(素のHTML/CSS/JS)
  test/                      # node:testによるユニットテスト
```

## セットアップ(ユーザー本人が行う作業)

1. GitHub Personal Access Token(Fine-grained推奨)を発行する。対象リポジトリへの
   Contents(読み書き)・Actions(workflow_dispatch起動)権限が必要。
2. https://github.com/settings/developers でGitHub OAuth Appを登録する。
   Authorization callback URLは本番デプロイ後のドメインの`/api/auth/callback`
   (例: `https://xxx.pages.dev/api/auth/callback`)。
3. Cloudflareアカウントを作成し、このリポジトリをCloudflare Pagesプロジェクトとして
   接続する(ビルド設定: ルートディレクトリ`admin`、ビルド出力ディレクトリ`public`、
   ビルドコマンドなし)。
4. Cloudflare Pagesプロジェクトの Environment variables に `.env.example` に列挙した
   キーと実際の値を登録する(`GITHUB_PAT` / `GITHUB_REPO` / `GITHUB_BRANCH` /
   `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET` / `ALLOWED_GITHUB_LOGIN` /
   `SESSION_SECRET`)。
5. (任意)「公式サイトから事実情報を提案」機能を使う場合は `ANTHROPIC_API_KEY` も同様に
   登録する。未設定でもそれ以外の機能(商品CRUD・A8.netショートカット等)には影響しない。

## ローカル開発

```bash
cd admin
npm install

# .env.example を .dev.vars としてコピーし、値を埋める(.dev.varsはgitignore対象)
cp .env.example .dev.vars

# wrangler pages dev でローカル起動(既定: http://127.0.0.1:8788)
npm run dev

# 型チェック
npm run typecheck

# ユニットテスト(node:test。純粋関数・fetchモックのみで完結し、実GitHub API/実OAuthは呼ばない)
npm test
```

実際のGitHub OAuth App(client id/secret)が未登録の状態でも、`npm run dev`は起動でき、
未認証時の`/api/products`の401応答や`/api/auth/login`のリダイレクトURL組み立てはcurl等で
確認できる。実際のGitHubログイン成功パス(コールバック以降)はOAuth Appの登録が必要なため
このリポジトリの範囲では検証していない。

## 環境変数

`.env.example` 参照。シークレット値は絶対にコードにハードコードしない。
