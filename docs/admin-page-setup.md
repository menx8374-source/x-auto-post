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

## 5. トラブルシューティング

- **ログインボタンを押すと404/エラーになる**: GitHub OAuth AppのAuthorization callback URLが実際のCloudflare Pagesドメインと一致しているか確認する。
- **ログインできるが商品一覧が読み込めない(401/500)**: `GITHUB_PAT`の権限(Contents: Read and write)・有効期限を確認する。
- **保存はできるがリダイレクトページが更新されない**: 管理ページの保存成功メッセージに「リダイレクトページの再生成に失敗しました」等の警告が出ていないか確認する。出ている場合はGitHub Actions の `Regenerate Affiliate Redirect Pages` ワークフローのログを確認する(PATの`Actions`権限不足が主な原因)。
- **他のGitHubアカウントでもログインできてしまう**: `ALLOWED_GITHUB_LOGIN`の値が正しいユーザー名(大文字小文字は問わない)になっているか確認する。

## 6. カテゴリからA8.netを探す

管理ページに「技術系」「転職系」「学習・スキルアップ系」「ビジネスツール系」「電子製品系」の5つの固定カテゴリボタンがある。押すと(a) 対応するキーワードでA8.netのプログラム検索結果ページを新しいタブで開き、(b) 念のためキーワードをクリップボードにもコピーする。A8.netにログイン済みであればそのまま検索結果が表示され、未ログインの場合はA8.net自身の再認証画面が表示される(自動ログイン・自動検索・自動提携申請は行わない)。商品追加/編集フォームの「A8.netで探す」ボタン(商品名で検索)も引き続き利用できる。

## 7. 公式サイトから事実情報(facts)を自動提案

商品追加/編集フォームの公式サイトURL欄付近に「公式サイトから事実情報を提案」ボタンがある(`ANTHROPIC_API_KEY`未設定の場合はエラーメッセージが表示され利用できない)。押すと公式サイトの内容を取得し、実際に書かれている事実のみを抽出した箇条書き候補を`facts`欄に**追記**する(既存の入力は上書きしない)。あくまで下書きのため、内容を確認・編集してから保存すること(自動保存はしない)。

## 8. A8.netプログラム詳細ページURLからの提携申請記録・未実装項目

A8.netの検索結果からプログラム詳細ページ(例: `https://media-console.a8.net/program/detail-not-partnered?programId=...`)を開き、そのURLをコピーして管理ページの「A8.netプログラム詳細ページURLから申請を記録」フォーム(プログラム名+URL)に貼り付けると、提携申請の追跡エントリを「申請中」として記録できる。**このURL自体はA8.netのログイン後管理画面内のページのため、サーバー側からfetchで内容を取得することはできない・しない**(URL文字列からのprogramIdクエリパラメータ抽出のみ行う)。プログラム名を入力しなかった場合、`programId`が既知の主要ブランド一覧(`admin/functions/_lib/knownA8Programs.ts`)に一致すれば自動的に補完される。

管理ページ下部の「提携申請の進捗」セクションで記録した申請の一覧を確認できる。**提携申請が実際に受理されたかどうかはユーザー本人がA8.netにログインしないと分からないため、自動検知はしない**。「申請中」のエントリを確認できたら「提携済みにする」ボタンで手動でステータスを切り替え、「提携済み」になったエントリの「商品を追加」ボタンから、既存の商品追加フォームをプログラム名のみ事前入力した状態で開ける(公式サイトURLは不明なので空欄のまま。実際のアフィリエイトリンクはA8.netで作成後にユーザー自身が貼り付ける)。

未実装・今後の拡張余地:
- 商品の削除機能は未実装(`enabled`を`false`にすることで実質的に投稿対象から外せる)。
- A8.net等ASPへの自動ログイン・スクレイピング・自動リンク取得・自動提携申請は実装していない(合意済みの除外事項)。
