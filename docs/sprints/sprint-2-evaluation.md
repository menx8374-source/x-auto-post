---
tags: [sprint-evaluation]
sprint: 2
result: PASS
---

# Sprint 2 評価レポート

## 総合判定: PASS

## 検証モード: Bash（CLIバッチ実機実行）
- 画面を持たないバックエンド自動化のためPlaywright MCPは対象外。`npm run select`・`npm test`・`npm run typecheck`を実際に実行して検証。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | 4点すべて実機で期待通り動作。全runでexit code 0。 |
| コンソールエラー0件 | PASS | 全run通して`[ERROR]`ログ0件。スキップは仕様通り`[WARN]`扱い。 |
| 受け入れ基準充足率100% | PASS | 受け入れ基準4項目すべて実機確認で充足。 |

### 受け入れ基準4点の実機確認結果
1. 投稿対象1件確定・タイトル/URL/スコア/理由がログ出力: PASS。RUN1で`OpenAI releases GPT-6`（url `https://a.example.com/gpt6`, score 90, reason付き）を選定し`selected post candidate`ログに出力。
2. 直前投稿済みURLは次回除外: PASS。RUN2でgpt6が履歴にある状態で実行し、除外され`Gemini`(score 70)を選定（reason「既出/実質同一記事1件…除外」）。
3. 有効候補0件時は理由付きスキップ: PASS。RUN4で全3件が履歴済みの状態で`[WARN] no eligible candidate to post, skipping`、latest-selection.jsonに`selected:null`＋理由「有効な候補が0件のため投稿をスキップ(候補3件中、既出/実質同一記事で3件除外…)」。exit code 0。
4. 同一日に同記事2回選ばれない: PASS。RUN1→a, RUN2→b, RUN3→c と同日連続実行で毎回異なるURLを選定。履歴に重複なし。

### 補足確認
- `npm test`: 26件全pass（selectPost 9件・postHistory 3件・既存scoring等含む）。
- `npm run typecheck`: エラーなし。
- `--dry`フラグ: 履歴に追記されないことを確認（実行前後で件数1→1）。
- URL正規化（末尾スラッシュ・大文字小文字）とタイトル類似（Jaccard）による実質同一記事除外はテストで検証済み。
- 検証で作成した`data/`（履歴・キャッシュ・出力）は検証後に削除。いずれもgitignore済みでgit追跡への影響なし。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- `MIN_SELECTION_SCORE = 0`かつ判定が`<= 0`のため、スコア0の候補は既出でなくてもしきい値未満で除外される。実データでスコア分布が0付近に寄ると意図せず候補が枯渇し得るが、現状の受け入れ基準内では問題なし（Sprint後半でチューニング余地）。
- 実質同一記事判定はSprint1のタイトルJaccard閾値0.4を流用。F2固有チューニングは未実施だが基準充足に影響なし。
- 履歴ファイルへの同時書き込み競合は未対応（自己評価でも言及。Sprint7想定で妥当）。

## 未検証項目（実機確認が必要）
- 該当なし（当スプリントのスコープはCLI選定ロジックで、Bashで全項目検証可能）。
- なお`--from-cache`を使わないライブ収集経路（`npm run select`単体）はSprint1のネットワーク依存部分であり、当スプリントの選定ロジックとは分離。選定部は固定候補で確定的に検証済み。

## プレビュー画像
- 該当なし（画面を持たないバックエンドCLI）。

## 関連ドキュメント
- [[sprint-2-selfeval]]（ジェネレーターの自己評価レポート）
- [[sprint-2-brief]]（本スプリントの仕様抜粋）
</content>
</invoke>
