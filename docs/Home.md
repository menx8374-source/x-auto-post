---
tags: [home, moc]
---

# Home

spec-pipelineの全ドキュメントへの入口(MOC)です。プロジェクトフォルダ(または`docs/`)をObsidianのVaultとして開くと、ここから全スプリントのレポート・仕様書・進捗ダイジェストへwikilinkで辿れます。チャットでClaude Codeに「スプリント3は何をやった?」のように聞き直す代わりに、ここを見れば無料で(トークンを使わずに)確認できます。

## ダイジェスト
- [[project-memory]] — プロジェクト全体の進捗・技術選定の要約(常に最新化)

## 仕様
（未生成。plannerが仕様書を作成すると自動的にリンクが追加されます。画面を持つプロダクトの場合は画面ワイヤーフレーム(wireframes.html)へのリンクも、バックエンド等を導入するスプリントがあれば技術選定メモ(architecture.md)へのリンクも、ここに追加されます）

## スプリント
（未生成。各スプリントのgenerator/evaluatorレポートへのリンクがここに追記されていきます。画面を持つプロダクトでPASSしたスプリントには、進捗確認用のプレビュー画像(sprint-N-preview-*.png)へのリンクも追加されます）

## 実行状況
- [dashboard.html](./dashboard.html) — リアルタイム進捗ダッシュボード（ブラウザで開く。30秒ごとに自動更新、「今すぐ更新」で即時更新も可能）

## 補足: NotebookLMで使う場合
このVault配下のMarkdown(特に[[project-memory]])をNotebookLMに手動でアップロードすると、Claude Codeのトークンを使わずに自然言語でQ&Aや音声概要を作れます。NotebookLMへの自動連携はしていません(公開APIが無いため)。
