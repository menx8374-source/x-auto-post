# 外部cronサービス(cron-job.org)からのトリガー設定手順

F8(外部cronサービスからのトリガー連携)の実運用手順書。GitHub Actionsの`schedule`は実行遅延・不発が起こりうるため、**この手順で設定する外部cronジョブを主経路**とする。GitHub Actions側の`schedule`はあくまでバックアップ(詳細は[`.github/workflows/post.yml`](../.github/workflows/post.yml)のコメントおよび[README.md](../README.md)「F8」節)。

対象ワークフロー: `.github/workflows/post.yml`(リポジトリ: `menx8374-source/x-auto-post` を前提に記述する。実際のリポジトリ名が異なる場合はURL中の`menx8374-source/x-auto-post`部分を読み替える)。

## 0. 前提条件(利用者が事前に用意するもの)

1. **GitHub Personal Access Token(PAT)** — `workflow_dispatch`をAPI経由で起動する**ためだけ**に使うトークン。必要最小限の権限に留める。
   - Fine-grained PAT の場合: 対象リポジトリに対して **Actions: Read and write** 権限のみを付与する(`Contents`権限は不要)。
   - Classic PAT の場合、より狭いスコープを選べないため代替として`workflow`スコープを付与する(`repo`/`public_repo`のような広いスコープは避ける)。
   - 発行場所: GitHubの `Settings > Developer settings > Personal access tokens`。
   - **注意**: 投稿履歴(`data/history/post-history.json`)のコミット・プッシュは、このPATではなくワークフロー自身の`GITHUB_TOKEN`(`.github/workflows/post.yml`の`permissions: contents: write`)が行う。cron-job.orgに渡すPATに`Contents`権限は不要であり、第三者サービスに長期保存されるトークンであるため、漏洩時の被害範囲を抑えるためにも付与しないこと。
   - **有効期限に注意**: PATが失効すると外部cronからの起動が全て失敗する(不発)ようになる。期限管理は利用者の責任範囲(仕様書のリスク・留意事項に明記済み)。
2. **GitHub Actions Secrets** — 対象リポジトリの `Settings > Secrets and variables > Actions` で以下を登録済みであること(実際の値は本手順書には書かない。プレースホルダのみ)。
   - `ANTHROPIC_API_KEY`
   - `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_SECRET`
   - (任意) `ANTHROPIC_MODEL` / `POST_RECOVERY_WINDOW_HOURS`
   - (任意、F12: 運用パラメータ) `POST_SLOT_MORNING_TIME` / `POST_SLOT_NOON_TIME` / `POST_SLOT_EVENING_TIME` / `POST_LANGUAGE` / `POST_TONE` / `POST_MAX_BODY_TWEETS` / `POST_LINK_TWEET_ENABLED` / `POST_LINK_TWEET_POSITION`(未設定ならコード側の既定値を使う。詳細は[README.md](../README.md)「環境変数」節)
   - (任意、F10: 通知) `NOTIFY_WEBHOOK_URL`(投稿失敗・候補なし・不発リカバリ超過時にSlack incoming webhook等へ通知したい場合。未設定でもGitHub Actionsのジョブサマリーで結果を確認できる)
3. **cron-job.org のアカウント**(無料プランで可) — https://cron-job.org/ でアカウント登録する。
4. **リポジトリのWorkflow permissions** — `Settings > Actions > General > Workflow permissions` を「Read and write permissions」に設定しておく(投稿履歴コミットのステップがデフォルトの`GITHUB_TOKEN`でpushするため)。

## 1. 叩くエンドポイントの仕様(GitHub REST API)

cron-job.org側の各ジョブは、指定した時刻に以下のHTTPリクエストを送信するよう設定する。

- **URL**:
  ```
  https://api.github.com/repos/menx8374-source/x-auto-post/actions/workflows/post.yml/dispatches
  ```
  (`post.yml` は `.github/workflows/post.yml` のファイル名。ワークフローIDの数値でも代替可だが、ファイル名指定の方が分かりやすいためこちらを推奨)
- **HTTPメソッド**: `POST`
- **必須リクエストヘッダ**:
  | ヘッダ名 | 値 |
  |---|---|
  | `Authorization` | `Bearer <YOUR_GITHUB_PAT>` (上記0-1で発行したPATに置き換える。**平文のトークンをこの手順書や公開リポジトリに書かない**) |
  | `Accept` | `application/vnd.github+json` |
  | `X-GitHub-Api-Version` | `2022-11-28` |
  | `Content-Type` | `application/json` |
- **リクエストボディ**(JSON、投稿枠ごとに`inputs.slot`を変える):
  ```json
  {
    "ref": "main",
    "inputs": {
      "slot": "morning",
      "mode": "post"
    }
  }
  ```
  - `ref`: ワークフローファイルが存在するブランチ名(既定ブランチが`main`でない場合は読み替える)。
  - `inputs.slot`: `morning` / `noon` / `evening` のいずれか(ジョブごとに固定値で明示指定する。起動時刻からの自動判定`auto`に頼らず、cron-job.org側の時刻とGitHub Actions側のslot入力を一致させることで、外部cronの実行遅延に対しても意図した枠として記録される)。
  - `inputs.mode`: 通常運用は`"post"`固定。動作確認だけしたい場合は一時的に`"dryrun"`に変更して手動実行する(実際にはXへ投稿されない)。
  - `inputs.account`(任意、複数Xアカウント対応): 使用するアカウントID(`src/accounts.ts`に登録済みのもの)。省略した場合は既定値`"ai-news"`(既存のデフォルトアカウント)が使われるため、**既存のcron-job.orgジョブ(このパラメータを含まないもの)は変更不要でそのまま動作する**。新規アカウントを追加した場合のみ、そのアカウント用のジョブのリクエストボディにこのフィールドを追加する。

成功時のレスポンスは `204 No Content`(ボディなし)。認証・権限エラーの場合は`401`/`404`が返る(PATの権限不足、リポジトリ名・ワークフローファイル名の誤り等を疑う)。

参考: 上記と同じ内容を`curl`で叩く場合(cron-job.org設定前の動作確認・デバッグ用。`<YOUR_GITHUB_PAT>`は自分のPATに置き換える)。

```bash
curl -X POST \
  -H "Authorization: Bearer <YOUR_GITHUB_PAT>" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Content-Type: application/json" \
  https://api.github.com/repos/menx8374-source/x-auto-post/actions/workflows/post.yml/dispatches \
  -d '{"ref":"main","inputs":{"slot":"morning","mode":"dryrun"}}'
```

## 2. cron-job.orgでのジョブ設定(3枠ぶん)

cron-job.orgのダッシュボードで「Create cronjob」から、以下の内容で**3つ**のジョブを作成する(UI項目名は cron-job.org 側の改修により多少変わる場合があるが、設定すべき内容は共通)。

| ジョブ名(例) | JST時刻 | 対応するUTC時刻(cron式) | `inputs.slot` |
|---|---|---|---|
| x-auto-post-morning | 07:30 | 22:30(前日) → `30 22 * * *` | `morning` |
| x-auto-post-noon | 12:15 | 03:15 → `15 3 * * *` | `noon` |
| x-auto-post-evening | 21:00 | 12:00 → `0 12 * * *` | `evening` |

各ジョブの設定項目:

1. **Title**: 表の「ジョブ名」を入力(任意の名前でよい)。
2. **URL**: 上記1章のURL(`https://api.github.com/repos/menx8374-source/x-auto-post/actions/workflows/post.yml/dispatches`)。
3. **Schedule**: 表の「対応するUTC時刻」を設定する。cron-job.orgのタイムゾーン設定がUTCの場合は上記cron式をそのまま使う。タイムゾーンをAsia/Tokyoに設定できる場合はJST時刻(07:30/12:15/21:00)をそのまま設定してもよい(いずれかに統一し、両方を混在させない)。
4. **Request method**: `POST`
5. **Request headers**: 上記1章の表の4ヘッダを登録する(`Authorization`の値にはPATの実値を入力する。cron-job.org上に保存されるため、他者と共有アカウントを使わない・PATの権限は最小限にする)。
6. **Request body**: 上記1章のJSON(`inputs.slot`だけジョブごとに`morning`/`noon`/`evening`に変える)。
7. **保存後、一度「Run now」等のテスト実行機能があれば手動実行し、GitHub側の Actions タブでワークフローが起動していることを確認する。**

## 3. 動作確認

1. GitHubリポジトリの `Actions` タブ → `X 投稿実行(外部cron経由のworkflow_dispatch)` ワークフローを開く。
2. 「Run workflow」から手動実行し、`mode`を`dryrun`、`slot`を`morning`等に指定して実行する。実際にXへ投稿されず、ログに投稿予定プレビューが出力されることを確認する。
3. cron-job.org側のジョブを保存後、上記1のURLに対してジョブ実行が成功(HTTP 204)したことをcron-job.orgの実行履歴で確認する。
4. GitHub Actions側でも該当時刻にワークフローが起動していることを確認する。

## 4. 複数Xアカウント対応: 新規アカウント追加時の設定

`src/accounts.ts`に新しい`AccountProfile`を登録した場合(手順は[README.md](../README.md)「複数Xアカウント対応(基盤)」節を参照)、そのアカウント専用のcron-job.orgジョブを**追加**で作成する(既存のデフォルトアカウント用ジョブは変更不要)。

- リクエストボディに`inputs.account`を追加する(新規登録した`AccountProfile.id`の値):
  ```json
  {
    "ref": "main",
    "inputs": {
      "slot": "morning",
      "mode": "post",
      "account": "genre2"
    }
  }
  ```
- URL・HTTPメソッド・認証ヘッダは既存ジョブと同じ(上記1章参照)。
- GitHub Actions側(`.github/workflows/post.yml`)に、新しいアカウントIDを許可リストへ追加する`case`分岐と、対応するサフィックス付きGitHub Secrets(`ANTHROPIC_API_KEY__<SUFFIX>`等)を読み込む`env:`エントリを事前に追加しておくこと(未追加のまま`inputs.account`に未知のIDを送るとワークフローが`invalid account input`で失敗する)。

## 5. トラブルシューティング

- **401/404が返る**: PATの権限不足(`workflow_dispatch`にはActions書き込み権限が必要)、リポジトリ名・ワークフローファイル名の誤り、PATの有効期限切れを疑う。
- **ワークフローは起動するが投稿されない**: GitHub Actions側のRun詳細ログを確認する。`stage:"skipped"`, `skipReason:"already-posted"`はその枠が既に投稿済み(冪等性チェック)で正常な動作。`skipReason:"outside-recovery-window"`は不発リカバリの許容範囲(既定3時間)を超えているため意図的にスキップしたもの。
- **投稿履歴(`data/history/post-history.json`)がリポジトリに反映されない**: ワークフローの「Commit updated post history」ステップのログを確認する。GitHub Actionsのデフォルト`GITHUB_TOKEN`に`contents: write`権限が付与されていない場合(組織/リポジトリ設定で読み取り専用に制限されている場合)は失敗する。その場合はリポジトリの `Settings > Actions > General > Workflow permissions` を「Read and write permissions」に変更する。
