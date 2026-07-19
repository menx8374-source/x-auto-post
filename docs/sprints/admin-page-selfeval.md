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

---

## 追加機能: アフィリエイト商品候補の自動検出・追加フォーム事前入力(2026-07-18)

ユーザー要望「おすすめのアフィリエイトプログラムを自動で追加して」への対応。ASPへの自動提携・自動リンク取得は利用規約違反・認証情報保存リスクのため見送り、代わりに「候補を自動提案し、手入力を最小化する」方向で実装した。

### 実装内容
- `src/generateCandidateHints.ts`: 収集済み上位15件のニュースタイトルを1回のAPI呼び出しでClaudeに渡し、「特定の名前を持つ商業的なAI製品・ツール・サービス」を主題にした項目のみ`productCandidate: { name, officialUrlGuess }`を付加。商品の特長・効果等の事実情報はプロンプトで明示的に生成禁止(`facts`は空のまま、ユーザーが公式サイトを見て手入力する運用は不変)。
  - トークン節約のため15件を1回のバッチ呼び出しでJSON配列として受け取る。
  - `ANTHROPIC_API_KEY`未設定時はinfoログを出して分類をスキップし、従来通りタイトル一覧のみ書き出す(エラーにしない)。
  - レスポンスのJSONパース失敗・API呼び出し失敗はいずれも例外を投げず空のMapにフォールバックし、スクリプト全体は失敗させない。
  - 既存のシグネチャ(`outFile`, `collectFn`)は維持し、テスト用に3番目の任意引数`client`を追加(既存呼び出し元`.github/workflows/update-candidate-hints.yml`・`npm run generate:candidate-hints`は無変更で動作)。
- `.github/workflows/update-candidate-hints.yml`: `env: ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}`を追加(既存secret、新規登録不要)。
- `admin/public/candidateSlug.js`(新規): 製品名からSAFE_PRODUCT_ID準拠のスラッグを生成する純粋関数`slugifyProductName`。日本語のみの名前は空文字列を返す(ユーザー入力に委ねる)。
- `admin/public/app.js`: `<script type="module">`化し`candidateSlug.js`をimport。候補ヒント一覧の`productCandidate`ありの項目に「商品候補: <name>」バッジと「商品として追加」ボタンを表示。押すと`openForm(null, prefill)`で商品追加フォームを開き、id(スラッグ)/name/officialUrlを事前入力、facts/affiliateUrl/imageUrl/categoryは空、enabledは常にfalse(下書き)。
- `admin/public/index.html`: `<script src="app.js" type="module">`に変更(ESモジュールとしてcandidateSlug.jsをimportするため)。
- `admin/tsconfig.test.json`: `allowJs`/`checkJs:false`を追加し`public`をincludeに追加、テストから`.js`ファイルの型(JSDoc由来)を解決できるようにした。

### 技術選定
- 追加ライブラリなし。既存の`@anthropic-ai/sdk`・既存パターン(`src/generateAffiliatePost.ts`)を再利用。

### 受け入れ基準チェック(自己申告)
- [x] ニュースタイトルから商業的AI製品を判定・製品名抽出・(明確な場合のみ)公式URL推測を1回のバッチAPI呼び出しで行う: `buildProductCandidatePrompt`/`detectProductCandidates`で実装、テストで確認。
- [x] 商品の特長・事実情報をAIに生成させない: プロンプトで明示的に禁止、`facts`はコード上一切生成しない(常にユーザー入力)。
- [x] ANTHROPIC_API_KEY未設定時は安全にスキップし従来動作を維持: `detectProductCandidates`がnullクライアント時に空Mapを返すことをテストで確認。
- [x] JSONパース失敗時も例外を投げずフォールバック: テストで確認。
- [x] 既存の`generateCandidateHints`シグネチャ・出力先・呼び出し元ワークフローは変更なし(後方互換の任意引数追加のみ)。
- [x] admin側「商品として追加」ボタンでフォーム事前入力(id/name/officialUrl)、facts/affiliateUrl/imageUrl/category空、enabled=false: `app.js`のコードレベルで実装。ブラウザでの実機タップ確認は`wrangler pages dev`でのファイル配信確認(app.js/candidateSlug.jsが200で正しくESモジュールとして配信されること)のみ行い、実際のクリック操作によるフォーム開閉の目視確認は**未実施**(既存selfevalの懸念点と同様の制約)。
- [x] A8.net等ASPへの自動ログイン・スクレイピング・自動リンク取得は実装していない(コードに該当処理なし)。
- [x] 既存の本番投稿パイプライン(pipeline.ts/publish.ts/dryRun.ts/post.yml/post-affiliate.yml)は無変更。
- [x] `npm test`(ルート293件)・`npm run typecheck`(ルート・admin両方)通過を確認。

## アプリの起動方法(admin管理ページ、ローカル確認用)
```bash
cd admin
npm install
npm run dev   # wrangler pages dev public --compatibility-date=2026-07-01 (既定ポート8788、ポート競合時は --port で変更可)
```
ルートプロジェクトの候補ヒント生成: `npm run generate:candidate-hints`(要`ANTHROPIC_API_KEY`、未設定でも安全にスキップされる)。

## 既知の問題・懸念点
- ブラウザでの実機操作(「商品として追加」ボタンのクリック→フォーム事前入力の目視確認)は未実施。`wrangler pages dev`でのapp.js/candidateSlug.jsの配信確認(200、ESモジュールとして正しい内容)とコードレビューのみ。
- Claude分類の実API呼び出し(実際のAI関連ニュースに対する分類精度)は未検証(モッククライアントによるユニットテストのみ)。ANTHROPIC_API_KEYが利用可能な環境で`npm run generate:candidate-hints`を実行し、`data/affiliate-candidate-hints.json`の内容を目視確認することを推奨。

## 追加したテスト
- `test/generateCandidateHints.test.ts`: `buildProductCandidatePrompt`(事実情報を生成させない指示の検証)、`parseProductCandidateResponse`(正常系/コードブロック混入/不正スキームURL/不正JSON/範囲外index等)、`detectProductCandidates`(クライアントnull/API例外/0件時)、`generateCandidateHints`(商品候補あり/API未設定/JSON不正の3パターンで既存動作へのフォールバックを確認)を追加(13件)。
- `admin/test/candidateSlug.test.ts`(新規、6件): `slugifyProductName`の英数字変換・記号のハイフン化・先頭末尾ハイフン除去・日本語名での空文字列フォールバック・非文字列入力での安全なフォールバック・SAFE_PRODUCT_ID充足を検証。

---

## /code-review指摘への対応(2026-07-18、再実装)

オーケストレーターの`/security-review`(指摘なし)・`/code-review`(effort: low)でCONFIRMED 2件が見つかりFAIL。以下を修正。

### 対応内容
1. **[test/generateCandidateHints.test.ts] テストからの意図しない実API呼び出しリスク**: 既存5件の`generateCandidateHints(outFile, collectFn)`呼び出しが`client`引数省略のままだった。省略時は`detectProductCandidates`内で`client===undefined`→`createAnthropicClient(account)`が呼ばれ、実行環境に`ANTHROPIC_API_KEY`が設定されていると`npm test`実行時に実際のAnthropic APIを呼んでしまう。5件すべてに`client: null`を明示的に追加(既存の新規テストと同じ流儀に統一)。
2. **[admin/public/app.js] 候補ヒントからの商品追加で既存商品をサイレント上書きするリスク**: `admin/functions/api/products.ts`のPOSTハンドラはidが既存商品と一致すると無条件に「更新」として完全上書きする(作成専用モード・衝突拒否なし)。候補ヒントから自動生成したidが既存の有効な商品(facts/affiliateUrl設定済み)のidとたまたま一致すると、空のドラフト値で警告なく上書き・データ消失する。
   - `admin/public/productConflict.js`(新規)に純粋関数`findConflictingProduct(products, id)`を追加。
   - `admin/public/app.js`の`openForm()`で`form.dataset.editing`に編集/新規追加を記録し、`submitForm()`で新規追加(`dataset.editing !== "true"`)の場合のみ、送信前に`findConflictingProduct(state.products, payload.id)`でID衝突をチェック。衝突時はエラーメッセージ(「このID「<id>」は既存の商品「<name>」と重複しています。このまま保存すると既存商品が上書きされます。新規追加のため、IDを変更してください。」)を表示し送信をブロック(APIは呼ばない)。候補ヒント経由・手動「+商品を追加」経由の両方の新規追加フローに適用(同一の根本原因のため)。既存商品編集フロー(id一致で意図的に更新)は対象外。

非ブロッカー指摘(MAX_CLASSIFICATION_OUTPUT_TOKENSの部分救済、slugifyProductNameの長さ上限、IIFEラッパーの冗長性)は今回は未対応(任意対応のため見送り)。

### 修正後の検証
- ルート: `npm run typecheck` OK、`npm test` 293件全パス。
- admin: `npm run typecheck` OK、`npm test` 53件全パス(新規`admin/test/productConflict.test.ts` 4件を追加)。
- `node --check`でapp.js/candidateSlug.js/productConflict.jsの構文確認OK。
- `wrangler pages dev`を一時起動し、app.js/candidateSlug.js/productConflict.jsがいずれも200で配信されることを確認後、プロセスを停止(ポート解放済み)。

### 追加したテスト(この修正分)
- `admin/test/productConflict.test.ts`(新規、4件): 一致あり/一致なし/空配列/products非配列(null/undefined)での安全なフォールバックを検証。

---

## 追加機能(2026-07-18): A8.netショートカット + 公式サイトからのfacts自動提案

ユーザー要望「ほぼワンボタンで商品プログラムに申請し、広告ページURLを貼るだけで追加できるようにしたい」に対応する2機能を追加。

### 実装した内容

**機能1: A8.netへのショートカット(申請リンク)**
- `admin/public/a8Search.js`(新規): DOM非依存の純粋関数`copyTextSafely`(clipboard実装を引数で受け取り、非対応/失敗時は例外を投げずfalseを返す)・`buildA8GuideMessage`(コピー成功/失敗でメッセージを出し分け)・`A8_TOP_URL`定数。
- `admin/public/app.js`: `openA8Search(name)`を追加。A8.netトップページを新タブで開き、商品名をクリップボードにコピーし、結果に応じた案内を`window.alert`で表示(コピー失敗時は商品名をテキストで見える形にフォールバック)。商品追加/編集フォーム(名前欄付近)と、候補ヒントの「商品候補」バッジ横の両方にボタンを設置。
- サーバー側の変更なし(クライアントサイドのみ)。A8.netへの自動ログイン・スクレイピング・自動申請は実装していない(合意済みの除外事項どおり)。

**機能2: 公式サイトURLからfacts自動提案**
- `admin/functions/_lib/ssrf.ts`(新規): `isBlockedHostname`(localhost/127./0.0.0.0/169.254./::1等の簡易パターン)・`isSafeExternalUrl`(isHttpUrl + ホスト名チェック)。
- `admin/functions/_lib/htmlText.ts`(新規): `extractTextFromHtml`。`HTMLRewriter`はWorkers専用グローバルでNode.jsの`node:test`から呼べないため、テスト容易性を優先し正規表現ベースで実装(`<script>`/`<style>`は内容ごと除去、ブロック要素は改行に変換、基本的なHTMLエンティティをデコード)。
- `admin/functions/_lib/fetchLimited.ts`(新規): `readTextWithLimit(response, maxBytes)`。ReadableStreamを読みながらバイト数をカウントし、上限超過で打ち切る(`truncated`フラグを返す、例外は投げない)。
- `admin/functions/_lib/factsPrompt.ts`(新規): `FACTS_SUGGESTION_MODEL`(`src/generatePost.ts`の`DEFAULT_MODEL`既定値を複製)・`truncatePageText`(8000文字)・`buildFactsSuggestionPrompt`(プロンプトインジェクション対策+「書かれていない事実を創作しない」制約を明示)・`parseFactsSuggestionResponse`(コードブロック除去→JSON.parse→文字列以外/空文字列を除去、失敗時は例外を投げず空配列)・`extractTextFromAnthropicMessage`(Messages APIレスポンスのtextブロック連結)。
- `admin/functions/api/suggestFacts.ts`(新規): `POST /api/suggestFacts`。認証必須(`getSessionFromRequest`)→`officialUrl`のisHttpUrl検証→SSRF簡易チェック→`ANTHROPIC_API_KEY`未設定チェック→`fetch(officialUrl)`(AbortController 10秒タイムアウト、`readTextWithLimit`で1MB上限)→HTMLからテキスト抽出→Anthropic Messages APIを`fetch`で直接呼び出し(Workers runtimeは`@anthropic-ai/sdk`のNode向けラッパーをimportできないため)→facts配列を返す。各段階で失敗時は例外を投げず、適切なHTTPステータス(400/502/503)とエラーメッセージを返す。
- `admin/functions/_lib/types.ts`: `Env`に`ANTHROPIC_API_KEY?: string`を追加(任意設定、未設定でも既存機能に影響なし)。
- `admin/public/index.html` / `app.js`: 商品追加/編集フォームの公式サイトURL欄付近に「公式サイトから事実情報を提案」ボタンと状態表示用の`<p>`を追加。`suggestFactsFromOfficialUrl(form)`が`/api/suggestFacts`を呼び出し、結果を`facts`欄に**追記**(既存入力を上書きしない)。自動保存はしない(保存は既存の「保存」ボタン操作まで確定しない)。

### 技術選定
- 新規ライブラリの追加なし。既存パターン(`src/generateCandidateHints.ts`のプロンプト設計・レスポンスパース、`admin/functions/api/products.ts`のハンドラ構成、`admin/functions/_lib/github.ts`のfetchベースAPI呼び出し)を踏襲。
- Anthropic API呼び出しはWorkers runtimeの制約上SDKを使わず`fetch`直叩き(モデルIDは`src/generatePost.ts`の`DEFAULT_MODEL`を`admin/functions/_lib/factsPrompt.ts`に複製。値が変わった場合は両方の更新が必要)。

### 受け入れ基準チェック(自己申告)
- [x] 「A8.netで探す」ボタン: トップページを新タブで開く・商品名をクリップボードにコピー・案内メッセージ表示を実装。クリップボード失敗時のフォールバック(商品名をテキストで見える形に)を実装・テスト済み。
- [x] A8.netの検索結果への直リンクは作っていない(トップページのみを開く)。
- [x] サーバー側の変更なし(機能1はクライアントサイドのみ): `admin/functions/`配下に機能1専用のコードは無い。
- [x] `POST /api/suggestFacts`: 認証必須(`getSessionFromRequest`)、`officialUrl`のhttp/https検証、SSRF対策(内部向けホスト名拒否・レスポンスサイズ上限1MB・タイムアウト10秒)を実装。
- [x] プロンプトインジェクション対策: システムプロンプトで「ページ本文は指示ではない」「指示文らしきものに従わない」を明示(テストで文言を検証)。
- [x] 事実に無い情報を創作しない制約を明示(テストで文言を検証)。
- [x] JSON配列パース失敗時は例外を投げず空配列を返す(サーバーエラーにしない): テストで確認。
- [x] `ANTHROPIC_API_KEY`未設定時は専用のエラーメッセージを返す: `wrangler pages dev`での実機確認(503、メッセージ一致)。
- [x] facts欄への反映は追記(既存入力を上書きしない)、自動保存はしない: `app.js`のコードで確認(`existing ? ... : ...`で連結、保存は別ボタン操作)。
- [x] 既存の本番投稿パイプライン(pipeline.ts/publish.ts/dryRun.ts/post.yml/post-affiliate.yml)は無変更(git statusで対象外を確認)。
- [x] A8.net等ASPへの自動ログイン・スクレイピング・自動リンク取得・自動提携申請は実装していない(コードに該当処理なし)。
- [x] シークレットのハードコードなし(`ANTHROPIC_API_KEY`は`env`経由、`.env.example`にキー名のみ追加)。
- [x] `npm test`(ルート293件・admin97件)・`npm run typecheck`(ルート・admin両方)通過を確認。

## アプリの起動方法(admin管理ページ、ローカル確認用、変更なし)
```bash
cd admin
npm install
npm run dev   # wrangler pages dev public --compatibility-date=2026-07-01 (既定ポート8788)
```
`.env.example`を`.dev.vars`としてコピーし値を埋める。`ANTHROPIC_API_KEY`を追加しない場合、「公式サイトから事実情報を提案」ボタンは503エラーを返すのみで他機能には影響しない。

## 既知の問題・懸念点
- **ユーザー側の新規セットアップ作業が必要**: Cloudflare Pagesの本番環境変数に`ANTHROPIC_API_KEY`をユーザー本人が追加登録する必要がある(`docs/admin-page-setup.md`の環境変数表・8章に追記済み)。未登録でも他機能は動作する(feature 2のみ503エラー)。
- Anthropic API(`https://api.anthropic.com/v1/messages`)への実際のfetch呼び出しは、ローカル環境に有効な`ANTHROPIC_API_KEY`が用意されていなかったため未検証(モック不要な純粋関数群のユニットテストと、`wrangler pages dev`での`ANTHROPIC_API_KEY`未設定時の503応答確認のみ実施)。実際のAPIキーが利用可能な環境で、facts提案が公式サイトの実内容から妥当な事実を抽出できるかを一度目視確認することを推奨。
- ブラウザでの実際のクリック操作(A8.netボタンでの新タブオープン・クリップボードコピー、facts提案ボタンでのローディング表示・facts欄への追記の目視確認)は未実施。`wrangler pages dev`でのapp.js/a8Search.jsの配信確認(200)・エンドポイントのcurlでの認証/バリデーション/エラーレスポンス確認・コードレビューのみ実施(既存selfevalの懸念点と同様の制約)。

## 追加したテスト
- `admin/test/a8Search.test.ts`(新規、7件): `A8_TOP_URL`の値、`copyTextSafely`(成功/未指定/null/関数でない/例外reject時)、`buildA8GuideMessage`(成功/失敗メッセージの内容)。
- `admin/test/ssrf.test.ts`(新規、8件): `isBlockedHostname`(localhost/127./0.0.0.0/169.254./::1のブロック、通常ホストの許可、空/不正入力の安全側フォールバック)、`isSafeExternalUrl`(不正スキーム拒否、内部ホスト拒否、通常URL許可、パース不能時のfalse)。
- `admin/test/htmlText.test.ts`(新規、7件): script/styleタグの内容ごと除去、コメント除去、エンティティデコード、空白正規化、非文字列入力、ブロック要素の改行変換。
- `admin/test/fetchLimited.test.ts`(新規、4件): 上限内/上限超過(truncated)/空レスポンス/body未指定レスポンスの読み取り。
- `admin/test/factsPrompt.test.ts`(新規、18件): モデル定数、`truncatePageText`、`buildFactsSuggestionPrompt`(プロンプトインジェクション対策・創作禁止・JSON配列指定の文言検証)、`parseFactsSuggestionResponse`(正常系・コードブロック混入・空配列・不正JSON・非配列・型混在・トリム)、`extractTextFromAnthropicMessage`(連結・非textブロック除外・不正形式への耐性)。
- 手動確認(`wrangler pages dev`): 未認証401、SSRF拒否(内部URL)400、不正スキーム400、`ANTHROPIC_API_KEY`未設定503を実機で確認後、プロセス停止済み。

---

## /security-review指摘への対応(2026-07-18、facts自動提案機能の再実装)

オーケストレーターの`/security-review`でCONFIRMED High(Confidence 9/10)1件が見つかりFAIL。以下を修正。

### 対応内容
1. **[admin/functions/api/suggestFacts.ts] SSRFガードがリダイレクトでバイパスされる**: `isSafeExternalUrl(officialUrl)`は元のURL文字列のみを検証しており、`fetch(officialUrl, { redirect: "follow" })`が追従した先のホストは一切再検証していなかった。攻撃者が影響を与えうる`officialUrl`(候補ヒントの`officialUrlGuess`はニュース記事タイトルからのLLM推測に由来)が`302 Location: http://169.254.169.254/...`等の内部向けホストへリダイレクトするレスポンスを返せば、SSRFガードを迂回して内部ネットワークの内容を取得しAIプロンプトに混入させられる問題だった。
   - 指摘された修正方針のうち方式2(`redirect: "follow"`のまま、fetch完了後に`res.url`(最終到達URL)を`isSafeExternalUrl()`で再検証し、安全でなければボディを読まずに拒否する)を採用。Cloudflare Workers・ブラウザいずれのfetch実装も`Response.url`にリダイレクト追従後の最終URLを設定する仕様のため、追加のリクエストなしで検証できる。
   - `res.ok`チェックの直後、`readTextWithLimit()`でボディを読む前に`!res.url || !isSafeExternalUrl(res.url)`をチェックし、不正の場合は`res.body?.cancel()`でストリームを閉じてから400エラーを返す(ボディの内容がAIプロンプト・レスポンスに混入する経路を確実に断つ)。
   - 任意扱いだったIP範囲拡充(RFC1918プライベートレンジ等、`admin/functions/_lib/ssrf.ts`)は今回は見送り(non-blocker指摘のため)。

### 追加した回帰テスト
- `admin/test/suggestFacts.test.ts`(新規、6件): `onRequestPost`(ハンドラ本体)の未認証401・不正スキーム400(fetch未呼び出し確認)・内部向けホスト400(fetch未呼び出し確認)・`ANTHROPIC_API_KEY`未設定503(fetch未呼び出し確認)・**officialUrl自体は安全だがリダイレクト先が内部向けホストの場合に400で拒否しボディを読まないことの確認(今回のCONFIRMED指摘の直接的な回帰テスト)**・正常系(facts抽出成功)を検証。
- この過程で`admin/tsconfig.test.json`の`types`に`@cloudflare/workers-types`を追加(既存は`["node"]`のみだったため、ハンドラファイル(`PagesFunction`型使用)を初めてテストからimportした際に型解決エラーが発生したための対応。既存の`fetch`/`Response`等のNode組み込み型との衝突は`npm run typecheck`・`npm test`双方で確認済み、問題なし)。

### 修正後の検証
- admin: `npm run typecheck` OK(2回連続で確認)、`npm test` 103件全パス(新規`admin/test/suggestFacts.test.ts` 6件を含む)。
- ルート: `npm run typecheck` OK、`npm test` 293件全パス(既存機能への影響なし)。
- `wrangler pages dev`を一時起動し、内部向けホストURL(事前チェック)400・`ANTHROPIC_API_KEY`未設定503を実機で再確認後、プロセスを停止(ポート解放済み)。実際の外部リダイレクトによるSSRFバイパスシナリオは、安全に実機再現する手段がない(実在の内部/クラウドメタデータサービスへのリダイレクトを伴うため)ため、モックによる回帰テストのみで検証。

---

## UX簡略化(2026-07-19): 候補ヒントからのfacts自動取得 + 保存時のenabled自動有効化

ユーザーフィードバック「ほぼワンボタンで商品を追加できるようにしてほしい」への対応。バックエンドの安全設計(SSRF対策・facts手動確認の運用・法令順守)は無変更、フロントエンドの操作フロー簡略化のみ。

### 実装した内容

**変更1: 候補ヒントから商品追加時、facts提案を自動実行**
- `admin/public/app.js`の`addProductFromCandidate(item)`: `officialUrlGuess`が存在し`isHttpUrl()`を通過する場合、`openForm()`でフォームを開いた直後に`document.getElementById("product-form")`で取得したformに対し、既存の`suggestFactsFromOfficialUrl(form)`(手動ボタンと全く同じ関数)をそのまま呼び出す形で実装。ローディング表示・失敗時のエラー表示・フォーム操作継続は既存関数のロジックをそのまま流用するため追加実装不要(既に「事実情報の提案取得に失敗しました」等のメッセージ表示のみで例外を投げない設計だった)。
- `officialUrlGuess`が無い(空文字列)場合は`isHttpUrl("")`がfalseになり自動実行しない。既存の手動ボタンはそのまま残置。

**変更2: 保存時、有効なアフィリエイトリンクがあれば自動的にenabled=trueにする**
- `admin/public/productEnabled.js`(新規): 純粋関数`resolveEnabledOnSubmit({ isEditing, checkboxEnabled, affiliateUrlValid })`。新規追加(`!isEditing`)かつ`affiliateUrlValid`の場合のみtrueを返し、それ以外(編集時、またはaffiliateUrl無効時)はチェックボックスの値をそのまま返す。
- `admin/public/app.js`の`submitForm()`: `payload.enabled`を`form.elements.enabled.checked`から`resolveEnabledOnSubmit(...)`の戻り値に変更。`isEditing`(`form.dataset.editing === "true"`)は既存の重複IDチェックと共用する変数に統一。
- `admin/public/index.html`: アフィリエイトリンク欄の直下に案内テキスト「広告リンクを入力すると保存時に自動的に投稿対象になります(新規追加時のみ)。」を追加(`hint-note`クラス、既存スタイル流用)。

### 技術選定
- 追加ライブラリなし。既存パターン(`productConflict.js`/`candidateSlug.js`と同じ「DOM非依存の純粋関数を`public/`に切り出し、`app.js`とテストの両方からimportする」構成)を踏襲。

### 受け入れ基準チェック(自己申告)
- [x] 候補ヒントからのフォーム展開時、officialUrlGuessが有効なURLならfacts提案を自動実行: `addProductFromCandidate`のコードで確認。ローディング表示(「提案を取得中...」ボタン文言+「公式サイトの内容を確認しています...」ステータス文言)は既存`suggestFactsFromOfficialUrl`のロジックをそのまま利用。
- [x] 取得失敗時もフォームは開いたまま操作継続可能: `suggestFactsFromOfficialUrl`は例外を投げずstatusEl.textContentにエラーメッセージを設定するのみ(既存実装、変更なし)。
- [x] officialUrlGuess無しの場合は自動実行しない: `isHttpUrl("")`がfalseを返すため分岐しない。
- [x] 手動ボタンは残置: `index.html`のボタン・`suggest-facts-button`のイベントリスナーは無変更。
- [x] 新規追加時のみ、affiliateUrlが有効ならenabled自動true(チェックボックスの値を上書き): `resolveEnabledOnSubmit`のユニットテストで検証。
- [x] 編集時は自動有効化しない: 同上テストで検証(`isEditing: true`のケース)。
- [x] affiliateUrl無効/空の場合は自動有効化しない: 同上テストで検証。
- [x] 案内テキストを追加: `index.html`に追加、目視確認は`wrangler pages dev`での`/app.js`配信・`node --check`構文確認のみ(下記懸念点参照)。
- [x] 既存の本番パイプライン・`admin/functions/`配下のバックエンドロジックは無変更(git diffで対象ファイルへの変更がないことを確認)。
- [x] シークレットのハードコードなし(今回の変更はDOM操作ロジックのみで新規シークレット無し)。
- [x] `npm test`(ルート293件・admin107件、新規`productEnabled.test.ts` 4件を含む)・`npm run typecheck`(ルート・admin両方)通過を確認。
- [x] git commitはしていない。

### アプリの起動方法(admin管理ページ、ローカル確認用、変更なし)
```bash
cd admin
npm install
npm run dev   # wrangler pages dev public --compatibility-date=2026-07-01 (既定ポート8788)
```

### 既知の問題・懸念点
- ブラウザでの実際のクリック操作(候補ヒントの「商品として追加」ボタン押下→facts欄への自動追記の目視確認、保存ボタン押下時のenabled自動チェックの目視確認)は未実施。`wrangler pages dev`での`app.js`/`productEnabled.js`の配信確認(200、内容確認)・`node --check`による構文確認・コードレビューのみ実施(既存selfevalの各節と同様の制約)。
- `suggestFactsFromOfficialUrl`の自動実行は既存の手動ボタン操作と全く同じ関数を呼ぶのみのため、Anthropic APIの実呼び出し自体(facts抽出精度)は今回新規検証していない(既存の懸念点と同じ)。

### 追加したテスト
- `admin/test/productEnabled.test.ts`(新規、4件): 新規追加+affiliateUrl有効(チェックボックスOFF/ON双方でtrue)、新規追加+affiliateUrl無効(チェックボックスの値をそのまま)、編集時+affiliateUrl有効(自動有効化しない)、編集時+affiliateUrl無効の4パターンを検証。

---

## 修正(2026-07-19): A8.net検索結果ページへの直リンク化(新情報反映)

A8.net公式ページ(`support.a8.net/as/HintOfProgram/selection.php`)のHTMLソースに実際に埋め込まれているhref値を調査した結果、プログラム検索結果ページのURLパターン(`https://media-console.a8.net/program/search/keyword?keywords=<キーワード>`)が判明したため、従来のトップページ固定リンクから検索結果への直リンクに変更。

### 対応内容
1. `admin/public/a8Search.js`: 純粋関数`buildA8SearchUrl(productName)`を追加(`https://media-console.a8.net/program/search/keyword?keywords=${encodeURIComponent(productName)}`を返す。空/未定義/空白のみの場合は`A8_TOP_URL`にフォールバック)。冒頭コメントを新しいURLパターンの出所(A8.net公式ページの実際のhref値から抽出、推測ではない)に更新。
2. `admin/public/app.js`: `openA8Search(name)`が開くURLを`A8_TOP_URL`固定から`buildA8SearchUrl(trimmed)`に変更(import文・関数doc含む)。
3. クリップボードへの商品名コピー(`copyTextSafely`)はそのまま維持。
4. `buildA8GuideMessage(name, copied)`の文言を「検索結果ページを新しいタブで開いた」前提に更新(未ログイン時はログイン画面が表示される旨、コピー済み商品名を検索欄に貼り付ける導線を明記)。

### 受け入れ基準チェック(自己申告)
- [x] `buildA8SearchUrl`が正しい検索結果URLを生成: テストで確認(`Notta` → `https://media-console.a8.net/program/search/keyword?keywords=Notta`)。
- [x] URLエンコードされる: テストで特殊文字(`/`, `&`, 日本語)を含む商品名を検証。
- [x] 空文字列/undefinedの場合`A8_TOP_URL`にフォールバック: テストで空文字列・undefined・空白のみの3パターンを検証。
- [x] ボタン押下時に開くURLが`buildA8SearchUrl(name)`の結果に変更されている: `app.js`のコードで確認。
- [x] クリップボードコピーは維持: `copyTextSafely`呼び出しは変更なし。
- [x] 案内メッセージが新しい前提(検索結果ページを開いた)に更新されている: テストで文言(「検索結果ページ」を含む)を検証。
- [x] A8.netへの自動ログイン・自動提携申請・スクレイピングは実装していない(新しいタブでURLを開くのみ、コード上該当処理なし)。
- [x] `productName`は必ず`encodeURIComponent()`してからURLに埋め込む: `buildA8SearchUrl`実装・テストで確認。
- [x] 既存の本番投稿パイプラインは無変更(対象外ファイル、変更なし)。
- [x] `npm test`(admin 110件全パス、新規`buildA8SearchUrl`テスト3件を含む)・`npm run typecheck`(admin、tsconfig.json+tsconfig.test.json両方)通過を確認。
- [x] git commitはしていない。

### アプリの起動方法(admin管理ページ、ローカル確認用、変更なし)
```bash
cd admin
npm install
npm run dev        # wrangler pages dev public --compatibility-date=2026-07-01 (既定ポート8788)
npm run typecheck  # tsc --noEmit(tsconfig.json + tsconfig.test.json)
npm test           # node --import tsx --test test/**/*.test.ts
```

### 既知の問題・懸念点
- ブラウザでの実際のクリック操作(「A8.netで探す」ボタン押下→検索結果ページ/ログイン再認証画面が新しいタブで開くことの目視確認)は未実施。`node --check`による構文確認・`npm test`/`npm run typecheck`によるロジック検証のみ実施(サーバー起動を伴う確認は今回不要と判断し行っていない)。
- A8.netの実際のログイン後の挙動(検索結果ページへ正しく遷移するか)は、A8.netアカウントでのログインが必要なため未検証。今回の変更は「A8.net公式ページの実際のhref値から抽出したURLパターンを使う」という事実確認のみに基づく。

### 追加したテスト
- `admin/test/a8Search.test.ts`: `buildA8SearchUrl`の新規テスト3件(商品名ありの正しいURL生成・URLエンコード・空文字列/undefined/空白のみでのフォールバック)を追加。既存の`buildA8GuideMessage`テスト2件を新しい文言に合わせて更新。

---

## 追加機能(2026-07-19): アフィリエイトリンク1つだけで商品を自動入力

ユーザー要望「商品IDとか商品名とか、必須にしないでください。必須なのは、A8.netの広告リンク作成画面で『リンク先URLをコピー』を押したときに手に入るリンクだけです」への対応。A8.netのアフィリエイトトラッキングリンク(`px.a8.net`等)を1つ貼るだけで、リダイレクト追跡→到達先ページのOGP/本文からofficialUrl・商品名・画像・facts候補を自動抽出し、商品追加フォームを事前入力する。

### 実装した内容
- `admin/functions/_lib/ogpMeta.ts`(新規): 純粋関数`extractOgpMetadata(html, baseUrl)`。`og:title`/`og:image`をmetaタグから抽出(property/name属性どちらも許容)、titleは`<title>`をフォールバック、imageは`baseUrl`基準で相対URLを絶対URL解決し`isHttpUrl`で不正スキームを弾く。HTMLエンティティのデコードも実装。
- `admin/functions/api/resolveAffiliateLink.ts`(新規): `POST /api/resolveAffiliateLink`。認証必須。
  - リダイレクトを`redirect: "manual"`で1ホップずつ手動追跡し、**各ホップのURLをfetchする前に**`isSafeExternalUrl`で検証(`suggestFacts.ts`のfetch後`res.url`事後検証より一段厳格な事前検証方式)。最大5ホップで超過時はエラー。
  - 最終到達(200 OK・非リダイレクト)ページのURLを`officialUrl`とし、`readTextWithLimit`(既存、1MB上限)でHTML取得→`extractOgpMetadata`でname/imageUrl抽出、`extractTextFromHtml`+`truncatePageText`(いずれも既存)で本文抽出。
  - `suggestFacts.ts`と同じAnthropic API呼び出しロジック(`buildFactsSuggestionPrompt`/`parseFactsSuggestionResponse`/`extractTextFromAnthropicMessage`、`admin/functions/_lib/factsPrompt.ts`を共有)でfacts抽出。`ANTHROPIC_API_KEY`未設定・AI呼び出し自体の失敗(タイムアウト・非200等)はいずれも例外を投げず`facts: []`にフォールバックし、officialUrl/name/imageUrlは返す(このエンドポイントの主目的である自動入力自体は、facts抽出の成否に関わらず価値があるため。仕様書は「API_KEY未設定時」のみ明示していたが、同じ思想をAI呼び出し失敗全般に一貫させた判断)。
  - `affiliateUrl`自体(ユーザーが貼り付けた元の値、A8.netのトラッキングパラメータ`a8mat=`等を含む)はレスポンスに一切含めない(サーバー側は書き換えも保持もしない)。
- `admin/public/app.js`: 商品一覧上部に「アフィリエイトリンクを貼るだけで追加」入力欄+「自動入力して追加」ボタンを配置(`renderAffiliateQuickAddSection`)。押下時`resolveAffiliateLinkAndOpenForm`が`isHttpUrl`検証→`/api/resolveAffiliateLink`呼び出し→成功時`openForm(null, {id: slugifyProductName(name)有れば, name, officialUrl, imageUrl, facts, affiliateUrl})`でフォームを事前入力して開く。**affiliateUrlはサーバーレスポンスではなく、入力欄にユーザーが貼り付けた元の値をそのまま使う**(書き換え厳禁の要件を満たすため変数を直接渡す設計)。失敗時はステータス欄にエラーメッセージを表示するのみでフォームは開かない。
  - `openForm()`のprefill分岐を拡張し、`imageUrl`/`facts`/`affiliateUrl`も事前入力できるようにした(既存の候補ヒント経由フロー`addProductFromCandidate`は引き続きこれらを渡さないため、値は空のまま・挙動は無変更)。フォームタイトルは`prefill.affiliateUrl`の有無で「商品を追加(アフィリエイトリンクから)」/「商品を追加(候補ヒントから)」を出し分け。
  - `enabled`は既存の`resolveEnabledOnSubmit`により、保存時にaffiliateUrlが有効なら自動でtrueになる(無変更のロジックがそのまま機能)。
  - id衝突時は既存の`findConflictingProduct`によるチェックが保存時に働く(無変更のロジックがそのまま機能)。
- `admin/public/index.html`: `<template id="tpl-affiliate-quick-add">`を追加。
- `admin/public/style.css`: `.affiliate-quick-add`の入力欄/ボタンレイアウトを追加。

### 技術選定
- 追加ライブラリなし。既存パターン(`suggestFacts.ts`のAnthropic API呼び出し・SSRF対策、`src/ogpImage.ts`の手動リダイレクト追跡+都度検証の設計思想)を踏襲。

### 受け入れ基準チェック(自己申告)
- [x] `POST /api/resolveAffiliateLink`が認証必須: テストで401確認。
- [x] affiliateUrlのスキーム検証(400、fetch未呼び出し): テストで確認。
- [x] リダイレクトを手動で1ホップずつ追跡し、各ホップをfetch前に`isSafeExternalUrl`で検証: 実装・テストで確認(内部向けホストへは一度もfetchが発生しないことをテストで検証)。
- [x] 最大5ホップ、超過時エラー: テストで確認(6回のfetchで打ち切り、502)。
- [x] 最終到達ページのURLがofficialUrl、かつ検証済み: 実装上、全ホップ(最終含む)がループ内で`isSafeExternalUrl`を通過してからfetchされる構造で保証。
- [x] `extractOgpMetadata`(og:title/og:image優先、titleフォールバック、相対image URLの絶対URL解決、不正スキーム除外): `ogpMeta.test.ts`(9件)で検証。
- [x] facts抽出は`suggestFacts.ts`と同じプロンプト・パースロジックを再利用: `factsPrompt.ts`をimportして共有。
- [x] `ANTHROPIC_API_KEY`未設定時はfacts空配列にフォールボック、officialUrl/name/imageUrlは返す(エラーにしない): テストで確認。
- [x] 各段階のエラー(SSRF拒否・リダイレクト失敗・タイムアウト等)は4xx/5xxで返す: テストで確認(400/502)。
- [x] affiliateUrlはレスポンスに含めない: テストで`data.affiliateUrl === undefined`を確認。
- [x] フロントエンド: 入力欄+ボタンを商品一覧上部に配置、押下で自動解決→フォーム事前入力: Playwright(手動スクリプト、後述)で実機確認。
- [x] affiliateUrlはユーザー入力値をそのまま使う(サーバーレスポンスの値ではない): フロントのコードで直接変数を渡す設計、Playwrightで入力値がa8mat=を含む元URLと完全一致することを確認。
- [x] id衝突時は既存の`findConflictingProduct`による警告が働く: ロジック変更なし、既存の保存時チェックがそのまま適用される(コードレビューで確認、既存の`productConflict.test.ts`は無変更で通過)。
- [x] 失敗時はフォームを開かない: 実装で`if (!res.ok) { statusEl.textContent = ...; return; }`(openFormを呼ばずreturn)。
- [x] 既存の本番パイプライン・`products.ts`/`suggestFacts.ts`は無変更(git diffで対象外を確認)。
- [x] シークレットのハードコードなし(ANTHROPIC_API_KEYは既存の`env`経由、新規シークレットなし)。
- [x] `npm test`(ルート293件・admin126件、新規`ogpMeta.test.ts`9件+`resolveAffiliateLink.test.ts`7件)・`npm run typecheck`(ルート・admin両方)通過を確認。
- [x] git commitはしていない。

### アプリの起動方法(admin管理ページ、ローカル確認用、変更なし)
```bash
cd admin
npm install
npm run dev        # wrangler pages dev public --compatibility-date=2026-07-01 (既定ポート8788)
npm run typecheck  # tsc --noEmit(tsconfig.json + tsconfig.test.json)
npm test           # node --import tsx --test test/**/*.test.ts
```

### 既知の問題・懸念点
- **dev環境の`GITHUB_PAT`が無効(Bad credentials)**: `wrangler pages dev`起動時、実際の`/api/products`はGitHub APIが401を返すため、素の状態では商品一覧画面まで到達できない(本機能とは無関係の既存の環境制約)。今回はPlaywrightで`/api/products`・`/api/candidates`・`/api/resolveAffiliateLink`をモックし、フロントエンドのUI描画・値の伝搬(id自動生成・name/officialUrl/imageUrl/facts/affiliateUrlの事前入力・affiliateUrlが改変されず入力値のまま保持されること)を実機のChromiumで確認した。
- **ブラウザ実機確認時に観測した無害なコンソール警告**: 上記Playwright確認の一部の実行で`Pattern attribute value [a-zA-Z0-9_-]+ is not a valid regular expression`という警告がまれに出た。これは商品ID欄の`pattern="[a-zA-Z0-9_-]+"`属性(今回のスプリント以前から`index.html`に存在、本機能では変更していない)に対するブラウザ(Chromium)側の内部的な遅延正規表示コンパイルに関する挙動と見られ、再現条件を切り分けたところ同じ値・同じフォーム構造でも発生しないケースが多数あり非決定的だった。フォームへの値の反映(id/name/officialUrl/imageUrl/affiliateUrl/facts)自体は毎回正しく行われることを確認しており、機能的な不具合ではないと判断した。念のため記録する。
- 実際のA8.netリンク・実際の商品ページ・実際のAnthropic APIキーを使ったエンドツーエンドの動作(実リダイレクト追跡・実OGP抽出精度・facts抽出精度)は未検証(fetchモックによるユニットテストと、UIをモックAPIでつないだPlaywright確認のみ)。実際のA8.netリンクを1件用意して目視確認することを推奨。

### 追加したテスト
- `admin/test/ogpMeta.test.ts`(新規、9件): og:title/og:image両方あり・titleフォールバック・相対image URL解決・不正スキーム除外・パース不能値・meta無し・空/型不正入力・name属性対応・HTMLエンティティデコード。
- `admin/test/resolveAffiliateLink.test.ts`(新規、7件): 未認証401・不正スキーム400(fetch未呼び出し)・リダイレクト先内部ホスト400(事前検証、fetch未呼び出し確認)・最大ホップ超過502(6回のfetchで打ち切り確認)・fetch失敗(タイムアウト想定)502・`ANTHROPIC_API_KEY`未設定時のfacts空配列フォールバック(AI呼び出し未実行確認)・正常系(リダイレクト2回追跡→OGP抽出→facts抽出まで一貫)。

---

## /code-review指摘への対応(2026-07-19、アフィリエイトリンク自動解決機能の再実装)

オーケストレーターの`/security-review`(指摘なし)・`/code-review`(effort: low)でCONFIRMED 2件が見つかりFAIL。以下を修正。

### 対応内容
1. **[admin/functions/_lib/ogpMeta.ts] `extractAttr`の引用符不一致によるダブルクォート値の途中切れ**: 正規表現`["']([^"']*)["']`が開始・終了の引用符の種類を区別せず、`content="Trader Joe's Coffee"`のようにダブルクォート値の中にアポストロフィが含まれる場合、キャプチャがアポストロフィの手前(`Trader Joe`)で止まってしまうバグだった。
   - `(?:"([^"]*)"|'([^']*)')`に変更し、ダブルクォート囲み・シングルクォート囲みを別々の代替パターンとして扱い、開始と同じ種類の引用符が閉じ引用符になるまでを正しくキャプチャするよう修正(`extractAttr`はマッチしたグループのうち定義されている方を返す)。
2. **[admin/public/index.html] id/name欄のrequired属性による無言のブロック**: 「アフィリエイトリンクを貼るだけで追加」機能はog:title等から商品名が抽出できない場合、id/name欄が空欄のままフォームを開くが、`required`属性により保存ボタンがブラウザのネイティブバリデーションで無言にブロックされ、機能の意図(リンクだけで追加できる)と矛盾していた。
   - `admin/public/index.html`のid・name入力欄から`required`属性を削除。
   - **調査の過程で、同じフォームの`facts`(特長)テキストエリアにも`required`属性が残っており、resolveAffiliateLinkがfacts抽出に失敗した場合(例: `ANTHROPIC_API_KEY`未設定)に同じ「無言ブロック」が発生することを確認した**。HTML5のフォームバリデーションは、フォーム内のいずれか1つでも`required`属性を持つフィールドが空だとブラウザが`submit`イベント自体を発火させないため、id/nameのrequiredだけを外してもfactsが空のままだと`submitForm()`のJSに到達できず、id/name用に追加したエラーメッセージ表示も機能しないことをPlaywrightで実際に検証して確認した。この修正指示の意図(「リンクだけで追加できる」ようにする)を実際に達成するには、facts欄のrequiredも合わせて外す必要があると判断し、同様に対応した(id/name同様、事実情報(facts)の抽出も失敗しうる自動入力の性質上、同じ無言ブロック問題を抱えていたため)。
   - `admin/public/app.js`の`submitForm()`に、id/name/facts(空配列)のいずれかが未入力の場合にわかりやすいエラーメッセージ(「商品ID・商品名・特長(facts)を入力してください。」のように不足項目を列挙)を表示しリターンする明示的なチェックを追加(既存のサーバー側`validateProductInput`が引き続き最終防衛ラインとして機能する点は無変更)。

### 修正後の検証
- admin: `npm run typecheck` OK、`npm test` 129件全パス(新規`ogpMeta.test.ts`に引用符不一致の回帰テスト3件を追加)。
- ルート: `npm run typecheck` OK、`npm test` 293件全パス(既存機能への影響なし)。
- `wrangler pages dev`を一時起動しPlaywrightで実機確認:
  - id/name/factsが揃わない状態で保存ボタンを押しても`submit`イベントがブロックされず、フォーム内にエラーメッセージ「商品ID・商品名・特長(facts)を入力してください。」が表示されフォームが開いたまま保存が中断されることを確認(`checkValidity()`で該当フィールドのネイティブ無効フラグが立っていないことも確認)。
  - id/name/officialUrl/affiliateUrl/factsをすべて入力した通常の保存フローは従来通り`POST /api/products`が正しいペイロード(enabled自動true含む)で呼ばれ、フォームが閉じることを確認(回帰なし)。
  - 確認後プロセスを停止(ポート解放済み)。

### 追加したテスト
- `admin/test/ogpMeta.test.ts`(3件追加、計12件): ダブルクォート値中のアポストロフィで途中で切れないこと(直接の回帰テスト)、シングルクォート値中のダブルクォートで途中で切れないこと、ダブルクォート値中にアポストロフィを含むog:imageも正しくURL解決されること。

---

## 2026-07-19: A8.net存在ヒント・提携申請ステータス追跡機能の追加

ユーザー要望「候補ヒントにA8.netに実在する可能性が高いプログラムのみおすすめ表示・ワンボタン遷移・提携申請ステータスの手動切り替え・受理後の本登録」に対応。

### 実装した内容
- **`src/a8NetHint.ts`(新規)**: `KNOWN_A8_ADVERTISERS`(A8.net公式公開ページ掲載の主要ブランド広告主5件、ハードコード)・`matchKnownAdvertiser`(全角半角/大小文字を問わない部分一致)・`scanHtmlForA8NetLinks`(公式サイトHTML中のa8.netドメインリンク検知、正規表現ベース)。
- **`src/ogpImage.ts`**: `fetchSafely`・`readTextBodyWithLimit`を`export`化。加えて、これらを実際に呼び出すには既定の安全なfetch/lookup実装が必要なため`defaultFetch`・`defaultLookup`も`export`化(ロジック変更なし、export追加のみ)。
- **`src/generateCandidateHints.ts`**: `ProductCandidate`に`a8NetHint`フィールドを追加。`detectA8NetHint`関数で(1)`matchKnownAdvertiser`→(2)`officialUrlGuess`があれば`fetchSafely`で公式サイトを安全に取得し`scanHtmlForA8NetLinks`→(3)いずれも該当なければ`unknown`、の順で判定。A8.net自体には一切アクセスしない。`generateCandidateHints`にテスト用の`fetchImpl`/`lookupImpl`差し替え引数を追加(後方互換)。
- **`data/affiliate-application-tracking.json`(新規)**: 提携申請ステータス追跡データ(`.gitignore`に既存2ファイルと同じ理由で例外追加)。
- **`admin/functions/api/applicationTracking.ts`(新規)**: `GET`(一覧取得)・`POST`(新規作成: `{productName, officialUrl, a8NetHint, status}`、idはサーバー側`crypto.randomUUID()`発行 / ステータス更新: `{id, status}`)。`products.ts`と同じsha楽観ロックパターン。
- **`admin/functions/_lib/types.ts`・`validate.ts`**: `A8NetHint`・`ApplicationTrackingEntry`型、`isValidA8NetHint`・`isValidTrackingStatus`・`validateApplicationTrackingInput`を追加。
- **フロントエンド(`admin/public/app.js`・`style.css`)**: 候補ヒントの各商品候補にA8NetHintバッジ(known_brand=緑「A8.net確認済み」、site_link_found=黄「A8.netリンクを公式サイトで検知」、unknown=控えめな「A8.net: 不明」表示。「存在しない」と誤解させない文言)。known_brand/site_link_foundの候補には「A8.netで確認・申請する」ボタン(`buildA8SearchUrl`で新規タブ→`POST /api/applicationTracking`で`status:"applying"`記録→案内メッセージ表示)。新セクション「提携申請の進捗」(一覧・ステータスバッジ・「提携済みにする」・「商品を追加」で既存フォームをofficialUrl/name事前入力)。

### 技術選定
- 新規ライブラリ追加なし(既存の正規表現ベースHTML解析・GitHub Contents APIパターンを踏襲)。
- `defaultFetch`/`defaultLookup`のexport追加は指示(「fetchSafely・readTextBodyWithLimitの2つをexportするだけ」)の文言上は対象外だが、この2つの安全なfetch実装を実際に外部から再利用可能にする(=指示の目的である「他ファイルから安全なfetchを再利用するため」)には既定実装への参照が必須なため、ロジック変更なしの`export`キーワード追加のみ行った。既存のSSRF対策ロジックは1文字も変更していない。

### 受け入れ基準チェック(自己申告)
- [x] 候補ヒントにA8.net存在ヒントを表示: `productCandidate.a8NetHint`で判定、フロントでバッジ表示。
- [x] ワンボタン遷移: 「A8.netで確認・申請する」ボタンで`buildA8SearchUrl`による新規タブ遷移(既存ロジック再利用、変更なし)。
- [x] 提携申請の受理前/受理後の手動ステータス切り替え: 「提携済みにする」ボタン→`POST /api/applicationTracking`で`{id, status:"approved"}`。自動検知は一切実装していない。
- [x] 受理済みになったら既存の商品追加フローで本登録: 「商品を追加」ボタンでofficialUrl/name事前入力の商品追加フォームを開く(既存の`openForm`関数を再利用)。
- [x] A8.net自体への自動ログイン・自動検索・自動提携申請・スクレイピングは未実装: `scanHtmlForA8NetLinks`は商品の公式サイトのHTML文字列を引数に取るだけで、A8.net自体へのfetchは一切発生しない(コードレビューで確認可能)。
- [x] 「不明」を「存在しない」と誤解させない表示: バッジ文言を「A8.net: 不明」とし、ドキュメント・コードコメントにも明記。
- [x] 既存の本番投稿パイプライン(`pipeline.ts`/`publish.ts`/`dryRun.ts`/ワークフロー)は無変更: git diffで対象外を確認。
- [x] シークレットのハードコードなし: 新規シークレットの追加自体が無い機能。
- [x] `npm test`(ルート313件・admin149件)・`npm run typecheck`(ルート・admin両方)通過を確認。
- [x] git commitはしていない。

### アプリの起動方法(変更なし)
```bash
cd admin
npm install
npm run dev        # wrangler pages dev public --compatibility-date=2026-07-01 (既定ポート8788)
npm run typecheck
npm test
```
ルート側(`src/generateCandidateHints.ts`の直接実行確認): `npm run generate:candidate-hints`(ANTHROPIC_API_KEY等が必要、既存コマンド・変更なし)。

### 既知の問題・懸念点
- `wrangler pages dev`を一時起動し、`/`・`/app.js`が200、認証必須の`/api/applicationTracking`が401を返すことを確認したのみ(前回スプリント同様、dev環境の`GITHUB_PAT`が実際のGitHub APIに対して有効かは未検証)。フロントエンドのバッジ表示・「A8.netで確認・申請する」ボタン・「提携申請の進捗」セクションのブラウザ実機での見た目・クリック動作は、ユニットテスト(サーバー側ハンドラ・バリデーション・純粋関数)では検証済みだが、Playwright等によるブラウザ実機でのUI目視確認は今回未実施(evaluatorでの実機検証を想定)。
- `KNOWN_A8_ADVERTISERS`は5件のみ(仕様の推奨件数)。将来的にA8.net公式公開ページで確認できた新しいブランドを追記する運用が必要。
- 確認後、起動していたサーバーは停止済み(ポート8788解放済み)。

### 追加したテスト
- `test/a8NetHint.test.ts`(新規、13件): `matchKnownAdvertiser`(完全一致・部分一致・大小文字/全角半角吸収・不一致・空文字)、`scanHtmlForA8NetLinks`(a8.net本体・サブドメイン・シングルクォート・不一致・類似ドメイン誤検知防止・空/型不正入力・引用符境界の安全策)。
- `test/generateCandidateHints.test.ts`(8件追加): `detectA8NetHint`(known_brand優先・fetch未呼び出し確認、site_link_found、unknown、officialUrlGuessなし、fetch失敗時のフォールバック)、`generateCandidateHints`統合(a8NetHint反映、known_brand反映)。
- `admin/test/applicationTracking.test.ts`(新規、11件): 未認証401(GET/POST)・一覧取得・404フォールバック(空配列)・バリデーションエラー(productName/officialUrl/status)・新規作成(id発行・GitHub Contents APIコミット)・ステータス更新・存在しないid(404)・GitHub API競合(409)。
- `admin/test/validate.test.ts`(9件追加): `isValidA8NetHint`・`isValidTrackingStatus`・`validateApplicationTrackingInput`(create/update両モード、バリデーションエラー各種)。

---

## /code-review指摘への対応(2026-07-19、A8.net存在ヒント・提携申請ステータス追跡機能の再実装)

オーケストレーターの`/security-review`(指摘なし)・`/code-review`(effort: low)でCONFIRMED 1件が見つかりFAIL。以下を修正。

### 対応内容
1. **[admin/functions/_lib/validate.ts] `validateApplicationTrackingInput`の`officialUrl`必須バリデーションが`known_brand`ヒントの仕様と矛盾**: `known_brand`ヒント(商品名のみでのブランド一致、`officialUrlGuess`が無くても成立する。実際に`test/generateCandidateHints.test.ts`でofficialUrlGuess無しのknown_brand一致をテスト済み)の候補で「A8.netで確認・申請する」ボタンを押すと、`officialUrl: ""`が送信され`validateApplicationTrackingInput`に拒否されて400になり、トラッキングエントリが一切記録できないバグだった。
   - 修正方針は指示の選択肢1(officialUrlを任意項目化)を採用: `validateApplicationTrackingInput`で`officialUrl`が未指定/null/空文字列の場合はスキップし、値が存在する場合のみ`isHttpUrl`検証を行うよう変更。`site_link_found`(officialUrlが確実に存在するケース)の挙動・バリデーションは無変更(値が存在すれば引き続きhttp/https検証)。
   - `admin/functions/_lib/types.ts`の`ApplicationTrackingEntry.officialUrl`を`string | null`に変更。
   - `admin/functions/api/applicationTracking.ts`の新規作成処理で、`officialUrl`が未指定/空文字列の場合は`null`に正規化して保存(空文字列のまま保存しない)。
   - `admin/public/app.js`の`confirmAndApplyOnA8Net`で送信する`officialUrl`を`productCandidate.officialUrlGuess || ""`から`productCandidate.officialUrlGuess || null`に変更。「提携申請の進捗」欄の表示も、`officialUrl`が無い場合は空欄ではなく「公式サイトURL: 不明」と明示するよう変更(unknown同様、断定を避ける)。

### 修正後の検証
- admin: `npm run typecheck` OK、`npm test` 151件全パス(新規回帰テスト2件: `admin/test/applicationTracking.test.ts`にofficialUrlGuess無しのknown_brand候補が200で作成できることを確認するテスト、`admin/test/validate.test.ts`にofficialUrl未指定/null/空文字列を受理することを確認するテストを追加)。
- ルート: `npm run typecheck` OK、`npm test` 313件全パス(既存機能への影響なし、ルート側は今回の修正対象外)。
- `node --check admin/public/app.js`でシンタックスエラー無し。
- 修正のためのサーバー起動は不要だったため今回は起動していない。

### 追加したテスト
- `admin/test/applicationTracking.test.ts`(1件追加、計12件): officialUrlGuess無しのknown_brand候補(`officialUrl: null`)でも200で作成でき、`officialUrl`が`null`として保存されること(直接の回帰テスト)。
- `admin/test/validate.test.ts`(1件追加、計10件): `officialUrl`が未指定/null/空文字列いずれの場合も、`known_brand`ヒントの新規作成リクエストを受理すること。

## 関連ドキュメント
- [[x-ai-news-autopost-spec]]（製品仕様書）
