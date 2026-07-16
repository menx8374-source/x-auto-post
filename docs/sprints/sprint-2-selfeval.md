---
tags: [sprint-selfeval]
sprint: 2
---

# Sprint 2 自己評価レポート

## 実装した内容
- `src/urlUtil.ts`: `normalizeUrl`を共通化(F1のURL重複排除とF2の既出判定で同一基準を使うため`src/collectNews.ts`からも共通利用するよう変更)。
- `src/types.ts`: `PostHistoryEntry`型を追加(url・normalizedUrl・title・score・selectedAt)。Sprint 7でフィールド追加拡張しやすいフラットな形。
- `src/postHistory.ts`: 選定履歴の永続化(JSON配列、`data/history/post-history.json`)。`loadHistory`(ファイル無ければ空配列、壊れていればエラー)・`appendHistoryEntry`(追記)。
- `src/selectPost.ts`:
  - `selectNextPost(candidates, history)`: 純粋関数。既出URL(正規化一致)・実質同一記事(タイトルのJaccard類似度、`scoring.ts`の`CLUSTER_SIMILARITY_THRESHOLD`を再利用)・スコアしきい値(`MIN_SELECTION_SCORE = 0`)で除外し、残った候補から最高スコアの1件を選定。有効候補0件ならselected=nullで理由文字列を返す。
  - CLI(`npm run select`): `collectAndScoreNews()`(Sprint1)で収集 → 履歴読み込み → 選定 → ログ出力 → 履歴へ追記(`--dry`で追記スキップ)→ `data/output/latest-selection.json`へ結果保存。
  - `--from-cache`フラグ: 直近の`npm run collect`出力(`data/output/latest-candidates.json`)を使い再収集せず選定する(デモ・検証の再現性のため)。
- `src/scoring.ts`: `extractKeywords`/`jaccardSimilarity`/`CLUSTER_SIMILARITY_THRESHOLD`をexportし、F2の実質同一記事判定で再利用(閾値・類似度計算のロジック重複を避けた)。
- `.gitignore`に`data/history/`を追加(実行時状態ファイルのため、`data/output/`と同様に追跡対象外)。
- `package.json`に`select`スクリプト追加。
- `README.md`に`npm run select`の使い方・履歴ファイルの説明を追記。
- テスト: `test/postHistory.test.ts`(履歴の読み書き)、`test/selectPost.test.ts`(選定ロジック、既出URL除外・実質同一記事除外・しきい値除外・0件スキップ・同日複数回実行のシナリオ)。

## 技術選定
- 履歴の永続化形式: JSON配列ファイル(`data/history/post-history.json`)。Sprint 1の`data/output/latest-candidates.json`と同じくファイルI/Oのみで完結し追加の依存(DB等)が不要。フィールドをフラットに保ち、Sprint 7でslot/status/tweetIds等を追加する拡張余地を確保。
- 実質同一記事の判定は新規ロジックを増やさず、Sprint 1の`scoring.ts`にあるタイトルのJaccard類似度クラスタリング(`CLUSTER_SIMILARITY_THRESHOLD = 0.4`)をexportして再利用(同じ「同一トピック」の定義を使うことで一貫性を確保)。

## 受け入れ基準チェック(自己申告)
- [x] Sprint1の候補リストから投稿対象1件が確定し、タイトル・URL・選定スコアがログに出る: `npm run select -- --from-cache`実行で確認(ログに`title`/`url`/`score`/`reason`が出力される)。
- [x] 直前に投稿済みとして記録したURLは次回選定で選ばれない: `npm run select -- --from-cache`を連続2回実行し、1回目で選ばれたURLが履歴に記録され、2回目の実行で除外され別記事が選ばれることを実機確認。
- [x] 有効候補が0件のとき、投稿対象なしとして理由付きでスキップされる: 全候補を履歴に事前投入した状態で実行し、`[WARN] no eligible candidate to post, skipping`と除外内訳を含む理由文字列が出力されることを確認(自動テストでも同シナリオを検証)。
- [x] 同一日に同じ記事が2回選ばれない(擬似的に同日2回実行して確認): 上記の連続2回実行に加え、`test/selectPost.test.ts`の「同一日に2回選定」「同日3回実行し候補が尽きると3回目はスキップ」テストで自動検証。

## アプリの起動方法
```bash
cd c:\ClaudeProjects\XAutoMode
npm install

# F1: 候補収集(Sprint1、事前に実行しておくとキャッシュが使える)
npm run collect

# F2: 収集済み候補から投稿対象1件を既出回避して選定
npm run select
# 再収集せずキャッシュ(data/output/latest-candidates.json)から選定(デモ・繰り返し検証向け)
npm run select -- --from-cache
# 選定しても履歴に記録しない(繰り返し検証で履歴を汚さない)
npm run select -- --from-cache --dry

# テスト・型チェック
npm test
npm run typecheck
```
選定結果は`data/output/latest-selection.json`、選定履歴は`data/history/post-history.json`に保存される(いずれも実行時state、gitignore済み)。画面を持たないバックエンドCLIのためサーバー起動は不要。

## 既知の問題・懸念点
- `--from-cache`を使わず毎回ライブ収集(`npm run select`のデフォルト)する場合、外部ニュースソースの内容が実行の度に変化しうるため、「同日2回実行で同じ記事が選ばれない」ことの再現性はネットワーク状況に依存する。今回の自己確認は`--from-cache`で固定候補セットを使い確定的に検証した(自動テストも同様に固定データで検証済み)。
- 実質同一記事判定はSprint1のタイトルJaccard類似度(閾値0.4)をそのまま流用しており、閾値の妥当性はSprint1のテスト範囲内でしか検証していない(F2固有の追加チューニングは行っていない)。
- 履歴ファイルへの同時書き込み(複数プロセス同時実行時の競合)は考慮していない。Sprint 7(F9: 冪等性)で二重起動対策と合わせて扱う想定。

## 追加したテスト
- `test/postHistory.test.ts`: 履歴ファイル未存在時は空配列/追記後に読み返せる/複数回追記で既存分が保持される、の3ケース。
- `test/selectPost.test.ts`: 最高スコア選定・既出URL除外・URL表記ゆれの正規化・実質同一記事(タイトル類似)除外・0件時のスキップ・空配列時のスキップ・スコアしきい値未満の除外・同日2回実行でのURL重複回避・同日3回実行で候補が尽きた場合のスキップ、の9ケース。
- 実行結果: `npm test`で既存分含め26件全てpass(`npm run typecheck`もエラーなし)。

## 関連ドキュメント
- [[sprint-2-brief]]
- [[x-ai-news-autopost-spec]]
