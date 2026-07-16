---
tags: [sprint-selfeval]
sprint: 7
---

# Sprint 7 自己評価レポート

## 実装した内容
- `src/types.ts`: `PostHistoryEntry` に `id`・`slot`・`postedAt`・`tweetIds`・`status`(`"selected"|"posted"|"failed"`)を追加(すべて任意フィールドでSprint 2形式と後方互換)。
- `src/postHistory.ts`:
  - `appendHistoryEntry`: `id`(`crypto.randomUUID()`)を発行して返すよう拡張。`status`未指定時は`"selected"`を既定値とする。
  - `updateHistoryEntry(id, updates)`: 選定時に書き込んだエントリへ、投稿完了後の結果(`status`/`postedAt`/`tweetIds`/`slot`)を反映する2段階書き込みの後半。対象idが無ければ警告ログのみで例外は投げない。
  - `hasPostedSlotOnDate(history, slot, referenceDate)`: 同一枠・同一日にstatus:"posted"のエントリがあるかを判定する冪等性チェック関数。
  - `isWithinRecoveryWindow(scheduledAt, now, toleranceHours)`: 予定時刻からの経過時間が許容範囲内かを判定する不発リカバリ関数。範囲外(既定3時間超)ならfalse。
  - `DEFAULT_RECOVERY_WINDOW_HOURS`(既定3時間)、`getConfiguredRecoveryWindowHours()`(`POST_RECOVERY_WINDOW_HOURS`環境変数で上書き可)。
  - **(今回修正)** `toDateKey`: JST(UTC+9固定オフセット)基準の日付キーに変更。詳細は「前回フィードバックへの対応」参照。
- `src/pipeline.ts`(`runPostingPipeline`): 軽量統合。
  - `slot`指定時、収集(外部API呼び出し)より前に`hasPostedSlotOnDate`で冪等性チェック→該当なら`stage:"skipped"`, `skipReason:"already-posted"`で即終了。
  - `scheduledAt`指定時、`isWithinRecoveryWindow`で許容範囲チェック→範囲外なら`stage:"skipped"`, `skipReason:"outside-recovery-window"`で即終了。
  - 投稿(publish)完了後、`posted:true`なら`status:"posted"`+`postedAt`+`tweetIds`を、`error`ありの失敗なら`status:"failed"`を選定時のエントリへ反映(ドライラン等の未送信時は反映しない)。
  - `PipelineDependencies`に`updateHistory`を追加。
- `src/publish.ts` / `src/dryRun.ts`: `--slot=<枠名>` / `--scheduled-at=<ISO8601>` のCLI引数を追加し、`runPostingPipeline`へ渡せるようにした(Sprint 8で朝/昼/夜の実値が渡されるようになるまでの受け口)。`stage:"skipped"`は正常な運用上のスキップとして扱い、`exitCode`を1にしない(候補なし/生成失敗等の異常終了とは区別)。
- `README.md` / `.env.example`: F9の説明、`--slot`/`--scheduled-at`の使用例、`POST_RECOVERY_WINDOW_HOURS`環境変数を追記。
- テスト追加(`test/postHistory.test.ts`, `test/pipeline.test.ts`): 下記参照。

## 技術選定(該当する場合のみ)
- 新規ライブラリは追加していない(`node:crypto`の`randomUUID()`のみ、Node標準)。JSTオフセット計算もタイムゾーンライブラリを追加せず`Date`計算のみで対応(既存の技術選定`docs/spec/x-ai-news-autopost-architecture.md`を踏襲)。

## 受け入れ基準チェック(自己申告)
- [x] 投稿履歴(記事URL・枠・日時・ツイートID)が永続化され、次回実行で参照される。`appendHistoryEntry`/`updateHistoryEntry`で書き込み、`loadHistory`で次回実行時に読み込む。テスト`test/postHistory.test.ts`で確認済み。
- [x] 同一枠・同一日で処理を二重起動しても二重投稿されない(擬似二重起動で確認)。`test/pipeline.test.ts`の「F9: 擬似二重起動」テストで、同一の履歴ストアに対しパイプラインを2回実行し、2回目が`publish`を呼ばずに`skipped`で終わることを確認。CLI実レベルでも、`data/history/post-history.json`に`slot:"morning"`のposted済みエントリを書き込んだ状態で`npm run dryrun -- --write-history --slot=morning`を実行し、収集(外部API呼び出し)にすら進まず`stage:"skipped"`, `skipReason:"already-posted"`で終わることを実機確認した(Sprint 7初回)。今回のJST修正後もUTC日境界をまたぐケースを含めテスト全件パスを再確認。
- [x] ある枠が未投稿のまま次の起動が来たとき「当日その枠が未投稿」と判定でき、許容範囲内なら補い、範囲外(例: 深夜に朝枠)なら補わない。`isWithinRecoveryWindow`の単体テストで境界値(ちょうど3時間=true、3時間+1秒=false、10時間後=false、予定時刻より前=true)を確認。パイプライン統合テストでも許容範囲内/範囲外それぞれ`publish`が呼ばれる/呼ばれないことを確認。
- [x] 履歴が一定期間残り、既出判定に使われる。履歴は明示的な削除機構を持たず(常にappend/update)、`selectPost.ts`の`isSameUrlAsHistory`/`isSameTopicAsHistory`は変更していないためF2の既出判定は従来通り動作する(既存の`test/selectPost.test.ts`全件パス)。Sprint 2形式(id/slot等が無い)のデータもそのまま読み込めることをテストで確認(後方互換)。

## アプリの起動方法
バックエンドCLIツール(画面なし)。プロジェクトルート `c:\ClaudeProjects\XAutoMode` で以下を実行。

```bash
npm install

# テスト実行(F9関連含む全84件)
npm test

# 型チェック
npm run typecheck

# ドライラン(投稿枠+予定時刻を指定して冪等性・不発リカバリを確認する例)
npm run dryrun -- --write-history --slot=morning
npm run dryrun -- --write-history --slot=morning --scheduled-at=2026-07-16T00:00:00.000Z

# 本番投稿(X API認証情報が.envに必要。--slot/--scheduled-atも同様に指定可能)
npm run post -- --slot=morning --scheduled-at=2026-07-16T00:00:00.000Z
```

`ANTHROPIC_API_KEY`未設定のこの開発環境では、`npm run dryrun`/`npm run post`は冪等性・不発リカバリのスキップ判定(collect呼び出し前)は正常に動作するが、そのチェックを通過した後の`generate`段階(文面生成)でエラー終了する(Sprint 3で導入済みの既存挙動で、本スプリントの実装とは無関係)。F9固有のロジックは自動テストおよびCLI実行(seedデータ投入→スキップ確認)で検証済み。

今回の修正作業では自己確認用のサーバー・常駐プロセスは起動していない(`npm test`/`npm run typecheck`のみ実行し、いずれも実行完了後に自動終了済み)。

## 既知の問題・懸念点
- 履歴ファイルへの書き込みはread-modify-write(ロックなし)のため、真の並行プロセス(同時に2プロセスが同時刻に書き込む)には対応していない。GitHub Actions等の単発実行を想定した設計であり、通常の運用(順次実行)では問題にならない想定。
- 履歴の保持期間に明示的な上限(古いエントリの削除)は設けていない(常に追記+更新のみ)。「一定期間残る」という受け入れ基準は満たすが、長期運用でファイルサイズが際限なく増える可能性がある。件数は投稿頻度(1日3回)から見て小規模な想定のため、今スプリントでは未対応(prune機構はスコープ外と判断)。
- Sprint 8(F7: 朝/昼/夜の固定時刻ロジック)・Sprint 9(F8: 外部cron連携)は未実装(意図的にスコープ外)。今回追加した`slot`/`scheduledAt`パラメータは受け口のみで、実際の時刻決定ロジックはまだない。
- 今回のJST化により`toDateKey`の「同一日」判定はJST基準に統一された。ただし`isWithinRecoveryWindow`は経過時間(ミリ秒差分)のみを見るタイムゾーン非依存の実装のため変更していない(影響なし、意図通り)。

## 追加したテスト
- `test/postHistory.test.ts`: `appendHistoryEntry`のid付与・既定status、`updateHistoryEntry`の正常系/対象なし時の安全な挙動、Sprint2形式データの後方互換読み込み、`hasPostedSlotOnDate`の正常系/否定系(別日・別枠・failed状態はブロックしない)、擬似二重起動シミュレーション、`isWithinRecoveryWindow`の境界値(3時間ちょうど=true、3時間+1秒=false、10時間後=false、予定時刻前=true)。
- `test/pipeline.test.ts`: 状態共有モック(`buildStatefulMockDeps`)を用いた、同一枠・同一日の擬似二重起動(2回目がpublishを呼ばずスキップされる)、投稿完了後の履歴反映(slot/postedAt/tweetIds)、不発リカバリの許容範囲内/範囲外それぞれの挙動。
- **(今回追加)** `test/postHistory.test.ts`にUTC日境界をまたぐ回帰テストを2件追加:
  - 「07:31 JSTに投稿(UTCでは前日22:31Z)→09:05 JST(同一JST暦日・リカバリー許容範囲内)に同じ枠で再実行」を再現し、`hasPostedSlotOnDate`が`true`(=ブロックされ二重投稿されない)を返すことを確認。
  - 逆パターン(前日の投稿がUTC dateKeyでは同日に見えかねないケース)で、翌JST暦日の投稿を誤って「既投稿」とスキップしない(`false`を返す)ことを確認。
- 全84件(既存82件+今回の回帰テスト2件)が`npm test`でパスすることを確認済み。`npm run typecheck`もエラーなし。

## 前回フィードバックへの対応(再実装の場合のみ)
- 指摘: `/code-review`のCONFIRMEDバグ。`toDateKey`がUTC基準の日付スライス(`iso.slice(0,10)`)になっており、UTC日境界(UTC 00:00 = JST 09:00)が朝枠(JST 07:30)から1.5時間後で既定リカバリー許容範囲(3時間)の内側に入るため、同一JST暦日でもUTC日をまたぐタイミングの二重起動でJST 07:31投稿分がUTC dateKeyでは前日扱いになり`hasPostedSlotOnDate`が誤って`false`を返し二重投稿がすり抜ける(逆に正当な投稿が誤って既投稿判定されスキップされる逆パターンも同一原因)。
  → 対応: `src/postHistory.ts`の`toDateKey`を、ISO文字列(UTC)を`Date`でパースし+9時間(`JST_OFFSET_MS`固定オフセット、日本は夏時間なしのためタイムゾーンライブラリ不要)シフトしてから`toISOString().slice(0,10)`でJST基準の日付キーを取り出す実装に変更。`hasPostedSlotOnDate`はこの`toDateKey`を経由するだけで内部ロジックは変更不要(呼び出し側のシグネチャ・挙動は同一のまま、日付キーの基準のみJSTに修正)。`isWithinRecoveryWindow`は経過時間(ミリ秒差分)のみを扱いタイムゾーンに依存しない実装のため影響なし・変更なしであることを確認。
  → 検証: フィードバック中の具体例(07:31 JST投稿→09:05 JST再実行)と、逆パターン(翌暦日投稿の誤スキップ防止)の2件を回帰テストとして`test/postHistory.test.ts`に追加。両方パスすることを確認。既存の82件のテスト(同一UTC日内のケースを含む)も全件パスすることを確認済み(全84件成功)。`npm run typecheck`もエラーなし。

## 関連ドキュメント
- [[sprint-7-brief]]
- [[x-ai-news-autopost-spec]]
