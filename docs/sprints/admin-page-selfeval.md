---
tags: [sprint-selfeval]
sprint: admin-page
---

# アフィリエイト商品管理ページ 自己評価レポート

## 実装した内容

### 1. `admin/`(Cloudflare Pages + Pages Functions、新規サブプロジェクト)
- `functions/_lib/types.ts`: `Env`インターフェース、`AffiliateProduct`型(`src/affiliateProducts.ts`と同形。Workers runtimeがNode組み込みモジュール依存の`src/`をimportできないため独立再定義)
- `functions/_lib/validate.ts`: `isHttpUrl`(http/https以外を拒否)、`SAFE_PRODUCT_ID`(英数字・-・_のみ)、`validateProductInput`(必須項目・型・URLスキーム・IDパストラバーサル対策を一括検証)、`toAffiliateProduct`
- `functions/_lib/session.ts`: Web Crypto API(`crypto.subtle`、HMAC-SHA256)によるセッションCookieのsign/verify。7日有効期限、タイミングセーフ比較、Cookie直列化ヘルパー(HttpOnly/Secure/SameSite=Lax固定)、OAuth state用の短命Cookieヘルパーも同居
- `functions/_lib/github.ts`: GitHub Contents API(`getFileContent`/`putFileContent`、sha必須の楽観ロック)・Actions API(`dispatchWorkflow`)の共通ヘルパー。`GitHubApiError`(実際のHTTPステータスを保持する例外クラス)を追加(再レビュー対応、後述)
- `functions/api/auth/login.ts` / `callback.ts` / `logout.ts`: GitHub OAuth(state CSRF対策・トークン交換・`ALLOWED_GITHUB_LOGIN`との大小無視厳密一致検証・セッション発行)
- `functions/api/products.ts`: GET(認証必須、商品一覧取得)/ POST(認証必須、バリデーション→sha取得→コミット→`regenerate-redirects.yml`をdispatch。dispatch失敗時はレスポンスに`redirectsRegenerated: false`を含める。commit失敗時は真の競合(409)とそれ以外(401/403等、502+具体的メッセージ)を区別、再レビュー対応)
- `functions/api/candidates.ts`: GET(認証必須、`data/affiliate-candidate-hints.json`をGitHub Contents API経由で取得するのみ)
- `public/`: フレームワーク不要の素のHTML/CSS/JS、モバイルファースト。未認証時ログインボタン、認証時は商品一覧(有効/無効トグル・追加/編集フォーム)・候補ヒント一覧を表示。フォームが開いている間は背景更新で入力が消えないようにする再描画保留機構(`scheduleRender`/`closeForm`)、fetch自体の例外も含めて全呼び出し元でエラー処理、候補ヒントURLのスキーム検証を追加(再レビュー対応)
- `test/`: `node:test`によるユニットテスト43件(session/validate/github、fetchはモック)
- `wrangler.toml` / `package.json` / `tsconfig.json`(functions用、`@cloudflare/workers-types`) / `tsconfig.test.json`(test用、`@types/node`。workers-typesとNode型のグローバル競合を避けるため分離) / `.env.example` / `README.md`

### 2. アフィリエイト候補ヒント生成(本番パイプラインとは独立)
- `src/generateCandidateHints.ts`: 既存`collectAndScoreNews()`を読み取り専用で呼び出し(引数なし=デフォルトアカウント)、上位15件を`data/affiliate-candidate-hints.json`に書き出す。`pipeline.ts`/`publish.ts`/`dryRun.ts`はimportしていない(テストで静的確認済み)。`src/ogpImage.ts`の`isHttpUrl`で候補urlのスキームを検証し、http/https以外は除外(再レビュー対応)
- `package.json`に`generate:candidate-hints`スクリプト追加
- `.gitignore`に`data/affiliate-candidate-hints.json`の例外(コミット対象化)・`admin/.dev.vars`・`admin/.wrangler/`の除外を追加
- `.github/workflows/update-candidate-hints.yml`: `workflow_dispatch`のみ、生成→変更があればコミット・プッシュ

### 3. リダイレクトページ自動再生成ワークフロー
- `.github/workflows/regenerate-redirects.yml`: `workflow_dispatch`のみ、`npm run generate:affiliate-redirects`実行→`docs/go/`の差分をコミット。`admin/functions/api/products.ts`のPOSTハンドラがコミット成功後にdispatch

### 4. 既存ファイルへの変更
- ルート`README.md`にadmin/の概要節を追記
- **既存の本番パイプライン(`src/pipeline.ts`/`src/publish.ts`/`src/dryRun.ts`/`.github/workflows/post.yml`/`.github/workflows/post-affiliate.yml`)は一切変更していない**(git diffで確認済み、対象外)

## 技術選定
- Cloudflare Pages + Pages Functions: 指示された技術スタック通り。無料枠内(Pagesの無料プランで個人利用は十分)で運用でき、Windows環境でも`wrangler`はクロスプラットフォーム動作しMac不要
- セッション: 自前のHMAC-SHA256署名Cookie(JWTライブラリ等の追加依存なし、Web Crypto APIのみでWorkers runtime内で完結)
- フロントエンド: フレームワーク無し(指示通り、ビルドステップ不要でそのまま配信可能)

## 前回フィードバックへの対応(オーケストレーターの`/code-review`指摘、CONFIRMED 5件)

1. **指摘**: `products.ts`のPOSTがコミット成功後に`dispatchWorkflow`(regenerate-redirects.yml)を呼ぶが、失敗しても`console.error`のみでクライアントには`{ok:true}`が返り、リダイレクトページ未生成のまま商品が有効化されうる → **対応**: レスポンスに`redirectsRegenerated`(boolean)と失敗時`redirectsError`を追加。`admin/public/app.js`の`submitForm`/`toggleEnabled`双方で`redirectsRegenerated === false`の場合に`window.alert`で警告表示(`warnIfRedirectsNotRegenerated`関数を追加)。
2. **指摘**: `putFileContent`の失敗を原因を区別せず常に409「競合」として返している → **対応**: `admin/functions/_lib/github.ts`に実際のHTTPステータスを保持する`GitHubApiError`クラスを追加し、`getFileContent`/`putFileContent`/`dispatchWorkflow`すべてで使用。`products.ts`のPOSTハンドラは`err.status === 409`の場合のみ409(真の競合)、それ以外(401/403/429等)は502+具体的なエラーメッセージを返すよう分岐。ユニットテストで409と401それぞれの`GitHubApiError.status`を検証する2件を追加。
3. **指摘**: `loadCandidates()`/`toggleEnabled()`完了時の`renderApp()`が`appEl.innerHTML`を丸ごとクリアし、編集中のフォーム入力が警告なく消える → **対応**: `state.formOpen`/`state.pendingRender`を追加し、`scheduleRender()`(フォームが開いている間は再描画を保留)を新設。`toggleEnabled`/`reloadProducts`/`loadCandidates`の成功時再描画を`renderApp()`から`scheduleRender()`に変更。`openForm()`で`formOpen=true`、`closeForm()`(新設、キャンセルボタン・保存成功時の両方から呼ぶ)で`formOpen=false`にし、保留中の再描画があれば実行する。
4. **指摘**: `fetchJSON()`のtry/catchが`res.json()`のみを覆い、`fetch()`自体の例外(オフライン等)が未処理のPromise rejectionになる → **対応**: `fetchJSON()`内で`fetch()`呼び出し自体をtry/catchし、失敗時は`{res: null, data: null, networkError: string}`を返す形に統一。`reloadProducts`/`loadCandidates`/`toggleEnabled`/`init`/`submitForm`/ログアウトのすべての呼び出し元で`networkError`を先頭でチェックしエラー表示するよう修正(submitForm独自のtry/catchは不要になったため削除し他と同じパターンに統一)。
5. **指摘**: 候補ヒントのurl(HN/Reddit/RSS由来)がスキーム検証を経ずに`<a href>`へ直接埋め込まれる → **対応**: 二重対策。(a) `src/generateCandidateHints.ts`で`src/ogpImage.ts`の`isHttpUrl`を使い、書き出し前にhttp/https以外の候補を除外(ログにも記録)。(b) `admin/public/app.js`に`isHttpUrl`をフロントにも複製し、候補ヒント描画時に`isHttpUrl(item.url)`がfalseならリンク化せず「(リンク無効)」というテキスト表示に切り替える。

**軽微指摘(非ブロッカー、対応は任意とされたもの)**: `renderProductCard`のcheckbox二重設定(`el()`属性指定+手動代入)は本修正のapp.js全面改修の中で単一の代入に整理済み。jsonResponse/base64変換/セッション検証の重複コード、products.ts/candidates.ts/auth系ハンドラの自動テスト不足は、スコープ外(スプリント範囲超過のリファクタリング)として今回は対応していない。

## 受け入れ基準チェック(自己申告)

- [x] `admin/`が指定のディレクトリ構成で作成されている
- [x] 共有ロジックは`admin/functions/_lib/validate.ts`に再実装(rootの`src/`をimportしていない)
- [x] シークレット(PAT/Client Secret/SESSION_SECRET)はフロントエンド・レスポンスJSONに含めていない
- [x] セッションCookieに`HttpOnly; Secure; SameSite=Lax`を必ず付与(テストで検証済み)
- [x] OAuth stateによるCSRF対策実装
- [x] `ALLOWED_GITHUB_LOGIN`との大小無視厳密一致のみ許可
- [x] `/api/products`・`/api/candidates`は先頭でセッション検証→未認証なら401(curlで実機確認済み)
- [x] 商品IDは`SAFE_PRODUCT_ID`で検証してから使用
- [x] `affiliateUrl`/`officialUrl`/`imageUrl`は`isHttpUrl`でhttp/https限定
- [x] GitHub APIへのcommitは必ず最新sha取得後に実行、真の競合(409)とその他のエラー(502)を区別して返す(再レビュー対応、ユニットテストで検証)
- [x] `src/generateCandidateHints.ts`は`collectAndScoreNews()`を読み取り専用で呼び出し、本番パイプラインをimportしない
- [x] `data/affiliate-candidate-hints.json`は`.gitignore`の例外でコミット対象
- [x] `update-candidate-hints.yml`/`regenerate-redirects.yml`(いずれも`workflow_dispatch`のみ、inputなし)、既存`post.yml`/`post-affiliate.yml`は未変更
- [x] リダイレクト再生成ワークフローのdispatch失敗をクライアントに伝える(`redirectsRegenerated`、再レビュー対応)
- [x] フォーム編集中のバックグラウンド再描画による入力消失を防止(`scheduleRender`、再レビュー対応)
- [x] fetch例外を含むネットワークエラーを全呼び出し元で処理(`networkError`パターン、再レビュー対応)
- [x] 候補ヒントURLのスキーム検証(サーバー側フィルタ+フロント側リンク無効化の二重対策、再レビュー対応)
- [x] `admin/functions/_lib/session.ts`・`validate.ts`・`github.ts`のユニットテスト(node:test、43件全パス)
- [x] `wrangler pages dev`ローカル起動で未認証時`/api/products`が401・`/api/auth/login`が正しいauthorize URLへリダイレクトすることをcurlで確認(修正後も再確認済み)
- [x] `npm run typecheck`相当(admin配下`tsc --noEmit`)がエラー0で通る
- [x] ルート`README.md`にadmin概要・セットアップはユーザー本人が別途行う旨を追記
- [x] シークレットはハードコードせず`admin/.env.example`にキー名のみ
- [x] `data/affiliate-products.json`の実データ(ZENCHORD1)は未変更
- [x] git commitはしていない

## アプリの起動方法

### admin/(Cloudflare Pages、ローカル開発)
```bash
cd admin
npm install
cp .env.example .dev.vars   # 値を埋める(ローカル検証時はダミー値でも401/リダイレクトの確認は可能)
npm run dev                  # wrangler pages dev public --compatibility-date=2026-07-01 (http://127.0.0.1:8788)
npm run typecheck            # tsc --noEmit(functions用・test用の2 tsconfigを両方チェック)
npm test                     # node --import tsx --test test/**/*.test.ts (43件)
```
修正後、`--port=8789`で再起動し、以下をcurlで再確認後、サーバーは停止済み:
- `GET /api/products` → `401 {"error":"unauthorized"}`
- `POST /api/products`(未認証) → `401`
- `GET /api/auth/login` → `302`、`Location`が`https://github.com/login/oauth/authorize?...`、`Set-Cookie: oauth_state=...; HttpOnly; Secure; SameSite=Lax`
- `node --check public/app.js` で構文エラー無しを確認

### ルートプロジェクト(既存、変更なし)
```bash
npm install
npm run typecheck
npm test                          # 280件全パス(generateCandidateHints.test.ts 6件、うちURL検証2件を再レビューで追加)
npm run generate:candidate-hints  # data/affiliate-candidate-hints.jsonを生成(実行にはHacker News/Reddit/RSS等への外部通信が発生)
```

## 既知の問題・懸念点

- **実OAuthログイン成功パスは未検証**: GitHub OAuth App(client id/secret)がユーザー未登録のため、`/api/auth/callback`のcode交換〜セッション発行〜`/`へのリダイレクトという成功パス全体は実機確認できていない。state不一致時の401応答・Cookie削除は確認済み。
- **実Cloudflare Pagesへのデプロイは未実施**: `wrangler pages dev`によるローカル起動のみ確認。
- **実GitHub API呼び出し(Contents API/Actions API)は未実行**: ダミーのPATでは401が返るため、実際のリクエスト/レスポンスはユニットテスト(fetchモック)でのみ検証。
- `admin/public/`のUIはブラウザでの実機タップ操作(実際のフォーム送信・トグル操作・フォーム保持の視認)までは検証していない(curlによるAPI層の確認と`node --check`による構文確認のみ)。フォーム保持ロジック(`scheduleRender`)自体はコードレビューレベルでは意図通りだが、ブラウザでの目視確認は未実施。
- `update-candidate-hints.yml`/`regenerate-redirects.yml`はGitHub Actions上での実行(実際のworkflow_dispatch起動)は未検証。

## 追加したテスト

- `admin/test/session.test.ts`(15件): セッション発行/検証のラウンドトリップ・秘密鍵不一致・期限切れ・改ざん検知・Cookie直列化のHttpOnly/Secure/SameSite=Lax・getSessionFromRequest
- `admin/test/validate.test.ts`(21件): isHttpUrl(許可/拒否)・SAFE_PRODUCT_ID・validateProductInputの正常系/各種異常系・toAffiliateProduct
- `admin/test/github.test.ts`(10件、うち2件を再レビューで追加): getFileContent/putFileContent/dispatchWorkflowのURL・ヘッダ・エラー処理に加え、`GitHubApiError`が409と401それぞれで正しい`status`を保持することを検証
- `test/generateCandidateHints.test.ts`(6件、うち2件を再レビューで追加): 出力形式・TOP_N絞り込み・0件時の安全な空配列出力・本番パイプライン非import確認に加え、javascript:等の不正スキームURLの候補を除外することを検証

## 関連ドキュメント
- [[x-ai-news-autopost-spec]]（製品仕様書）
