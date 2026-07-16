---
tags: [sprint-evaluation]
sprint: 8
result: PASS
---

# Sprint 8 評価レポート

## 総合判定: PASS

## 検証モード: Bash縮退（画面なしバックエンドCLIのため）
対象プラットフォームは`web`だが画面を持たないバックエンド自動化。Playwright実機操作の対象UIが無いため、`npm test`・`npm run typecheck`・実CLI実行・実コードを呼ぶ検証スクリプトで確認した。ネイティブ専用の未検証項目は無し。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 前回FAILの深夜跨ぎ二重投稿バグを実コードで再現・修正確認（下記）。94テスト全PASS。 |
| コンソールエラー0件 | PASS | `npm test` 94/94 pass、`tsc --noEmit`エラー0、CLI各シナリオexit 0。ログのWARN/INFOは意図的な運用ログでエラーではない。 |
| 受け入れ基準充足率100% | PASS | 投稿枠定義/枠判定/境界値/1箇所設定管理/同枠1投稿冪等性を全て確認。 |

## 検証内容の要点
- 今回の修正（`src/pipeline.ts` L139-152: `hasPostedSlotOnDate`の基準日時を`options.scheduledAt`優先に変更）を実コードを呼ぶ検証スクリプトで確認。
- 重点1（深夜跨ぎ二重投稿防止・核心）:
  - 夜枠21:05 JSTで投稿完了→履歴にevening/posted記録。
  - 翌00:30 JST（recovery window 6hに拡張想定）でauto-slot再解決→同じ前日21:00夜枠に解決（scheduledAt=2026-07-16T12:00:00Z）。
  - 旧バグ挙動を明示的に再現: 実時計（crossNow=翌日暦日）基準では`hasPostedSlotOnDate`=false（履歴を見つけられずすり抜ける）を確認。
  - 修正挙動: scheduledAt（前日暦日）基準では`hasPostedSlotOnDate`=true。パイプラインは`skipped`/`already-posted`で停止、publishは再呼び出しされず二重投稿なしを確認。
- 重点2（回帰なし）: 通常の同一枠同一日リトライで1回目成功・2回目`already-posted`スキップ・publish1回のみを確認。既存の`F9: 擬似二重起動`テストもPASS。
- 重点3（recovery window影響なし）: `isWithinRecoveryWindow`の境界（3h ちょうど=許容内、3h+1ms=許容外、now<予定=常に許容内）を確認。深夜跨ぎでもwindow超過時は`outside-recovery-window`で正しく停止することも確認。
- 受け入れ基準（枠定義/境界値/1箇所設定管理）: `test/postSchedule.test.ts`9件（07:30/12:15/21:00ちょうど、許容範囲ぴったり/+1秒、予定1秒前、夜枠のJST日境界、tolerance明示）全PASS。`POST_SLOTS`が唯一の定義箇所で、CLI/pipelineはこれを参照するのみ。
- CLI実挙動: `--auto-slot --now=<朝枠時刻>`で「朝(morning)」に解決、`--now=<深夜>`で`no-active-slot`として即終了（exit 0、`latest-dryrun.json`に`stage:"skipped"`/`skipReason:"no-active-slot"`を永続化）を確認。

## 発見したバグ・問題点（FAILの原因）
なし。

## 軽微な改善点（ブロッカーではない）
- CLIで`--auto-slot`に過去の`--now`を注入すると、slot解決は成功するが不発リカバリ判定が実時計基準のため`outside-recovery-window`で停止することがある（selfevalの「既知の懸念」に記載済み）。意図した設計であり実害なし。テスト時の紛らわしさのみ。

## 未検証項目（実機確認が必要）
- 該当なし（バックエンドCLIのためUI検証対象なし）。
- ANTHROPIC_API_KEY未設定（生成段階）・X API認証情報未設定（実投稿）はSprint 3/6からの既知の未検証事項で本スプリントのスコープ外。F7の枠判定・冪等性ロジックとは独立。

## プレビュー画像（PASSかつ画面を持つプロダクトの場合のみ）
- 該当なし（画面を持たないバックエンド）。

## 関連ドキュメント
- [[sprint-8-selfeval]]（ジェネレーターの自己評価レポート）
- [[sprint-8-brief]]（本スプリントの仕様抜粋）
