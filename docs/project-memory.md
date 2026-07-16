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
| 8 | 1日3回の固定時刻ロジックと投稿枠判別(F7) | 未着手 | 投稿枠 JST 07:30/12:15/21:00 |
| 9 | 外部cronサービスからworkflow_dispatchで起動(F8) | 未着手 | GitHub PAT・cron-job.org設定が必要 |
| 10 | ログ・エラー通知・設定管理を整えE2Eで通す(F10,F12) | 未着手 | — |

## 既知の課題・要人手介入
- **外部サービス依存(事前確認結果、ユーザー回答済み)**:
  - Anthropic API(Claude)キー: 利用者が「今すぐ用意する」と回答。Sprint 3で使用。未設定でもエラーハンドリングで安全に動作させ、キーが揃い次第実接続で確認する。
  - cron-job.org(外部無料cron)のアカウント登録・ジョブ設定: 利用者が「今すぐ用意する」と回答。Sprint 9で手順書を提供し、実際の登録操作はユーザーが行う。
  - X API認証情報(API Key/Secret, Access Token/Secret)・GitHub Personal Access Token: 過去の類似プロジェクト(x-auto-post)のGitHub Actions Secretsに既に登録済みのものを再利用する予定(ユーザー回答)。Sprint 6・Sprint 9で使用。
- **配置先リポジトリ(ユーザー確定済み)**: 新システムのコードは既存の `github.com/menx8374-source/x-auto-post` を置き換える形で配置する方針。Sprint 9の手順書はこのリポジトリのworkflow_dispatchエンドポイントを前提に記述する。実際にこのリモートへpushするタイミングはユーザーへの確認を挟んで行う(既存リポジトリの中身を置き換える操作のため)。
- **X API利用規約・レート制限**: 無料/Basic等のティアにより投稿数上限が異なり、1日3回×スレッドの投稿量が無料枠の月間上限に抵触しうる。Sprint 6で上限超過時はエラーとして扱い諦めて記録する設計とする(規約違反の連投はしない)。
- **Sprint 3: 実API疎通が未検証**: `.env`にANTHROPIC_API_KEYがまだ設定されていない(ユーザーが用意中)。モック検証・エラーハンドリングパスは確認済みで機能的にはPASSだが、実際の生成品質(誇張・虚偽の有無等)はキー設定後にユーザー自身で`npm run generate`を実行して確認することを推奨。
- **Sprint 6: 実X API疎通が未検証**: `.env`にX_API_KEY等が未設定(過去プロジェクトx-auto-postのGitHub Secrets再利用予定だがローカル`.env`には未反映)。モック検証・返信連結・429リトライ・部分失敗記録は確認済みで機能的にはPASSだが、実際にXへ投稿できるかはキー設定後にユーザー自身で`npm run post`を実行して確認することを推奨。
- **Sprint 7で残った軽微な指摘(非ブロッカー、PASS済み)**: (1) `test/postHistory.test.ts`の「誤スキップ防止」テストが、JST変換ロジックが将来再び壊れても検知できない弱いアサーションになっている(修正版JSTロジックと未修正UTC版ロジックのどちらでも同じ結果を返すテストケースのため)。より厳密なテストケース(UTC日は同一だがJST日が異なるペア)への差し替えを推奨。(2) `publish.ts`(本番cron経路)がスキップ時にexitCode=1を返さない(dryRun.tsとの非対称、受け入れ基準に規定はなく実害なし)。
- **Sprint 1で残った軽微な指摘(非ブロッカー、PASS済み)**: (1) Reddit 3ソースは検証環境のIPから常時403(通信失敗として正しくハンドリング済みだが動作未確認)。(2) 「話題の伸び」は複数ソース言及数で近似しており真の時系列言及増加率は未追跡。(3) `resolvePublishedAt`のisoDate分岐が未検証(現状rss-parser経由では到達不可能な理論上の懸念)。(4) `src/collectNews.ts`の`--inject-decoy`検証用フラグが本番コードパスに残置、`src/sources/rss.ts`が独自fetchでrss-parserの`parseURL`を使っていない、`reddit.ts`/`rss.ts`でUser-Agent文字列が重複、`src/collectNews.ts`/`src/http.ts`/`src/sources/*.ts`に単体テストが無い(aiFilter/scoringのみテスト済み) — いずれも/code-reviewでMedium/Low相当・簡潔化提案として指摘されたが、PASSをブロックする「正しさのバグ」ではないため記録のみ。
