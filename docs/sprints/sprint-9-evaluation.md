---
tags: [sprint-evaluation]
sprint: 9
result: PASS
---

# Sprint 9 評価レポート

## 総合判定: PASS

## 検証モード: Bash縮退
- 対象は画面を持たないバックエンド自動化(GitHub Actionsワークフロー)。ブラウザUIは存在しないためPlaywright検証は非該当。
- GitHub Actions上での実起動(`workflow_dispatch`手動発火・cron-job.orgからのHTTP起動・Secrets読み込み・履歴コミット&プッシュ)は、本環境がローカルかつリモートリポジトリ未接続のため実行できない。仕様書の評価基準補足どおり「workflow_dispatchが外部HTTP呼び出しで発火する形になっていること」「手順書の内容が正しいこと」に加え、YAML構文検証・typecheck・テストスイート・シェルロジックのコードレビューで検証した。

## 基準ごとの結果
| 基準 | 結果 | 根拠 |
|---|---|---|
| 致命的バグ0件 | PASS | typecheck exit 0、YAML validator(@action-validator/cli) exit 0。ワークフローロジック・手順書に致命的欠陥なし。 |
| コンソールエラー0件 | PASS | ブラウザUI非該当。テストスイート93/94 pass、唯一の失敗はSprint 8由来の既知flakyテスト(対象外)。 |
| 受け入れ基準充足率100% | PASS | 下記4基準すべて充足(詳細下記)。 |

### 受け入れ基準の充足確認
1. workflow_dispatchで起動できる実行ワークフローが用意され手動発火で投稿(またはドライラン)が走る: `.github/workflows/post.yml`に`workflow_dispatch`(入力`slot`/`mode`)定義。`mode=post`→post、`mode=dryrun`→dryrunコマンド分岐。CLIコマンド自体はローカルで動作確認済み(既存テスト・typecheck)。→ 充足
2. 投稿枠(朝/昼/夜)を入力で受け取れる/起動時刻から判定できる: `slot`=`morning`/`noon`/`evening`明示指定、`auto`で起動時刻から自動判定。→ 充足
3. cron-job.org用手順書(URL・HTTPメソッド・認証ヘッダ・ボディ・設定時刻)提供、認証情報はプレースホルダ: `docs/cron-setup.md`にURL・POST・4ヘッダ・JSONボディ・3枠のJST/UTC時刻を記載。PAT/APIキー実値は無く`<YOUR_GITHUB_PAT>`等プレースホルダのみ。→ 充足
4. scheduleがバックアップ用途である旨をドキュメントに明記: post.ymlコメント(L32-42)、README「F8」節(L115)、cron-setup.md冒頭(L3)の3箇所に明記。→ 充足

### 今回のセキュリティ修正(前回FAIL原因)の再検証
1. `${{ inputs.slot }}`/`${{ inputs.mode }}`が`run:`ブロックへ直接展開されず`env:`経由: 確認。post.yml L81-82で`SLOT_INPUT: ${{ inputs.slot }}`/`MODE_INPUT: ${{ inputs.mode }}`として環境変数へ代入(env:代入は値がそのまま環境変数化されシェル評価されない安全な受け渡し)、シェル内はL85-86で`"${SLOT_INPUT:-auto}"`/`"${MODE_INPUT:-post}"`として参照。→ 修正済み
2. slot/mode値のcase許可リスト検証と不正値でのエラー終了: 確認。L88-102で`case`文により`auto|morning|noon|evening`・`post|dryrun`を許可リスト検証し、不一致は`echo ... >&2; exit 1`で終了。`set -e`もあり。→ 実装済み
3. 他箇所への同様インジェクションパターン(`${{ }}`のrun:直接埋め込み)残存有無: 確認。run:ブロックは3つ(`npm ci`/Run posting pipeline/Commit updated post history)で、`${{ }}`をシェルへ直接埋め込む箇所は他に無い。`if: ${{ !cancelled() }}`はステップ条件式でシェル展開ではないため対象外。env:のSecrets代入も安全。→ 残存なし

## 発見したバグ・問題点(FAILの原因)
- なし。

## 軽微な改善点(ブロッカーではない)
- `test/pipeline.test.ts:315`の時刻依存テストが実時刻によって決定的に失敗する(本評価の3回連続実行でも1件fail固定)。Sprint 9のスコープ外(Sprint 8由来、`git status`上`src`/`test`は未変更)だが、将来スプリントでテスト内の時刻を固定注入(モック)して脱flaky化することが望ましい。

## 未検証項目(実機確認が必要)
- GitHub Actions上での実起動全般: `workflow_dispatch`の手動発火・cron-job.orgからのREST API起動・GitHub Secrets読み込み・履歴コミット&プッシュ・追加した`case`文入力検証の実動作。本環境はローカルかつリモート未接続のため構造的に確認不能(仕様書の評価基準補足で許容された範囲)。手順書・ワークフロー定義・シェルロジックはコードレビューとYAML/型/テスト検証で確認済み。
- cron-job.org側の実登録: 仕様どおり利用者操作のためスコープ外。

## プレビュー画像(PASSかつ画面を持つプロダクトの場合のみ)
- 該当なし(画面を持たないバックエンド自動化)。

## 関連ドキュメント
- [[sprint-9-selfeval]](ジェネレーターの自己評価レポート)
- [[sprint-9-brief]](本スプリントの仕様抜粋)
