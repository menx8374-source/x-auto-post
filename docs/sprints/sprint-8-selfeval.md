---
tags: [sprint-selfeval]
sprint: 8
---

# Sprint 8 自己評価レポート

## 実装した内容(今回の修正: /code-review指摘対応)
- `src/pipeline.ts`の冪等性判定バグを修正。`hasPostedSlotOnDate(history, options.slot, now)`が素の`new Date()`(実行時点の実際の暦日)を使っており、`resolveCurrentSlot`の深夜跨ぎルックバック(例: JST 00:30実行時に前日21:00の夜枠として解決)と組み合わせると、前日分の投稿履歴を見つけられず冪等性チェックをすり抜けて二重投稿する不具合があった。
- 修正: `options.scheduledAt`が指定されていればそれを、無ければ従来通り`new Date()`を基準日時として`hasPostedSlotOnDate`に渡すよう変更(`src/pipeline.ts` 139〜148行目付近)。すぐ下の不発リカバリ判定(`isWithinRecoveryWindow`)は元々`options.scheduledAt`を使っていたため、同じ考え方を揃えた形。
- `test/pipeline.test.ts`に回帰テストを追加: 「深夜跨ぎのルックバックでresolveCurrentSlotが前日の枠と解決した場合でも、冪等性判定はscheduledAtの暦日を基準にしてリトライの二重投稿を防ぐ」。修正前のコードに戻して実行し、このテストが確実にFAILする(=二重投稿を検知する)ことを確認済み。
- 注: `isWithinRecoveryWindow`(不発リカバリの許容範囲チェック)自体は実運用同様、実行時点の実際の`new Date()`を使うため(既存の意図した設計)、テストは実際の壁時計時刻とは独立して再現できるよう、実行時刻から26時間前を起点に`resolveCurrentSlot`で枠を解決し、許容範囲(recoveryWindowHours)をテスト専用に30時間へ広げて構成した(バグ実証時の具体例である5時間という数値自体はテストの本質ではない)。

## 実装した内容(初回実装分)
- `src/postSchedule.ts`(新規): F7「投稿枠の1箇所集約」の唯一の設定箇所。`POST_SLOTS`配列に朝(07:30)/昼(12:15)/夜(21:00) JSTを定義。
- `resolveCurrentSlot(now, toleranceHours)`: 現在時刻(または注入した時刻)から、どの枠に該当するかをJST基準で判定する純関数。前日・当日双方の各枠を候補にして「経過時間が0以上・許容範囲(既定はSprint7の`getConfiguredRecoveryWindowHours()`と共通、既定3時間)以内」なものの中で最も直近のものを返す。夜枠21:00 JSTの許容範囲が日付をまたぐケースにも対応。該当枠が無ければ`null`。
- `src/dryRun.ts` / `src/publish.ts`: 新CLIオプション`--auto-slot`(現在時刻から枠・予定時刻を自動判定し、内部的に`--slot`/`--scheduled-at`相当の値をパイプラインへ渡す)と`--now=<ISO8601>`(テスト用に時刻を注入、`--auto-slot`と併用)を追加。既存の`--slot`/`--scheduled-at`手動指定はそのまま維持(後方互換、Sprint 7の動作を変えていない)。
- `--auto-slot`指定時に該当枠が無い時刻で実行した場合、パイプライン(収集・生成・投稿API呼び出し)を一切実行せず、`stage:"skipped"`, `skipReason:"no-active-slot"`として`data/output/latest-dryrun.json` / `latest-publish.json`に安全に記録して終了する。
- Sprint 7の`hasPostedSlotOnDate`(当日最大1投稿)はそのまま再利用(`pipeline.ts`は変更不要、`slot`文字列を渡すだけで連動)。
- 古くなっていたコメント(`pipeline.ts`のRunPipelineOptions、`types.ts`のPostHistoryEntry.slot)を「Sprint 8で朝/昼/夜が実装される」という未来形記述から実装済みの記述に更新。
- README.mdに`--auto-slot`/`--now`の使い方とF7セクションを追記。

## 技術選定
- 新規ライブラリは追加していない(Sprint 1で選定済みのNode.js標準機能のみ)。タイムゾーンライブラリは使わず、Sprint 7の`toDateKey`と同じ「+9時間シフトしてUTC getterで日付を取り出す」方式を`resolveCurrentSlot`でも踏襲し、JST基準の判定ロジックの実装パターンを統一した。

## 受け入れ基準チェック(自己申告)
- [x] 投稿枠がJST 07:30/12:15/21:00の3枠として定義され、実行時に現在時刻(または入力)からどの枠かを判定・記録できる: `POST_SLOTS`で定義、`resolveCurrentSlot(now)`で判定。CLIの`--auto-slot`/`--now`から呼び出し可能。単体テスト9件で境界値(枠時刻ちょうど、許容範囲の内外、日付またぎ)を確認済み。
- [x] 各枠は当日最大1投稿で、同枠内の二重投稿をしない(F9と連動): Sprint 7の`hasPostedSlotOnDate`をそのまま再利用。`--auto-slot`で判定した`slot`文字列がそのまま`runPostingPipeline`の`slot`オプションに渡るため連動している。**今回の修正で、深夜跨ぎルックバック時の冪等性判定バグ(前日分の投稿履歴を見つけられず二重投稿しうる問題)を修正し、回帰テストで再現・防止を確認済み。**
- [x] 枠の時刻が1箇所の設定で管理され、変更が反映される: `src/postSchedule.ts`の`POST_SLOTS`配列1箇所のみで定義。コード各所(dryRun.ts/publish.ts/pipeline.ts)はこの値を参照するのみで、時刻を直接ハードコードしていない。

## アプリの起動方法
バックエンドCLI(画面なし)。プロジェクトルート(`c:\ClaudeProjects\XAutoMode`)で以下を実行する。

```bash
npm install

# F7: 自動枠判定でドライラン実行(現在時刻から朝/昼/夜を自動判定)
npm run dryrun -- --write-history --auto-slot

# F7: テスト用に時刻を注入して自動判定を確認(例: JST 07:30ちょうど = UTC 22:30前日)
npm run dryrun -- --auto-slot --now=2026-07-16T22:30:00.000Z

# F7: 本番投稿でも同様に自動判定できる(X API認証情報が必要)
npm run post -- --auto-slot

# テスト実行(postSchedule.test.tsの境界値テスト9件・pipeline.test.tsの回帰テスト1件を含む)
npm test

# 型チェック
npm run typecheck
```

手動確認した内容:
- `npm run dryrun -- --auto-slot --now=2026-07-16T22:30:00.000Z`(JST朝07:30ちょうど)→ 「朝」枠として解決され、パイプラインが`generate`段階まで進行(ANTHROPIC_API_KEY未設定のため生成でエラー終了、Sprint 3から既知の未検証項目でありF7とは無関係)。
- `npm run dryrun -- --auto-slot --now=2026-07-16T20:00:00.000Z`(JST深夜05:00、どの枠にも該当しない時刻)→ API呼び出し無しで`stage:"skipped"`, `skipReason:"no-active-slot"`として即終了。
- `npm run publish.ts`(`npm run post`)側でも同じ`no-active-slot`パスを確認。
- `npm test` / `npm run typecheck` とも全件成功(全94テスト、うちpostSchedule.test.tsの9件・今回追加のpipeline.test.ts回帰テスト1件を含む)。
- 今回の修正確認: `src/pipeline.ts`の修正を一時的に元に戻し(`referenceDate = now`)、追加した回帰テストが確実にFAILすること(実際にpublishが2回呼ばれ二重投稿相当になること)を確認した上で、修正を復元して全テストがPASSすることを再確認した。

## 既知の問題・懸念点
- `--auto-slot`実行時、CLIに渡す`--now`はスロット判定(どの枠か・scheduledAtの値)にのみ使われる。パイプライン内部の冪等性チェック(`hasPostedSlotOnDate`/`isWithinRecoveryWindow`)は実際の`new Date()`(本物の現在時刻)を使う(Sprint 7の既存設計をそのまま踏襲)。そのため`--now`で過去の日時を注入して`--auto-slot`と組み合わせても、不発リカバリの許容範囲チェックは実時刻基準で行われ「許容範囲外」と判定されることがある(上記手動確認の1件目はたまたま実行時刻が朝枠の許容範囲内だったため通過したが、実行タイミングによっては`outside-recovery-window`でスキップされうる)。これは意図した挙動(実際の投稿実行タイミングでは`--now`を指定しない使い方を想定)だが、テスト時に紛らわしくなりうる点として明記する。
- F12(設定管理の正式実装)は次のSprint 10で予定通り。今回は「1箇所の設定で管理される」という受け入れ基準を満たす範囲(`POST_SLOTS`配列)のみ実装し、環境変数化・UIでの変更等はスコープ外とした。
- Sprint 3(ANTHROPIC_API_KEY未設定)・Sprint 6(X API認証情報未設定)の既存の未検証事項は引き続き未解消(本スプリントのスコープ外)。

## 追加したテスト
- `test/postSchedule.test.ts`(新規、9件): `POST_SLOTS`の内容確認、朝/昼/夜それぞれの目安時刻ちょうどでの判定、許容範囲ぴったり(境界値)・許容範囲+1秒(境界値外)・予定時刻の1秒前(境界値外)、夜枠の許容範囲が日付をまたぐケース(JST日境界)、`toleranceHours`明示指定時の挙動。全件パス。
- `test/pipeline.test.ts`(今回追加、1件): 深夜跨ぎルックバック(`resolveCurrentSlot`が前日の枠を返すケース)での冪等性判定の回帰テスト。修正前のコードでFAILすること・修正後にPASSすることの両方を確認済み。

## 前回フィードバックへの対応(再実装)
- 指摘: `src/pipeline.ts`の冪等性判定が、`resolveCurrentSlot`が解決した予定時刻(`scheduledAt`)ではなく実行時点の実際の現在時刻のJST暦日を使っており、`POST_RECOVERY_WINDOW_HOURS`を3時間超に設定した状態で深夜跨ぎのリトライを行うと夜枠が二重投稿されうる(node実行で実証済み)。
  → 対応: `hasPostedSlotOnDate`呼び出しの基準日時を、`options.scheduledAt`が指定されていればそれ(無ければ`new Date()`にフォールバック)に変更。指摘された具体的シナリオ(夜枠投稿済み→深夜跨ぎリトライ)を再現する回帰テストを追加し、修正前後で挙動が変わる(修正前はFAIL=二重投稿、修正後はPASS=スキップ)ことを確認した。

## 関連ドキュメント
- [[sprint-8-brief]]
- [[x-ai-news-autopost-spec]]
