---
tags: [sprint-evaluation]
sprint: 1
result: PASS
---

# Sprint 1 評価レポート

## 総合判定: PASS

## 検証モード: Bash（CLIバッチ処理・画面なしのため実コマンド実行で検証）
- 対象は画面を持たないバックエンド自動化。Playwright MCPは対象外。`npm`各コマンドを実際に実行して検証した。
- 未検証のネイティブ専用機能: 該当なし。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | `npm run collect`/`--inject-decoy`ともexit code 0。typecheck 0エラー、テスト14/14パス。3件の前回指摘バグは独立スクリプトで修正を実証。 |
| コンソールエラー0件 | PASS | 出力は`[INFO]`と、Reddit 3ソースの`HTTP 403`を捕捉した`[WARN]`のみ。brief明記どおり想定内のソース失敗ハンドリングログはエラーに数えない。未捕捉例外なし。 |
| 受け入れ基準充足率100% | PASS | 下記4基準すべて充足。 |

### 受け入れ基準の内訳
- 10件以上・必須フィールド・スコア降順: PASS。207件収集、各候補が title/url/source/publishedAt/score を保持し、`data/output/latest-candidates.json`で降順を確認。
- 古く話題も伸びていない記事が上位3件に入らない: PASS。`--inject-decoy`で注入した45日前・エンゲージメント0のデコイは score=0/freshness=0 で全208件中の最下位（rank 208）。
- AI無関係の記事が混ざらない: PASS。`filterAiRelated`が全ソース（HN/RSS含む）に適用。出力JSONは`summary`を落とすため一見タイトルだけでは非AIに見える4件（Apple Intelligence, Suno, Computer cops, Google検索刷新）を実地確認したところ、いずれも title+summary で正当にAIキーワードに一致（例: Apple Intelligenceの要約が "Apple's AI ambitions"）しており、真の非AI記事の混入はなし。
- 一部ソース通信失敗でも継続: PASS。Reddit 3ソースが403で失敗→`[WARN]`記録→残5ソースで207件構築、exit 0。

### 前回指摘3件の修正確認（独立検証）
1. A.I.ピリオド付き略記（`src/aiFilter.ts`）: PASS。"Military reliance on A.I. in warfare grows"=true、"The rise of A.I."=true、"A.I.-powered tools"=true。かつ chair/said/cooking など非AIは false を維持。実データでも "Google Ordered to Give A.I. Rivals More Access" が rank 5 で正しく候補化。
2. 日付フォールバック（`src/sources/rss.ts`）: PASS。`resolvePublishedAt({})`と不正pubDateはいずれも epoch(1970) + `publishedAtUnknown:true`を返し、`scoring.ts`で当該候補の freshness を0に固定。現在時刻フォールバックによる不当な鮮度最大化は解消。
3. 橋渡しクラスタリング（`src/scoring.ts`）: PASS。A~B・B~C類似／A~C非類似の橋渡しケースで mentionCount A=2,B=3,C=2（推移的併合バグなら全て3）を独立スクリプトで確認。Union-Find廃止・直接ペア判定に変更済み。

## 発見したバグ・問題点（FAILの原因）
- なし。

## 軽微な改善点（ブロッカーではない）
- 出力JSON（`NewsCandidate`）が`summary`を保持しないため、出力だけを見るとタイトル上AI関連が自明でない候補（Apple Intelligence等）の判定根拠が追いにくい。デバッグ性向上のため、AI判定に用いた根拠（マッチしたキーワードやsummary）を任意でscoreBreakdownに残すと監査しやすい。機能要件には影響なし。
- Reddit 3ソースは本検証環境IPから常時403。機能上は「一部失敗の継続」を満たすため問題ないが、実運用ではRedditのエンゲージメントシグナルが恒常的に欠落する点は留意（自己評価でも既知として記載済み）。

## 未検証項目（実機確認が必要）
- 該当なし（画面なしCLIのため全機能をBashで実行検証できた）。
- 収集される具体的記事・件数は実時間データ依存で変動するが、「10件以上」は本検証でも207件で安定的に充足。

## プレビュー画像
- 該当なし（画面を持たないバックエンドCLIのため）。

## 関連ドキュメント
- [[sprint-1-selfeval]]（ジェネレーターの自己評価レポート）
- [[sprint-1-brief]]（本スプリントの仕様抜粋）
