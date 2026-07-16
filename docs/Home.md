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
- [[sprint-1-brief|Sprint 1 brief]] / [[sprint-1-selfeval|自己評価]] / [[sprint-1-evaluation|評価レポート]] — PASS(F1: 急上昇AIニュースの収集・スコアリング)
- [[sprint-2-brief|Sprint 2 brief]] / [[sprint-2-selfeval|自己評価]] / [[sprint-2-evaluation|評価レポート]] — PASS(F2: 投稿対象の選定・既出回避)
- [[sprint-3-brief|Sprint 3 brief]] / [[sprint-3-selfeval|自己評価]] / [[sprint-3-evaluation|評価レポート]] — PASS(F3: 投稿本文の生成、実API疎通は未検証)

## 実行状況
- [dashboard.html](./dashboard.html) — リアルタイム進捗ダッシュボード(ブラウザで開く。30秒ごとに自動更新、「今すぐ更新」で即時更新も可能)

## 補足: NotebookLMで使う場合
このVault配下のMarkdown(特に[[project-memory]])をNotebookLMに手動でアップロードすると、Claude Codeのトークンを使わずに自然言語でQ&Aや音声概要を作れます。NotebookLMへの自動連携はしていません(公開APIが無いため)。
