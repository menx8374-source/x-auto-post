---
tags: [sprint-selfeval]
sprint: 5
---

# Sprint 5 自己評価レポート

## 実装した内容
- `src/pipeline.ts`: Sprint1〜4の収集(`collectAndScoreNews`)→選定(`selectNextPost`)→生成(`generatePostText`)→分割・リンク付与(`composeThread`)を1本にまとめた共通パイプライン`runPostingPipeline()`。
  - 最後の「投稿する」ステップだけを`PublishFn`型の関数として注入可能にし、本番投稿(Sprint 6)とドライランの差異が「実際に送信するか否か」だけであることをコード構造上明確化。
  - ドライラン用実装`dryRunPublish`(送信せずログのみ)をこのファイルに定義。
  - 依存(`collect`/`loadHistory`/`select`/`generate`/`buildThread`/`appendHistory`)はすべて注入可能(`PipelineDependencies`)にし、テストで実I/O・実API・実ネットワークなしに全段階を検証できるようにした。
  - 各段階の失敗(選定候補なし/生成失敗)で安全に停止し、`stage`フィールドでどこで止まったか分かるようにした。
- `src/dryRun.ts`: F11のCLIエントリ(`npm run dryrun`)。`runPostingPipeline`に`dryRunPublish`を渡して実行し、投稿予定の全ツイート(順序・種別・文字数・本文)をコンソールに表示、`data/output/latest-dryrun.json`に保存。
  - 既定では投稿履歴(`data/history/post-history.json`)に書き込まない。`--write-history`指定時のみ書き込む(検証目的でわざと記録したい場合向け)。
  - `--inject-decoy`で検証用ダミー候補を混ぜられる(既存`collectAndScoreNews`のオプションをそのまま伝播)。
- `package.json`に`dryrun`スクリプトを追加。
- `README.md`に`npm run dryrun`の使い方・挙動・本番投稿との差し替え設計を追記。
- `test/pipeline.test.ts`: モック依存注入による単体テスト7件(全段階通過・publish結果・履歴書き込みあり/なし・選定候補なし停止・生成失敗停止・本番publish差し替え時の出力同一性)。

## 技術選定(該当する場合のみ)
- 新規ライブラリの追加なし。既存のNode.js標準テストランナー(`node --test`)・既存モジュール構成を踏襲。
- 依存性注入(`PipelineDependencies`)は、Sprint1〜4で確立済みの「純粋関数+I/O分離」パターン(`selectPost.ts`の`selectNextPost`等)を踏襲したもので、新しい設計思想の導入ではない。

## 受け入れ基準チェック(自己申告)
- [x] ドライラン指定で実行すると、Xへ1件も投稿せず、収集→選定→生成→分割→リンク付与までを通し、投稿予定の全ツイート(順序・各文字数・リンクツイート)を出力する。
  - `npm run dryrun`の実行(実ネットワーク経由の収集・選定は実データで確認済み。ANTHROPIC_API_KEY未設定のためgenerate段階で安全停止することを実機確認)。
  - generate〜thread(スレッド分割・リンク付与)まで含めた完全な通し動作は、`test/pipeline.test.ts`のモックテストと、`generate`のみモック化しつつ収集・選定・分割は実処理を通した手動スモーク実行(スクラッチファイル、確認後削除)の両方で、順序・文字数・リンクツイートが正しく出力されることを確認済み。
- [x] ドライランが投稿履歴(既出判定用)を汚さない、または汚さない選択ができる。
  - 既定(`--write-history`なし)では`appendHistoryEntry`が呼ばれず、実行後も`data/history/`ディレクトリが生成されないことを実機確認。
  - `--write-history`指定時のみ書き込まれることをユニットテストで確認。
- [x] 本番投稿処理との差異が「実際に送信するか否か」だけであることがコード上/出力上で確認できる。
  - `runPostingPipeline(options)`の`options.publish: PublishFn`のみが本番/ドライランの差し替え点。収集・選定・生成・分割・リンク付与のコードパスは完全に共有。
  - `test/pipeline.test.ts`の「本番投稿を模したpublish関数に差し替えても、収集〜分割までの結果は同一(差異はpublish結果のみ)」テストで、同一入力に対し`dryRunPublish`と本番投稿を模した`publish`関数を差し替えても`tweets`/`candidate`/`text`が完全一致し、`publishResult.posted`のみ異なることを確認。

## アプリの起動方法
```bash
npm install
npm run dryrun
# 検証用ダミー候補を混ぜる場合
npm run dryrun -- --inject-decoy
# あえて投稿履歴に記録したい場合
npm run dryrun -- --write-history

# テスト実行
npm test
# 型チェック
npm run typecheck
```
このスプリントは画面を持たないバックエンドCLIのため、サーバー起動は不要(常駐プロセスなし)。

## 既知の問題・懸念点
- `ANTHROPIC_API_KEY`が本検証環境の`.env`に未設定のため、`npm run dryrun`の実運用コマンドを実行した際は`generate`段階で安全に停止する挙動までしか実機確認できていない(収集・選定は実データ・実ネットワークで確認済み)。生成成功後のスレッド分割・リンク付与まで含めた完全な通し出力は、ユニットテスト(モック)と、生成のみモック化した手動スモーク実行で確認した。実APIキー設定後に`npm run dryrun`を実行すれば、コード上は同じパイプラインを通るため同様に動作する見込み。
- Reddit系ソース(r/artificial, r/MachineLearning, r/OpenAI)は本検証環境からのアクセスがHTTP 403 Blockedになったが、これはSprint 1のarchitectureメモに記載済みの想定内挙動であり、処理全体は継続する(既存の設計通り)。

## 追加したテスト
- `test/pipeline.test.ts`(7件): モック依存注入により、収集〜分割〜publishの全段階通過、publish結果の反映、`writeHistory`フラグのオン/オフによる履歴書き込みの有無、選定候補なし/生成失敗時の早期停止、本番投稿を模したpublish関数への差し替え時に出力(tweets/candidate/text)が変わらないことを検証。
- 既存テスト56件(Sprint1〜4分)は変更なしですべてパス、今回追加の7件と合わせて全63件パス(`npm test`)。

## 関連ドキュメント
- [[sprint-5-brief]]
- [[x-ai-news-autopost-spec]]
