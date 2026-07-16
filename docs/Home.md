---
tags: [home, moc]
---

# Home

spec-pipelineの全ドキュメントへの入口(MOC)です。プロジェクトフォルダ(または`docs/`)をObsidianのVaultとして開くと、ここから全スプリントのレポート・仕様書・進捗ダイジェストへwikilinkで辿れます。チャットでClaude Codeに「スプリント3は何をやった?」のように聞き直す代わりに、ここを見れば無料で(トークンを使わずに)確認できます。

## ダイジェスト
- [[project-memory]] — プロジェクト全体の進捗・技術選定の要約(常に最新化)

## 仕様
- [[x-ai-news-autopost-spec|X AIニュース自動投稿システム 製品仕様書]]

## スプリント
(未生成。各スプリントのgenerator/evaluatorレポートへのリンクがここに追記されていきます。画面を持たないプロダクトのためプレビュー画像は対象外です)

## 実行状況
- [dashboard.html](./dashboard.html) — リアルタイム進捗ダッシュボード(ブラウザで開く。30秒ごとに自動更新、「今すぐ更新」で即時更新も可能)

## 補足: NotebookLMで使う場合
このVault配下のMarkdown(特に[[project-memory]])をNotebookLMに手動でアップロードすると、Claude Codeのトークンを使わずに自然言語でQ&Aや音声概要を作れます。NotebookLMへの自動連携はしていません(公開APIが無いため)。
