---
tags: [sprint-selfeval]
sprint: 9
---

# Sprint 9 自己評価レポート

(3回目の試行。1・2回目の実装内容もこのレポートに整理して統合している)

## 実装した内容(1回目試行)
- `.github/workflows/post.yml`: `workflow_dispatch`トリガー(入力: `slot`=`auto`/`morning`/`noon`/`evening`、`mode`=`post`/`dryrun`)を主経路とするワークフロー。実行内容は`slot=auto`時`npm run post -- --auto-slot`相当、`slot`明示時`npm run post -- --slot=<slot>`相当(`mode=dryrun`時は同等の`dryrun`スクリプト)。
  - GitHub Secrets(`ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`/`X_API_KEY`/`X_API_SECRET`/`X_ACCESS_TOKEN`/`X_ACCESS_SECRET`/`POST_RECOVERY_WINDOW_HOURS`)を環境変数として実行ステップへ渡す。
  - `schedule`トリガー(3枠のおおよその時刻の5分後、UTC換算)をバックアップ用途として追加。ワークフロー内コメント・README・手順書すべてに「主経路ではない」旨を明記。
  - 実行後、`data/history/post-history.json`に差分があれば`git config`→`git add`→`git commit`(差分なければスキップ)→`git pull --rebase`→`git push`でコミット・プッシュするステップを追加(`permissions: contents: write`を明示)。投稿処理が失敗しても選定履歴だけは保存されるよう`if: ${{ !cancelled() }}`にした。
- `docs/cron-setup.md`: cron-job.orgでの3ジョブ設定手順書。叩くURL(`https://api.github.com/repos/menx8374-source/x-auto-post/actions/workflows/post.yml/dispatches`)・HTTPメソッド(POST)・必須ヘッダ(`Authorization: Bearer <YOUR_GITHUB_PAT>`等プレースホルダ)・リクエストボディ(JSON、`inputs.slot`/`inputs.mode`)・3枠それぞれのJST→UTC変換済み時刻(cron式)・curl動作確認例・トラブルシューティングを記載。PAT発行手順、Workflow permissions設定も前提条件として明記。
- `.gitignore`: `data/history/`の全面除外をやめ、`post-history.json`のみ追跡対象にする例外ルールへ変更。
- `data/history/post-history.json`を初期値`[]`で新規作成し、リポジトリに含めた。
- `README.md`: 新規「F8」節を追加(ワークフロー・Secrets・履歴コミットの仕組み・schedule=バックアップの位置づけ・手順書への導線)。

## 実装した内容(2回目試行: security-review/code-review指摘の修正)
- `docs/cron-setup.md`: cron-job.org用PATの推奨権限から不要な`Contents: Read and write`を削除し、`Actions: Read and write`のみに変更。「履歴コミット用」という誤った理由書きを削除し、履歴コミット・プッシュはPATではなくワークフロー自身の`GITHUB_TOKEN`(`permissions: contents: write`)が行う旨、および第三者サービスに長期保存されるトークンのため権限を最小限にすべき理由を明記。Classic PATもより狭い`workflow`スコープに変更。
- `.github/workflows/post.yml`:
  - `Checkout`ステップに`fetch-depth: 0`を追加(シャロークローンだと並行実行時の`git pull --rebase`が失敗しやすいため)。
  - 「Commit updated post history」ステップの`git pull --rebase && git push`を、失敗時に`git fetch origin`してから最大3回までリトライするループに変更。

## 実装した内容(3回目試行: 今回。security-reviewで検出されたHigh相当のスクリプトインジェクション脆弱性の修正)
- 指摘内容: `.github/workflows/post.yml`の「Run posting pipeline」ステップの`run:`ブロック内で、`${{ inputs.slot || 'auto' }}` / `${{ inputs.mode || 'post' }}` を直接シェルへ埋め込んでいた。`type: choice`による選択肢制限はGitHub Web UIの「Run workflow」フォームでのみ強制され、`docs/cron-setup.md`が案内するREST API経由の`workflow_dispatch`呼び出しでは任意の文字列を送信できるため、`${{ }}`のテンプレート展開がシェル実行前に行われることを悪用したスクリプトインジェクションが可能だった(このステップは全APIキー・`GITHUB_TOKEN`(contents:write)を環境に持つため実害が大きい)。
- 修正: `${{ inputs.slot }}` / `${{ inputs.mode }}` を`run:`ブロックへ直接埋め込むのをやめ、ステップの`env:`経由で`SLOT_INPUT`/`MODE_INPUT`環境変数として渡すように変更。シェル内では`"$SLOT_INPUT"` / `"$MODE_INPUT"`として`"${SLOT_INPUT:-auto}"` / `"${MODE_INPUT:-post}"`のように参照する(デフォルト値の適用もシェル側のパラメータ展開に変更)。
- 追加の防御: `case`文で`slot`(`auto`/`morning`/`noon`/`evening`)・`mode`(`post`/`dryrun`)それぞれの値を許可リストに対して検証し、一致しない値が来た場合は`echo ... >&2; exit 1`でエラー終了するようにした(choice型の制限はAPI経由では信頼できないため、シェル側でも検証する二重防御)。
- ワークフロー内の他の箇所(`Commit updated post history`ステップ等)を確認したが、`run:`ブロックに`${{ }}`を直接埋め込んでいる箇所は他になかった(`if: ${{ !cancelled() }}`はジョブ条件式であり`run:`ブロック内へのシェル展開ではないため対象外)。

## 技術選定
- 新規ライブラリの追加なし。GitHub Actions標準アクション(`actions/checkout@v4`, `actions/setup-node@v4`)のみ使用(いずれもGitHub公式、無料、追加インストール不要)。
- ワークフローYAMLの検証には`npx @action-validator/cli`(npm, MIT系OSS)を一時的に使用。プロジェクトの依存関係には追加していない。

## 受け入れ基準チェック(自己申告)
- [x] 外部から workflow_dispatch で起動できる実行ワークフローが用意され、手動発火で投稿処理(またはドライラン)が走ることを確認できる: `.github/workflows/post.yml`に`workflow_dispatch`(入力`slot`/`mode`)を定義。`mode=post`で`npm run post -- --auto-slot`相当、`mode=dryrun`で`npm run dryrun`相当が実行される。GitHub Actions上での実起動は未検証(後述、環境上の制約)。YAML構文検証(`@action-validator/cli`, exit 0)とワークフローが呼び出すCLIコマンド自体のローカル動作確認は実施済み。
- [x] ワークフローが投稿枠(朝/昼/夜)を入力として受け取れる、または起動時刻から枠を判定できる: `slot`入力(`morning`/`noon`/`evening`の明示指定、または`auto`で起動時刻からの自動判定)を実装。
- [x] cron-job.org等で3枠ぶんのジョブを設定する手順書(URL・HTTPメソッド・認証ヘッダ・ボディ・設定時刻)が提供され、認証情報はプレースホルダで示される: `docs/cron-setup.md`に記載。GitHub PAT実値・APIキー実値は一切書いていない。
- [x] schedule トリガーが主経路でなくバックアップ用途である旨がドキュメントに明記される: ワークフロー内コメント・README「F8」節・`docs/cron-setup.md`冒頭の3箇所に明記。

## アプリの起動方法
このスプリントは画面を持たないバックエンド自動化(CLI/GitHub Actions)。ローカルでの動作確認コマンド:

```bash
npm install
npm run typecheck
npm test

# ワークフローが呼び出すのと同じCLIコマンドをローカルで確認(--auto-slotの枠判定・パイプライン動作)
npm run dryrun -- --auto-slot --now=2026-07-16T22:31:00.000Z
```

ワークフローYAMLの構文検証:
```bash
npx --yes @action-validator/cli .github/workflows/post.yml
```
(3回目試行でも再実行しexit code 0を確認)

GitHub Actions上での実行そのもの(`workflow_dispatch`の手動発火・cron-job.orgからのHTTP起動)は、このスプリントの実行環境(ローカル、リモートリポジトリ未接続)では実施していない。

## 既知の問題・懸念点
- **実GitHub Actions実行は未検証**: `git remote -v`が空でGitHub上にpushもされていないため、`workflow_dispatch`の実際の手動発火・GitHub Secretsの読み込み・履歴コミット&プッシュ・今回追加した`case`文による入力検証の実動作は、GitHub Actions実行環境上では検証できていない。YAML構文検証(`@action-validator/cli`、exit 0)と、ローカルシェルでの`SLOT_INPUT`/`MODE_INPUT`未設定時のデフォルト値適用・不正値時の`case`文分岐ロジックはコードレビューベースで確認した。
- **cron-job.org側の実登録は未実施**: 仕様通りスコープ外(利用者操作)。
- **既存テストに1件、Sprint 9と無関係な既存の時刻依存flakyテストが引き続き存在**: `test/pipeline.test.ts`の「F9回帰: 深夜跨ぎのルックバック...」テストが、実行する実時刻によって失敗することがある(今回の`npm test`実行でも94件中1件失敗、`firstRun.success`が`false`)。原因は1・2回目試行時と同様、テスト内の固定オフセットと`resolveCurrentSlot`が選ぶ実際の枠時刻の組み合わせにより`isWithinRecoveryWindow`の許容範囲(30時間)を超えるケースがあること。Sprint 9で変更したファイルは`.github/workflows/post.yml`のみで`src/pipeline.ts`・`src/postSchedule.ts`・当該テストファイルには一切手を加えておらず、Sprint 9のスコープ外(Sprint 8由来)の既存不具合と判断し、本スプリントでは修正していない。

## 追加したテスト(任意)
- 該当なし(今回の修正はワークフローYAML内のシェル展開方式の変更のみで、新規のTypeScript機能追加は無いため)。修正後の検証は`@action-validator/cli`によるYAML構文チェック(exit 0)、`npm run typecheck`(エラーなし)、`npm test`(既存テストスイート、Sprint 9無関係の既知flaky1件を除き全件pass)で行った。

## 前回フィードバックへの対応(3回目・今回)
- 指摘(security-review, High相当・CONFIRMED): `.github/workflows/post.yml`の`run:`ブロックで`workflow_dispatch`の`inputs.slot`/`inputs.mode`を`${{ }}`で直接シェル展開しており、REST API経由(choice型制限が効かない経路)での任意コマンド実行(スクリプトインジェクション)が可能だった → 対応: `env:`経由(`SLOT_INPUT`/`MODE_INPUT`)で環境変数として渡すよう変更し、シェル内では`"$SLOT_INPUT"`/`"$MODE_INPUT"`として参照。加えて`case`文でslot/modeの値を許可リスト(`auto`/`morning`/`noon`/`evening`、`post`/`dryrun`)に対して検証し、不一致時はエラー終了するようにした。ワークフロー内の他の`run:`ブロックにも同様の`${{ }}`直接埋め込みがないか確認し、他には無いことを確認済み。

## 前回フィードバックへの対応(2回目試行時)
- 指摘(security-review, High相当): `docs/cron-setup.md`がcron-job.org用PATに不要な`Contents: Read and write`権限(履歴コミット用と誤記載)を推奨 → 対応: `Actions: Read and write`のみに変更し、履歴コミットはワークフロー自身の`GITHUB_TOKEN`が行う旨を明記。Classic PATのスコープも`repo`から`workflow`に縮小。
- 指摘(code-review, PLAUSIBLE): `.github/workflows/post.yml`の履歴コミットステップがシャロークローン+並行実行時に`git pull --rebase`失敗でジョブごと失敗しうる → 対応: `actions/checkout@v4`に`fetch-depth: 0`を追加。加えてリトライループに変更。

## 関連ドキュメント
- [[sprint-9-brief]]
- [[x-ai-news-autopost-spec]]
