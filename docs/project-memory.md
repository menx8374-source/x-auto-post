---
tags: [project-memory]
status: active
---

# プロジェクトメモリ

このファイルはspec-pipelineオーケストレーターがスプリント境界のたびに更新する、プロジェクト全体の要約ダッシュボードです。要約であっても**受け入れ基準・評価基準など判定に関わる原文は改変せず転記**し、意見や推測で薄めません。

- Obsidianでこのフォルダを開いている場合、[[Home]] から辿れます。
- ここに書かれた内容をNotebookLM等に手動でアップロードすれば、Claude Codeのトークンを使わずにQ&Aや要約が作れます(自動連携はしていません)。

## 概要
X(旧Twitter)上で、Web上で今まさに注目度が急上昇している最新のAIニュースを自動で選び、要約したポストを1日3回の高インプレッション時間帯に自動投稿するバックエンド自動化システム。文字数制限を厳守し、収まらない場合はスレッド分割し、元記事リンクを別ツイートとして付与する。運用者は自分のXアカウントを運用する個人1名。仕様書: [docs/spec/x-ai-news-autopost-spec.md](spec/x-ai-news-autopost-spec.md)

## 対象プラットフォーム / 技術選定
- 対象プラットフォーム: `web`(画面を持たないバックエンド自動化)
- 技術選定: 未定(generatorが最初にarchitecture.mdを作成した時点でこの節を更新)

## スプリント進捗
| Sprint | 目標 | 状態 | 備考 |
|---|---|---|---|
| 1 | 急上昇AIニュースを収集・スコアリングできる(F1) | PASS(コミット6ba9b9f) | Node.js+TypeScript、無認証の無料情報源(HN Algolia/Reddit公開JSON/RSS4種)のみ使用。試行1でevaluator PASS後、/code-reviewでCONFIRMEDな正しさのバグ3件(AI関連正規表現の境界・RSS日付欠損時の鮮度誤り・Union-Find推移的クラスタ混入)が見つかりFAIL・再実装、試行2で全指摘修正しPASS。技術選定はdocs/spec/x-ai-news-autopost-architecture.md参照 |
| 2 | 投稿対象1件を既出回避して選定できる(F2) | PASS(コミットfe21e2a) | URL既出+話題類似度(Jaccard閾値共有)で既出回避。security-review/code-reviewとも指摘なし |
| 3 | 選定記事から投稿本文を生成できる(F3) | PASS(コミット1c13ad5) | @anthropic-ai/sdk使用。ANTHROPIC_API_KEY未設定のため実API疎通は未検証(モック検証・エラーパスは確認済み)。security-review/code-reviewとも指摘なし |
| 4 | 文字数厳守とスレッド分割・リンクツイート生成(F4,F5) | PASS(コミットf8f89cd) | 半角1/全角2換算・文/句読点/単語単位分割。試行1でcode-reviewがCONFIRMEDバグ(全角疑問符？の文区切り漏れ)を検出→修正→試行2でPASS |
| 5 | ドライランで投稿予定の全ツイートをプレビュー(F11) | PASS(コミットf616a16) | 共通パイプライン(collect→select→generate→thread)+差し替え可能publishステップ。security-review/code-reviewとも指摘なし |
| 6 | Xへ実際にスレッド投稿できる(F6) | PASS(コミットa6871e6) | twitter-api-v2使用。X API認証情報未設定のため実疎通は未検証(モック検証・返信連結・429リトライ上限・部分失敗記録は確認済み)。security-review/code-reviewとも指摘なし |
| 7 | 投稿状態管理と冪等性・不発リカバリ(F9) | PASS(コミット158aac3) | 試行1でcode-reviewがCONFIRMEDバグ(toDateKeyがUTC基準でJST日境界をまたぐと二重投稿・誤スキップ)を検出→JST(UTC+9)基準に修正→試行2でPASS |
| 8 | 1日3回の固定時刻ロジックと投稿枠判別(F7) | PASS(コミットa3368d5) | 投稿枠 JST 07:30/12:15/21:00、深夜跨ぎルックバック対応。試行1でcode-reviewがCONFIRMEDバグ(冪等性判定が実行時刻基準でscheduledAt基準でなかった)を検出→修正→試行2でPASS。試行2後の追加指摘(postedAtとscheduledAtのJST日ズレ)は具体的な日時計算で反証済み(3枠とも深夜0時から3時間以上離れており、リトライ方針の上限(最大60秒待機×2回)を踏まえると実際には到達不可能) |
| 9 | 外部cronサービスからworkflow_dispatchで起動(F8) | PASS(コミット1adc6c6) | `.github/workflows/post.yml`+`docs/cron-setup.md`。試行1でsecurity-reviewがHigh(PAT過剰権限)、試行2でsecurity-reviewがCONFIRMEDなHigh(GHAスクリプトインジェクション: inputsのrun:直接展開)を検出→both修正→試行3でPASS(リトライ上限3到達も最終的にPASS確定) |
| 10 | ログ・エラー通知・設定管理を整えE2Eで通す(F10,F12) | PASS(コミットce8dd0b) | src/config.ts(設定一元化)・src/notify.ts(GitHub Actionsジョブサマリー+任意Webhook)・logger.tsマスキング強化。試行1でcode-reviewがCONFIRMEDバグ2件(循環配列クラッシュ・重複参照データ欠落)を検出→修正→試行2でPASS。Sprint 8由来のflakyテストもこのスプリントで修正済み。全10スプリント完了

## 既知の課題・要人手介入
- **外部サービス依存(事前確認結果、ユーザー回答済み)**:
  - Anthropic API(Claude)キー: 利用者が「今すぐ用意する」と回答。Sprint 3で使用。未設定でもエラーハンドリングで安全に動作させ、キーが揃い次第実接続で確認する。
  - cron-job.org(外部無料cron)のアカウント登録・ジョブ設定: 利用者が「今すぐ用意する」と回答。Sprint 9で手順書を提供し、実際の登録操作はユーザーが行う。
  - X API認証情報(API Key/Secret, Access Token/Secret)・GitHub Personal Access Token: 過去の類似プロジェクト(x-auto-post)のGitHub Actions Secretsに既に登録済みのものを再利用する予定(ユーザー回答)。Sprint 6・Sprint 9で使用。
- **配置先リポジトリ(ユーザー確定済み)**: 新システムのコードは既存の `github.com/menx8374-source/x-auto-post` を置き換える形で配置する方針。Sprint 9の手順書はこのリポジトリのworkflow_dispatchエンドポイントを前提に記述する。実際にこのリモートへpushするタイミングはユーザーへの確認を挟んで行う(既存リポジトリの中身を置き換える操作のため)。
- **X API利用規約・レート制限**: 無料/Basic等のティアにより投稿数上限が異なり、1日3回×スレッドの投稿量が無料枠の月間上限に抵触しうる。Sprint 6で上限超過時はエラーとして扱い諦めて記録する設計とする(規約違反の連投はしない)。
- **Sprint 8由来の既知の不具合(未修正、Sprint 10で対応予定)**: `test/pipeline.test.ts`のF9回帰テスト1件が実行時の壁時計時刻に依存してflaky(不安定)。テストの時刻計算方法に設計上の欠陥があり、実行タイミングによっては失敗する。本番コードの不具合ではなくテスト自体の問題。Sprint 10のE2E整備時に修正すること。
- **実GitHub Actions環境での検証完了(2026-07-17)**: `github.com/menx8374-source/x-auto-post`のmainブランチへforce push(旧Pythonボット実装を置き換え)し、必要なSecretsが既に登録済みであることを確認(ANTHROPIC_API_KEY含む)。`gh workflow run`で`workflow_dispatch`を手動発火しドライラン検証したところ、以下2件の実環境限定バグを発見・修正・再検証済み:
  - `src/config.ts`の`POST_LANGUAGE`/`POST_TONE`検証が空文字列を他の設定項目と矛盾する形でエラー扱いしており、GitHub Actionsの`env:`ブロック経由で空文字列が渡ると起動時に`ConfigError`で失敗していた(ローカル`.env`では該当キー自体が無い=undefinedのため再現しなかった)→他のパーサーと同じ`if (!raw)`方式に統一して修正。
  - `src/generatePost.ts`の`DEFAULT_MODEL`が廃止済みモデルID(`claude-3-5-haiku-20241022`)にハードコードされており、実際にAnthropic APIへ疎通した際に404エラーになっていた→`claude-haiku-4-5-20251001`(Haiku 4.5)に更新。
  - 両修正後、`gh workflow run post.yml -f slot=auto -f mode=dryrun`で収集(206件)→選定→Claude生成→スレッド分割→リンク付与までE2Eで成功を実機確認(Xへの実投稿は未実施)。
- **実投稿テスト完了(2026-07-17)**: ユーザー承認のもと`mode=post`で実際にXへスレッド投稿(2ツイート)を実行し成功。ツイートID記録・履歴反映も正常に確認。
- **機能追加: バズりやすい文体+OGP画像添付(2026-07-17)**: ユーザー依頼により、投稿文面のフック強化(既存の事実正確性・丸写し禁止等の制約は維持)と、元記事のOGP画像を本文ツイート(1件目)にのみ添付する機能を追加(`src/ogpImage.ts`)。仕様書のNon-Goals「画像添付」をユーザーの明示指示で上書き。
  - security-reviewで2ラウンドの指摘: (1) 取得先URLへのホスト/IP制限が無くSSRF可能(High、DNS/IP範囲検証で修正)→ (2) その検証がDNSリバインディングでTOCTOUバイパス可能(High、undiciのカスタムlookupで検証と実接続の名前解決を同一化し修正)。3回目の再レビューでCONFIRMED-FIXEDを確認。
  - 実GitHub Actions環境のドライランでOGP画像取得(Capital One記事のog:image)・バズり調整済み文面生成ともに実機成功を確認済み。
- **機能追加: 日本語ソース優先+OGP画像必須(2026-07-17〜18)**: ユーザー依頼により2点追加。(1)日本語AIニュースソース(ITmedia AI+/AINOW/AIDB)を追加し、選定時に日本語ソースを優先(日本語有効候補が無い場合のみ英語ソースへフォールバック)。(2)選定ロジックにOGP画像が実際に取得できることを必須条件として追加(画像なし候補は棄却し次点を試行、全滅時はスキップ)。実GitHub Actions環境のドライランで、日本語ソース(AIDB)からOGP画像付きで正しく選定されることを実証済み。
- **cron-job.org連携: 3ジョブ全て実機動作確認完了(2026-07-17)**: ユーザーが朝/昼/夜の3ジョブを作成し、いずれもテスト実行で実際にGitHub Actionsが起動・Xへ実投稿されることを確認済み(`204 No Content`、ツイートID記録も正常)。「朝」ジョブの実行では日本語ソース(AIDB)選定+OGP画像のX投稿への実添付も確認できた。以降、毎日自動でJST 07:30/12:15/21:00に投稿される運用体制が整った。
- **機能追加: マルチアカウント基盤+リプライ誘発強化(2026-07-18)**: ユーザー依頼「複数ユーザー機能・収益化機能」を、ヒアリングの結果「①開発者自身の複数Xアカウントをジャンル別に同一システムで運用」「②X Premiumのリプライ欄広告収益分配を狙う既存方針の強化(新規課金機能ではない)」と明確化して実装。`src/accounts.ts`のAccountProfile抽象化により、既存のAIニュースアカウント(id: `ai-news`)は既存のenv変数名・履歴ファイルをそのまま使い後方互換性を維持。新規アカウント追加時は`credentialsEnvSuffix`で環境変数を分離(`X_API_KEY__<SUFFIX>`)。2つ目以降の具体的なジャンルは未定(基盤のみ実装)。security-review/code-reviewとも指摘なし(軽微な懸念2件のみ、非ブロッカー)。
- **アフィリエイト収益化: 方針確定・パイプライン基盤実装完了(2026-07-18)**: 景品表示法リスクをユーザーに共有した上で「事実ベース(商品のfactsフィールドのみ)+【PR】表記必須、実体験の捏造はしない」方針で合意。`data/affiliate-products.json`(空、ユーザーが手動で商品・アフィリエイトリンクを追加)・専用の選定(ローテーション、同一商品最大3回)・生成(【PR】強制・体験談禁止)・投稿枠(19:00 JST目安)・専用ワークフロー(`post-affiliate.yml`)を実装。AIニュース側(履歴・スケジュール・冪等性)とは完全に独立。security-review/code-reviewとも指摘なし。
- **アフィリエイト実投稿・障害対応完了(2026-07-18)**: 商品「ZENCHORD1(AI議事録イヤホン)」をユーザー承認済みの公式情報のみで登録し実投稿を試行。X APIが`px.a8.net`(A8.netのトラッキング/リダイレクトドメイン)を含むツイートを「invalid URL」として一律拒否する問題を発見(URLエンコードの問題ではなくドメイン自体の拒否と実証)。
  - 調査・復旧の過程で障害対応用の管理CLI(`src/adminTweetTool.ts`、`.github/workflows/admin-tools.yml`、workflow_dispatchのみ・schedule無し)を追加し、リンク欠落で不完全になった3スレッド(計6ツイート)を削除。
  - `.github/workflows/post-affiliate.yml`に手動テスト用の`force`入力(時間帯チェックのみスキップ、冪等性・ローテーション上限は維持)を追加。
  - 当初TinyURL(無認証API)でリンク短縮する方式で対応し実投稿に成功したが、ユーザーからTinyURLの「Preview」ページ(非推奨API使用が原因)がクリック時に挟まる問題を指摘され、**GitHub Pages(`docs/go/<商品ID>.html`、既存の`docs/`をソースとするPages設定を流用)上の自前静的リダイレクトページ方式に変更**。TinyURL関連コード(`src/urlShortener.ts`)は削除。新商品追加時は`npm run generate:affiliate-redirects`の実行(リダイレクトページ生成・コミット)が必要になった。
  - GitHub Pages方式の実装で4ラウンドのレビューを経て、Stored XSS(`<script>`要素内の`</script>`早期終了)・URLスキーム未検証(`javascript:`実行)・選定ロジックとページ生成の検証基準の不整合(リンク切れツイートのリスク)・`product.id`のパストラバーサルを順次検出・修正。
  - Playwright実機検証で、警告ページを経由せず商品ページへ直接リダイレクトすることを確認済み。
- **アフィリエイト投稿への画像添付機能・実投稿検証完了(2026-07-18)**: ユーザー依頼「商品・サービスのメイン画像をスレッドではなく1件目の投稿にのみ添付」を実装。`affiliate-products.json`に`imageUrl`(任意)フィールドを追加し、公式サイトに`og:image`が無い商品(ZENCHORD1)向けに手動指定できるようにした。パイプラインは選定→生成→[画像: `imageUrl`があればダウンロード、無ければ公式URLからOGP画像取得]→スレッド組み立て→投稿の順で、画像取得失敗時も投稿自体は継続する(AIニュース側と異なり画像は選定必須条件にしない)。アップロード済みメディアIDは1件目(本文)ツイートのみに添付し、リンクツイートには付けない。security-review/code-reviewとも指摘なし。
  - 実投稿での検証のため、当日分の冪等性チェックを一時的にテストデータでバイパスして`mode=post force=true`で実投稿を実施。Playwright実機確認で画像がXの投稿(1件目のみ)に正しく表示されることを確認済み。検証後、テスト目的でずらしていた過去2件の`postedAt`は本来の日付に復元済み(本番データの正確性を維持)。
- **残タスク**:
  1. 商品の追加登録(ユーザー対応、実在のアフィリエイトプログラム登録が前提のため代行不可)。
  2. 管理用Webページ(GitHub OAuthログイン・Cloudflare Pages想定、スマホから本人のみアクセス可)は未着手。AIニュース収集結果からのアフィリエイト候補提案機能も含む。着手にはCloudflareアカウント登録・GitHub OAuth App登録・専用PATの発行というユーザー側の追加準備が必要になる見込み。
- **Sprint 3: 実API疎通が未検証**: `.env`にANTHROPIC_API_KEYがまだ設定されていない(ユーザーが用意中)。モック検証・エラーハンドリングパスは確認済みで機能的にはPASSだが、実際の生成品質(誇張・虚偽の有無等)はキー設定後にユーザー自身で`npm run generate`を実行して確認することを推奨。
- **Sprint 6: 実X API疎通が未検証**: `.env`にX_API_KEY等が未設定(過去プロジェクトx-auto-postのGitHub Secrets再利用予定だがローカル`.env`には未反映)。モック検証・返信連結・429リトライ・部分失敗記録は確認済みで機能的にはPASSだが、実際にXへ投稿できるかはキー設定後にユーザー自身で`npm run post`を実行して確認することを推奨。
- **Sprint 7で残った軽微な指摘(非ブロッカー、PASS済み)**: (1) `test/postHistory.test.ts`の「誤スキップ防止」テストが、JST変換ロジックが将来再び壊れても検知できない弱いアサーションになっている(修正版JSTロジックと未修正UTC版ロジックのどちらでも同じ結果を返すテストケースのため)。より厳密なテストケース(UTC日は同一だがJST日が異なるペア)への差し替えを推奨。(2) `publish.ts`(本番cron経路)がスキップ時にexitCode=1を返さない(dryRun.tsとの非対称、受け入れ基準に規定はなく実害なし)。
- **Sprint 1で残った軽微な指摘(非ブロッカー、PASS済み)**: (1) Reddit 3ソースは検証環境のIPから常時403(通信失敗として正しくハンドリング済みだが動作未確認)。(2) 「話題の伸び」は複数ソース言及数で近似しており真の時系列言及増加率は未追跡。(3) `resolvePublishedAt`のisoDate分岐が未検証(現状rss-parser経由では到達不可能な理論上の懸念)。(4) `src/collectNews.ts`の`--inject-decoy`検証用フラグが本番コードパスに残置、`src/sources/rss.ts`が独自fetchでrss-parserの`parseURL`を使っていない、`reddit.ts`/`rss.ts`でUser-Agent文字列が重複、`src/collectNews.ts`/`src/http.ts`/`src/sources/*.ts`に単体テストが無い(aiFilter/scoringのみテスト済み) — いずれも/code-reviewでMedium/Low相当・簡潔化提案として指摘されたが、PASSをブロックする「正しさのバグ」ではないため記録のみ。
