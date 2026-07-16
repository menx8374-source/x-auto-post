---
tags: [sprint-evaluation]
sprint: 7
result: PASS
---

# Sprint 7 評価レポート（再検証: toDateKey JST化）

## 総合判定: PASS

## 検証モード: Bash（画面を持たないバックエンドCLI。Playwright不要）
- 対象プラットフォームはbrief記載の通り「web（画面を持たないバックエンド自動化）」。UIがないため、自動テスト・型チェック・実CLI実行・独立検証スクリプトで検証した。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 重点確認3項目すべて実CLI＋独立スクリプトで再現確認。二重投稿バグの再発なし・逆パターン回帰なし。 |
| コンソールエラー0件 | PASS | `npm test` 84/84パス、`npm run typecheck` エラーなし。テスト出力中の[ERROR]ログは異常系テストの意図的出力。想定外エラーなし。 |
| 受け入れ基準充足率100% | PASS | 履歴永続化・同一枠同一日冪等性・不発リカバリ範囲判定・F2既出判定互換の4基準すべて充足。 |

## 重点確認項目の検証結果
1. **07:31 JST投稿→09:05 JST再実行（UTC日境界をまたぐが同一JST暦日）→ 既投稿判定で二重投稿されない**: PASS。
   - 単体: `hasPostedSlotOnDate([postedAt=2026-07-14T22:31Z], "morning", 2026-07-15T00:05Z)` → `true`（独立スクリプトで確認、committedテスト非依存）。
   - 実CLI e2e: seed `postedAt=2026-07-17T00:00Z`（=JST 07-17 09:00、UTC日07-17は現在時刻のUTC日07-16と異なるが同一JST日）で `npm run post -- --slot=morning` が collect前に `skipReason: already-posted` でスキップ・exit 0。旧UTCロジックなら二重投稿がすり抜けたケース。
2. **翌日の正当な投稿が誤って既投稿とスキップされない（逆回帰なし）**: PASS。
   - 単体: 前日JST投稿 vs 翌JST日参照 → `false`。
   - 実CLI e2e: seed `postedAt=2026-07-16T00:00Z`（=昨日JST）で `npm run dryrun -- --slot=morning` が already-posted スキップせず collect（208候補収集）まで進行。generate段で停止するのは`ANTHROPIC_API_KEY`未設定による既存挙動でF9とは無関係。
3. **既存の同一UTC日内ケースも引き続き正しく動作**: PASS。`09:00Z投稿→12:00Z再実行`→`true`（独立スクリプト）。境界値も直接確認: 00:00/23:59 JSTは同一JST日、翌日00:01 JSTは別日と正しく判定。

## その他の受け入れ基準
- 履歴永続化（URL・枠・日時・ツイートID）: `appendHistoryEntry`/`updateHistoryEntry`/`loadHistory` で永続化・再参照可。Sprint2形式（id/slot無し）の後方互換もテスト確認。PASS。
- 不発リカバリ範囲判定: `isWithinRecoveryWindow` 境界値（3時間ちょうど=true、3時間+1秒=false、予定時刻前=true）確認。PASS。
- F2既出判定互換: `selectPost.ts` 未変更、既存テスト全パス。PASS。
- `toDateKey`直接検証: 各instant→JST暦日マッピングが全て正しいことを独立スクリプトで確認。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- 自己評価レポート line 22 は「`src/publish.ts` / `src/dryRun.ts` は `stage:"skipped"` で `exitCode` を1にしない」と記載しているが、実際に該当処理があるのは `publish.ts`（本番cron経路、line 81でskip時exit 0を確認済み）のみ。`dryRun.ts` はskip時も無条件で `process.exitCode = 1`（line 91）。cron連携の本番経路は正しく0を返すため冪等性運用に実害なし・受け入れ基準にも exit code の規定なし。ただし自己評価の記述と実装が食い違うため、記述の訂正か dryRun 側の統一を推奨。
- 履歴ファイルへの書き込みはロックなし read-modify-write（自己評価の既知の問題通り）。単発順次実行前提の設計であり本スプリント範囲では許容。
- 履歴のprune（保持期間上限）は未実装。「一定期間残る」基準は充足。長期運用でのファイル肥大は将来課題（自己評価に既記載）。

## 未検証項目（実機確認が必要）
- 該当なし（ネイティブ専用機能なし。ANTHROPIC_API_KEY/X API認証情報が必要な generate/publish 段は本スプリントのF9ロジック外で、F9の冪等性・不発リカバリ判定は collect 前に完結するため検証に影響しない）。

## プレビュー画像
- 該当なし（画面を持たないバックエンドCLIのため）。

## 関連ドキュメント
- [[sprint-7-selfeval]]（ジェネレーターの自己評価レポート）
- [[sprint-7-brief]]（本スプリントの仕様抜粋）
