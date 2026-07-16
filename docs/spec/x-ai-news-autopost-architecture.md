---
tags: [architecture]
status: active
---

# X AIニュース自動投稿システム 技術選定(architecture)

このファイルは領域ごとに「現在の決定」のみを保持する(変遷は残さず上書きする)。

## バックエンド実行基盤(Sprint 1で選定)

- **候補として検討したもの**: Node.js + TypeScript / Python
- **選定結果**: Node.js (v24) + TypeScript(`tsx`で直接実行、ビルドステップなし)
- **理由**:
  - 実行環境の制約: Windows上で管理者権限インストール不要にセットアップ可能(`npm install`のみ)。Sprint 6以降で使うX API v2クライアント(`twitter-api-v2`等)・Sprint 9のGitHub Actionsワークフローも同一言語で完結でき、CI(Ubuntu runner)でも追加ツールチェーン不要。
  - 運用コスト: ランタイム自体は無料。ローカル/GitHub Actions上で完結し、追加の有料インフラなし。
  - Node.js標準の`fetch`とテストランナー(`node:test`)が使えるため外部依存を最小化できる。
- **テスト**: Node.js標準の`node --test`(`tsx`経由でTS実行)。追加のテストフレームワーク(Jest/Vitest)は導入せず依存を絞った。

## F1: AIニュース収集ソース(Sprint 1で選定)

- **候補として検討したもの**: 有料ニュースAPI(NewsAPI.org有料枠、GDELT等) / 無料公開ソースの組み合わせ
- **選定結果**: 認証不要の無料公開ソースのみを使用する構成
  - Hacker News (Algolia HN Search API `hn.algolia.com`) — 無料・無認証。points/num_commentsをエンゲージメント(話題性)シグナルとして利用。
  - Reddit 公開JSONエンドポイント(`www.reddit.com/r/<subreddit>/top.json`) — 無料・無認証。score/num_commentsをエンゲージメントシグナルとして利用。ただし環境によってはIPベースで403 Blockedになることがあり、その場合は失敗ソースとしてログに記録し処理は継続する(想定内の挙動として設計済み)。
  - RSSフィード(TechCrunch AI, VentureBeat AI, The Verge AI, Google News AI検索RSS) — 無料・無認証。`rss-parser`(npm, 実績のある軽量ライブラリ)でパース。
- **理由**:
  - 運用コスト: すべて無料枠ではなく完全無料・APIキー不要。将来的な課金リスクがない。
  - 実行環境の制約: 認証情報の発行・管理が不要なため、Sprint 1の「外部認証情報を必要としない」制約に合致する。
- **話題性(急上昇)シグナルの設計**: 単一ソースのエンゲージメント数値に加え、複数ソース間でタイトルの類似度クラスタリング(キーワードのJaccard類似度)を行い、同一トピックを報じているソース数(mentionCount)を話題性スコアに反映する。

## 依存ライブラリ

- `rss-parser` (npm, dependencies): RSS/AtomフィードのXMLパース。保守されており広く使われている。
- `typescript`, `tsx`, `@types/node` (devDependencies): TypeScript実行・型チェック用。
