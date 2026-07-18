# アフィリエイト管理ページ(admin/)セットアップ手順

スマホから本人のみアクセスできる、アフィリエイト商品管理ページ(`../admin/`)の実運用手順書。コード自体は実装・レビュー済みだが、以下はGitHub/Cloudflareの外部サービス操作を伴うためユーザー本人が行う必要がある(このリポジトリのコード変更だけでは完結しない)。

対象コード: [`admin/`](../admin/)(Cloudflare Pages + Pages Functions)。技術的な詳細は[`admin/README.md`](../admin/README.md)を参照。この手順書はブラウザ操作の具体的な手順に絞る。

## 0. 前提条件(利用者が事前に用意するもの)

1. **GitHub Personal Access Token(PAT)** — 管理ページが商品データのコミット・ワークフロー起動に使う専用トークン。
   - Fine-grained PAT推奨。対象リポジトリ(`menx8374-source/x-auto-post`)に対して **Contents: Read and write**・**Actions: Read and write** の2権限を付与する。
   - 発行場所: GitHubの `Settings > Developer settings > Personal access tokens > Fine-grained tokens`。
   - `docs/cron-setup.md`で発行したPAT(Actions権限のみ)とは**別に**発行することを推奨(Contents権限まで持つため、漏洩時の被害範囲を分離する)。
   - 有効期限に注意。切れると管理ページからの保存が全て失敗するようになる。
2. **GitHub OAuth App** — 管理ページへのログイン用(手順は1章)。
3. **Cloudflareアカウント**(無料プランで可) — https://dash.cloudflare.com/sign-up でアカウント登録する。
4. ログインを許可する**自分のGitHubユーザー名**(例: `menx8374-source`)。

## 1. GitHub OAuth Appの登録

1. https://github.com/settings/developers を開き、「New OAuth App」を選択する。
2. 以下を入力する。
   - **Application name**: 任意(例: `x-auto-post admin`)。
   - **Homepage URL**: 本番デプロイ後のCloudflare Pagesドメイン(例: `https://x-auto-post-admin.pages.dev`)。2章でPagesプロジェクトを作成した後にこの画面に戻って正しいドメインへ修正してよい(先に仮のURLで登録し、後で編集可能)。
   - **Authorization callback URL**: 上記ドメイン + `/api/auth/callback`(例: `https://x-auto-post-admin.pages.dev/api/auth/callback`)。
3. 登録後に発行される **Client ID** をメモする。
4. 「Generate a new client secret」で **Client Secret** を発行してメモする(この画面を離れると再表示できないため必ず控える)。

## 2. Cloudflare Pagesプロジェクトの作成

1. https://dash.cloudflare.com/ にログインし、「Workers & Pages」→「Create application」→「Pages」→「Connect to Git」を選択する。
2. `menx8374-source/x-auto-post` リポジトリを接続する(初回はCloudflareにGitHubリポジトリへのアクセスを許可する画面が出る)。
3. ビルド設定:
   - **Root directory**: `admin`
   - **Build command**: 空欄のまま(ビルドステップなし)
   - **Build output directory**: `public`
4. 「Save and Deploy」で初回デプロイを実行する。デプロイ完了後に払い出されるドメイン(例: `x-auto-post-admin.pages.dev`)を確認する。1章のGitHub OAuth AppのHomepage URL・Authorization callback URLを、このドメインの実際の値に修正しておく。

## 3. 環境変数(Secrets)の登録

Cloudflare Pagesプロジェクトの `Settings > Environment variables` で、Production環境に以下を登録する(値はすべて非公開情報のため、この手順書には書かない)。

| 変数名 | 値 |
|---|---|
| `GITHUB_PAT` | 0章で発行したPAT |
| `GITHUB_REPO` | `menx8374-source/x-auto-post` |
| `GITHUB_BRANCH` | `main` |
| `GITHUB_OAUTH_CLIENT_ID` | 1章のClient ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | 1章のClient Secret(「Encrypt」を選択して登録する) |
| `ALLOWED_GITHUB_LOGIN` | 自分のGitHubユーザー名 |
| `SESSION_SECRET` | 十分にランダムな長い文字列(例: `openssl rand -hex 32`で生成、または任意のパスワード生成ツール) |
| `ANTHROPIC_API_KEY`(任意) | ルート側の投稿パイプライン(`.env`)で使っているものと同じAnthropic APIキーでよい。「公式サイトから事実情報を提案」機能でのみ使用し、未設定でも他の機能には影響しない。 |

登録後、変更を反映するため `Deployments` タブから最新デプロイを「Retry deployment」するか、再度何かをpushして再デプロイする。

## 4. 動作確認

1. スマホ・PCのブラウザで、2章で確認したCloudflare Pagesドメインを開く。
2. 「GitHubでログイン」ボタンを押し、GitHubの認証画面で許可する。
3. `ALLOWED_GITHUB_LOGIN`に設定したアカウントでログインした場合のみ管理ページが表示されることを確認する(別アカウントでは拒否されることも合わせて確認するとよい)。
4. 商品一覧(現在は「ZENCHORD1」)が表示されることを確認する。
5. 試しに既存商品の「投稿対象」チェックボックスを一度オフ→オンに戻し、保存が成功する(数秒後にGitHubリポジトリへのコミットが作成される)ことを確認する。
6. GitHubリポジトリの `Actions` タブで、`regenerate-redirects.yml` が自動起動していることを確認する。

## 5. 候補ヒント(参考情報)の更新

「話題のAIニュース」候補ヒントは自動更新されない(既存の投稿パイプラインとは独立させているため)。更新したい場合は、GitHubリポジトリの `Actions` タブ →「Update Affiliate Candidate Hints」ワークフロー→「Run workflow」で手動起動する。定期実行にしたい場合は、`docs/cron-setup.md`と同じ要領で、cron-job.orgに`update-candidate-hints.yml`用のジョブ(workflow_dispatch、inputなし)を追加登録するとよい。

## 6. トラブルシューティング

- **ログインボタンを押すと404/エラーになる**: GitHub OAuth AppのAuthorization callback URLが実際のCloudflare Pagesドメインと一致しているか確認する。
- **ログインできるが商品一覧が読み込めない(401/500)**: `GITHUB_PAT`の権限(Contents: Read and write)・有効期限を確認する。
- **保存はできるがリダイレクトページが更新されない**: 管理ページの保存成功メッセージに「リダイレクトページの再生成に失敗しました」等の警告が出ていないか確認する。出ている場合はGitHub Actions の `Regenerate Affiliate Redirect Pages` ワークフローのログを確認する(PATの`Actions`権限不足が主な原因)。
- **他のGitHubアカウントでもログインできてしまう**: `ALLOWED_GITHUB_LOGIN`の値が正しいユーザー名(大文字小文字は問わない)になっているか確認する。

## 7. A8.netへのショートカット(申請リンク)

商品候補(候補ヒントの「商品候補」バッジ)の横、および商品追加/編集フォームの公式サイトURL欄付近に「A8.netで探す」ボタンがある。押すと(a) A8.netのトップページを新しいタブで開き、(b) 商品名をクリップボードにコピーし、(c) 案内メッセージを表示する。A8.netのプログラム検索は非公開のURLパラメータ形式のため、商品名を付与した検索結果への直リンクは作れない(壊れたリンクになるリスクがあるため意図的に実装していない)。ログイン後、コピーした商品名をプログラム検索に貼り付けて自分で検索・申請すること。

## 8. 公式サイトから事実情報(facts)を自動提案

商品追加/編集フォームの公式サイトURL欄付近に「公式サイトから事実情報を提案」ボタンがある(`ANTHROPIC_API_KEY`未設定の場合はエラーメッセージが表示され利用できない)。押すと公式サイトの内容を取得し、実際に書かれている事実のみを抽出した箇条書き候補を`facts`欄に**追記**する(既存の入力は上書きしない)。あくまで下書きのため、内容を確認・編集してから保存すること(自動保存はしない)。

## 9. 未実装・今後の拡張余地

- 候補ヒントは「最近話題のAIニュース記事一覧」の参考表示のみで、実際のアフィリエイト商品・リンクの自動提案ではない(実際のアフィリエイトプログラム登録はユーザー本人にしかできないため)。
- 商品の削除機能は未実装(`enabled`を`false`にすることで実質的に投稿対象から外せる)。
- A8.net等ASPへの自動ログイン・スクレイピング・自動リンク取得・自動提携申請は実装していない(合意済みの除外事項)。
