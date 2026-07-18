# X AIニュース自動投稿システム

X(旧Twitter)上で、Web上で今まさに注目度が急上昇している最新のAIニュースを自動で選び、要約したポストを1日3回の高インプレッション時間帯に自動投稿するバックエンド自動化システム。文字数制限を厳守し、収まらない場合はスレッド分割し、元記事リンクを別ツイートとして付与する。運用者は自分のXアカウントを運用する個人1名で、投稿の自動生成・自動投稿だけを目的とする(画面・複数ユーザー機能・収益化機能は持たない)。

詳細な機能一覧・受け入れ基準は [docs/spec/x-ai-news-autopost-spec.md](docs/spec/x-ai-news-autopost-spec.md) を参照。

## 起動方法

```bash
npm install

# F1: 急上昇AIニュースの収集・スコアリングを実行(コマンド1つ)
npm run collect

# 検証用: 「古く話題も伸びていない記事」を候補に混ぜて、上位3件に入らないことを確認する
npm run collect -- --inject-decoy

# F2: 収集済み候補から投稿対象1件を既出回避して選定する(コマンド1つ)
npm run select

# 直近の npm run collect の出力(data/output/latest-candidates.json)を使って選定する(再収集せず、デモ・検証に便利)
npm run select -- --from-cache

# 選定しても履歴に記録しない(繰り返し検証したいときに履歴を汚さない)
npm run select -- --from-cache --dry

# F3: 直近の npm run select の出力(data/output/latest-selection.json)から
# 選定記事に対応する日本語の投稿文面をClaude(Anthropic API)で生成する
npm run generate

# F4/F5: 直近の npm run generate の出力(data/output/latest-post.json)から、
# 文字数上限厳守・スレッド分割・元記事リンクツイート付与済みの投稿予定ツイート配列を作る(Xへは投稿しない)
npm run thread

# F11: ドライラン(投稿せずプレビュー)。収集→選定→生成→分割→リンク付与を
# 本番投稿とまったく同じ処理で一気通貫実行し、投稿予定の全ツイートを表示する。Xへは1件も投稿しない。
npm run dryrun

# 検証用: 「古く話題も伸びていない」ダミー候補を混ぜて実行する
npm run dryrun -- --inject-decoy

# 既定では投稿履歴(既出判定用)に書き込まない。あえて記録したい場合のみ明示的に指定する
npm run dryrun -- --write-history

# F9: 投稿枠(任意の文字列。Sprint8で朝/昼/夜の実値が渡されるようになる)を指定すると、
# 同一枠・同一日の二重投稿防止(冪等性)チェックが有効になる
npm run dryrun -- --write-history --slot=morning

# F9: 予定時刻(--scheduled-at)も指定すると、不発リカバリの許容範囲チェックも有効になる
# (許容範囲を超える場合は「補って投稿」せずスキップする)
npm run dryrun -- --write-history --slot=morning --scheduled-at=2026-07-16T00:00:00.000Z

# F6: 本番投稿。収集→選定→生成→分割→リンク付与→実際にXへスレッド投稿する(npm run dryrunと同じパイプライン、
# 差異は最後に呼ぶpublish関数のみ)。X_API_KEY等が未設定の場合は投稿処理でAPIを呼ばず安全にエラー終了する。
npm run post

# 検証用: 「古く話題も伸びていない」ダミー候補を混ぜて実行する
npm run post -- --inject-decoy

# F9: 本番投稿でも --slot / --scheduled-at を指定できる
npm run post -- --slot=morning --scheduled-at=2026-07-16T00:00:00.000Z

# F7: --auto-slot を指定すると、--slot/--scheduled-at を手動指定する代わりに、現在時刻から
# 朝(07:30)/昼(12:15)/夜(21:00) JSTのどの投稿枠に該当するかを自動判定する(Sprint9のcron連携で使う想定)
npm run dryrun -- --write-history --auto-slot
npm run post -- --auto-slot

# F7: --now でテスト用に時刻を注入できる(--auto-slotと併用。省略時は実際の現在時刻を使う)
npm run dryrun -- --auto-slot --now=2026-07-16T22:30:00.000Z

# 複数アカウント対応: --account=<id> で使用するアカウントを指定できる(省略時は既存のデフォルトアカウント "ai-news")
npm run dryrun -- --account=ai-news
npm run post -- --account=ai-news

# アフィリエイト投稿(AIニュース3枠とは独立したパイプライン。詳細は下記「アフィリエイト投稿」節)
npm run dryrun:affiliate -- --write-history
npm run post:affiliate -- --auto-slot

# テスト実行
npm test

# 型チェック
npm run typecheck
```

`npm run collect` を実行すると、Hacker News / Reddit(r/artificial, r/MachineLearning, r/OpenAI) / RSS(TechCrunch AI, VentureBeat AI, The Verge AI, Google News AI検索)から候補を収集し、急上昇スコア降順のテーブルをコンソールに出力し、構造化データを `data/output/latest-candidates.json` に保存する。一部の情報源への通信が失敗しても処理全体は継続し、失敗はログ(`[WARN]`)に残る。

`npm run select` を実行すると、候補リストから「過去に投稿(選定)済みのURL・実質同一記事・スコアしきい値未満」を除外した上で最高スコアの1件を選定し、タイトル・URL・スコア・選定理由をログに出力する。選定結果は `data/output/latest-selection.json` に保存され、選定した記事は `data/history/post-history.json`(記事URL・タイトル・スコア・選定日時に加え、Sprint 7以降は投稿枠(slot)・投稿完了日時(postedAt)・ツイートID(tweetIds)・状態(status)も記録。既出判定・冪等性判定に使う実行時の状態ファイル。Sprint 9以降、GitHub Actions上での実行後にこのファイルをコミットして永続化するため**git管理対象**)に追記される。有効な候補が1件もない場合は投稿せず、理由付きで `[WARN]` ログに残す(Xへの投稿はSprint 6以降で実装)。

### F9: 投稿状態・履歴管理と冪等性(不発リカバリ)

`src/postHistory.ts` が投稿履歴(`data/history/post-history.json`。Sprint 9以降git管理対象、詳細はF8節)の読み書きに加え、以下を提供する。

- **冪等性**: `runPostingPipeline()` に `slot`(投稿枠)を指定すると、実行開始時に `hasPostedSlotOnDate()` で「本日その枠が既に投稿済み(status:"posted")か」を判定し、済みならAPI呼び出し(収集・生成・投稿)を一切行わず `stage:"skipped"`, `skipReason:"already-posted"` で安全に終了する。同一枠・同一日の二重起動があっても二重投稿されない。
- **不発リカバリ**: `slot` と合わせて `scheduledAt`(その枠の本来の予定時刻、ISO8601)を指定すると、`isWithinRecoveryWindow()` で予定時刻からの経過時間を判定する。許容範囲(既定3時間、`POST_RECOVERY_WINDOW_HOURS` 環境変数または `recoveryWindowHours` オプションで上書き可)内なら投稿を補い、範囲外(例: 深夜に朝枠)なら `stage:"skipped"`, `skipReason:"outside-recovery-window"` で投稿しない。
- **投稿結果の反映**: 投稿(publish)が成功/失敗した場合、選定時に書き込んだ履歴エントリへ `updateHistoryEntry()` で投稿枠・投稿日時・ツイートID・状態(`status: "posted" | "failed"`)を反映する(ドライラン等の未送信時は反映しない)。
- `npm run dryrun` / `npm run post` はいずれも `--slot=<枠名>` / `--scheduled-at=<ISO8601>` を手動指定として受け付ける。
- 履歴は明示的に削除しない限りすべて残り、F2の既出判定(`selectPost.ts`)に引き続き利用される。Sprint 2形式(slot等のフィールドが無い)の既存データもそのまま読み込める(後方互換)。

### F7: 1日3回・固定時刻でのスケジュール投稿

`src/postSchedule.ts` の `POST_SLOTS` が、投稿枠(朝/昼/夜)の目安時刻(JST基準)を1箇所で定義する唯一の設定箇所(初期値: 07:30 / 12:15 / 21:00 JST)。この時刻を変更したい場合はここだけを編集すればよい。

- `resolveCurrentSlot(now)` が、現在時刻(または注入した時刻)から「その枠の目安時刻以降・許容範囲(既定はF9と同じ `POST_RECOVERY_WINDOW_HOURS`、既定3時間)以内」であればその枠と判定する。どの枠の実行タイミングでもない場合は `null` を返す。
- `npm run dryrun -- --auto-slot` / `npm run post -- --auto-slot` は、`--slot`/`--scheduled-at` を手動指定する代わりにこの判定結果を使う。該当する枠が無い時刻に実行した場合はAPI呼び出しを一切行わず `stage:"skipped"`, `skipReason:"no-active-slot"` として安全に終了する(結果は `data/output/latest-dryrun.json` / `latest-publish.json` に記録)。
- `--now=<ISO8601>` でテスト用に時刻を注入できる(`--auto-slot` と併用。省略時は実際の現在時刻を使う)。

`npm run generate` を実行すると、`data/output/latest-selection.json` の選定記事をもとに、Claude(Anthropic API)で日本語の投稿文面を1つ生成し、コンソールに表示した上で `data/output/latest-post.json` に保存する(`{ success: true, text, candidate }` または失敗時 `{ success: false, error, candidate }`)。`ANTHROPIC_API_KEY` が未設定、またはAPI呼び出しが失敗した場合や生成結果がタイトルの丸写しに近い/空/長すぎる等の検証に通らない場合は、投稿処理には進まず `success: false` としてエラーを記録し、プロセスは終了コード1で終わる(壊れた/空の投稿をしない)。

`npm run thread` を実行すると、`data/output/latest-post.json` の生成済み本文を、Xの文字数計算方式(半角1・全角2換算、URLはt.co固定重み23換算、上限280)で判定し、上限内なら単一ツイート・超過するなら文/読点/単語単位の意味のまとまりを保った区切りで複数ツイート(各ツイートに `(1/3)` 等の順序表記付き、最大 `MAX_BODY_TWEETS`(6)本まで。超える場合は末尾を省略記号で丸める)に分割し、末尾に元記事URLを含むリンクツイートを1件追加した「投稿予定のツイート配列」をコンソールに表示した上で `data/output/latest-thread.json` に保存する。このスプリントではXへの実投稿は行わない(Sprint 6で実装予定)。`npm run generate` が未実行/失敗している場合は `[WARN]` を出し、終了コード1で安全に終わる。

`npm run dryrun` を実行すると、F1〜F5(収集→選定→生成→分割→リンク付与)を `src/pipeline.ts` の共通パイプライン(`runPostingPipeline`)1本で一気通貫実行し、投稿予定の全ツイート(順序・各文字数・リンクツイート含む)をコンソールに表示した上で `data/output/latest-dryrun.json` に保存する。Xへは1件も投稿しない。既定では投稿履歴(`data/history/post-history.json`、既出判定用)に書き込まない。あえて記録したい場合のみ `--write-history` を付ける。`--inject-decoy` で検証用ダミー候補を混ぜられる。共通パイプラインは最後に呼ぶ「投稿する」関数(`publish`)だけを差し替え可能な設計になっており、このコマンドは送信しない `dryRunPublish` を渡している。本番投稿(`npm run post`)は、収集〜リンク付与までの同じパイプラインに、実際にX APIへ送信する `xApiPublish` 関数を渡すだけで差し替えられる(コード上の差異は「実際に送信するか否か」のみ)。いずれかの段階(選定候補なし・生成失敗等)で止まった場合は `[WARN]`/`[ERROR]` ログとともに理由を出力し、終了コード1で安全に終わる。

`npm run post` を実行すると、`npm run dryrun` と同じパイプラインで、最後に実際にX API v2(`twitter-api-v2`)へスレッドを投稿する(`src/xPublish.ts`)。1件目を投稿後、2件目以降は直前のツイートIDへの返信(`in_reply_to_tweet_id`)として投稿し、1本のスレッドとして連結する。途中のツイート投稿が失敗した場合、そこまでの投稿済みツイートID・失敗箇所を記録して以降の投稿は行わない。X APIのレート制限(HTTP 429)を検知した場合は既定で最大2回・待機上限60秒の範囲でのみリトライし、それを超える場合は諦めて理由を記録する(無制限リトライ・連投回避策は行わない)。全件投稿成功時は投稿したツイートID群と投稿完了時刻を記録する。結果は `data/output/latest-publish.json` に保存される。`X_API_KEY`/`X_API_SECRET`/`X_ACCESS_TOKEN`/`X_ACCESS_SECRET` のいずれかが未設定の場合はAPIを呼び出さず安全にエラーとして終了する。

### 元記事のOGP画像添付

共通パイプライン(`src/pipeline.ts`)は、分割・リンク付与の後・投稿の前に `src/ogpImage.ts` を使って選定記事のURLからOGP画像(`<meta property="og:image">` 等)を取得する。取得できた場合、`npm run post` はスレッド**1件目(本文ツイート)にのみ**画像を添付する(twitter-api-v2の `client.v1.uploadMedia()` でアップロードし、`media_ids` として付与)。末尾のリンクツイートには添付しない。

- 画像URLはダウンロード前にスキームが `http:`/`https:` のみであることを検証し、それ以外(`javascript:`/`file:`等)は拒否する。
- ダウンロード時はContent-Typeが `image/*` であることと、サイズが上限(5MB)以内であることを確認する。
- 記事にog:imageが無い・HTML取得やダウンロードに失敗・検証に失敗・X側へのアップロードに失敗、のいずれの場合も画像なしで投稿処理を継続する(既存のソース通信失敗時と同じ「失敗を許容し処理継続」の方針)。
- `npm run dryrun` は実際にXへは投稿しないが、OGP画像の取得・ダウンロードは本番と同じ処理を通るため、取得できた場合はプレビューに画像URLが表示される(`data/output/latest-dryrun.json` の `ogpImageUrl` にも記録)。

### F8: 外部cronサービスからのトリガー連携(GitHub Actions workflow_dispatch)

GitHub Actionsの`schedule`(cron)トリガーは実行遅延・不発が多いため、**主経路は cron-job.org 等の外部無料cronサービスから GitHub Actions の `workflow_dispatch` REST APIエンドポイントを定時に叩く方式**にする。

- ワークフロー定義: [`.github/workflows/post.yml`](.github/workflows/post.yml)。`workflow_dispatch`イベントで起動し、入力として`slot`(`auto`/`morning`/`noon`/`evening`)と`mode`(`post`=本番投稿/`dryrun`=動作確認のみ)を受け取る。実行内容は`slot=auto`のとき`npm run post -- --auto-slot`相当、`slot`を明示指定したときは`npm run post -- --slot=<slot>`相当(`mode=dryrun`のときは同等の`dryrun`コマンド)。
- 必要な環境変数はGitHub Actions側の**Repository Secrets**(`ANTHROPIC_API_KEY`/`X_API_KEY`/`X_API_SECRET`/`X_ACCESS_TOKEN`/`X_ACCESS_SECRET`。任意で`ANTHROPIC_MODEL`/`POST_RECOVERY_WINDOW_HOURS`)として登録する(リポジトリの `.env` とは別物。GitHub Actions上では`.env`ファイルは使わない)。
- 実行後、`data/history/post-history.json`(投稿履歴。冪等性・既出判定に使う)に変更があればワークフローがコミット・プッシュしてリポジトリへ永続化する(GitHub Actionsのチェックアウトは実行ごとに使い捨てのため、コミットしない限り次回実行が前回の状態を参照できない)。差分が無ければコミットはスキップされる。
- `schedule`トリガーも定義されているが、あくまで外部cronが不発だった場合の**バックアップ用途**であり主経路ではない(ワークフロー内のコメント参照)。冪等性チェックにより、外部cron経由で既に投稿済みならバックアップ実行は何も送信せず安全にスキップされる。
- cron-job.org等で3枠ぶんのジョブを設定する具体的な手順(叩くURL・HTTPメソッド・認証ヘッダ・リクエストボディ・設定時刻)は [`docs/cron-setup.md`](docs/cron-setup.md) を参照。

### F12: 設定管理(運用パラメータの一元化)

投稿時刻・言語/トーン・最大ツイート本数・リンクツイート有無/位置・許容遅延など、運用パラメータ(挙動系設定)は `src/config.ts` に一元化されている。**認証情報系の設定(`ANTHROPIC_API_KEY`/`X_API_KEY`等)とは別モジュールとして分離**しており、`config.ts`は認証情報の実値を一切保持・出力しない(設定済みかどうかの真偽値のみを扱う)。

- 変更方法は環境変数(`.env`、下表参照)。値は呼び出しのたびに`process.env`から読み直すため、`.env`を編集して再実行すれば即座に反映される。
- **起動時のバリデーション**: `npm run dryrun` / `npm run post`(内部的には共通パイプライン`runPostingPipeline()`)の実行開始時に、すべての挙動系設定値と「X API認証情報が一部だけ設定されている(設定ミスの疑い)」状態をまとめて検証する。不正値(未設定必須項目・不正な時刻形式・範囲外の値等)が1つでもあれば、壊れた設定のまま投稿処理へ進まず、検出したすべての問題を1つのエラーメッセージにまとめて表示しプロセスを終了する(終了コード1)。

### F10: 実行ログとエラー通知

各実行(`npm run dryrun` / `npm run post`)は、開始・収集した候補件数・選定記事・生成した投稿本文・投稿結果(成功/失敗/未送信)を構造化ログ(`src/logger.ts`)としてコンソールに出力する。認証情報系の環境変数(`ANTHROPIC_API_KEY`/`X_API_KEY`等)の実値がログのメッセージ・付加情報に含まれていた場合、`src/logger.ts`が既知の値と一致する部分文字列を`***MASKED***`に置換してから出力する(多層防御。通常の実装では実値をログに渡していないが、誤って渡ってしまった場合の安全網)。

投稿失敗・投稿対象なし・不発リカバリの許容範囲超過など、利用者の対応が必要な事象が発生した場合の通知手段は2つ:

1. **GitHub Actionsのジョブサマリー(既定)**: `.github/workflows/post.yml`の`Write job summary`ステップが、実行結果(成功/失敗/停止段階/スキップ理由/選定記事/投稿結果)を`$GITHUB_STEP_SUMMARY`に書き出す。GitHub Actionsの実行一覧から一目で結果が分かる。投稿処理自体が失敗した場合はワークフロー自体も失敗扱いになり、GitHubの標準通知(リポジトリの通知設定に従うメール等)も届く。
2. **任意のWebhook**: `NOTIFY_WEBHOOK_URL`環境変数(Slack incoming webhook等、JSON POSTを受け付ける任意のエンドポイントを想定)を設定すると、`npm run post`実行時に投稿失敗・候補なし・不発リカバリ超過が発生した場合、同じ内容をそこにも通知する(`src/notify.ts`)。未設定時は実行ログに残るのみ(通知の送信自体は行わない)。通知の送信に失敗してもパイプライン本体は失敗させない(ベストエフォート)。

### 複数Xアカウント対応(基盤)

`src/accounts.ts`が、アカウント(情報源・言語/トーン・ジャンル・認証情報環境変数名・投稿履歴ファイル)を1箇所で管理するレジストリ(`ACCOUNT_PROFILES`)を持つ。既存のデフォルトアカウント(`id: "ai-news"`)は、既存の情報源(Hacker News/Reddit/RSS各種)・`POST_LANGUAGE`/`POST_TONE`環境変数による上書き・サフィックス無しの認証情報環境変数(`ANTHROPIC_API_KEY`/`X_API_KEY`等)・既存の`data/history/post-history.json`をそのまま使う(このモジュール追加による動作変更なし)。

- `npm run dryrun -- --account=<id>` / `npm run post -- --account=<id>` で使用するアカウントを指定できる(省略時はデフォルトアカウント)。
- `.github/workflows/post.yml`の`workflow_dispatch`入力`account`(省略時`ai-news`)で、外部cron経由の実行でもアカウントを指定できる。

**新規アカウントを追加する手順**:

1. `src/accounts.ts`の`ACCOUNT_PROFILES`配列に新しい`AccountProfile`エントリを追加する。
   - `id`: 新しい一意な識別子(例: `"genre2"`)。
   - `label`/`genre`: 表示名・生成プロンプトに使うジャンルの説明。
   - `language`/`tone`: 生成する投稿文面の言語・トーン(デフォルトアカウントと異なりPOST_LANGUAGE/POST_TONEでは上書きされない固定値)。
   - `sources`: このアカウント専用の情報源リスト(`src/sources/`配下、または新規追加したもの)。
   - `filterCandidates`: このジャンルに絞り込むフィルタ関数(既存の`filterAiRelated`を流用してもよいし、新しいジャンル用の関数を実装してもよい)。
   - `credentialsEnvSuffix`: 任意のサフィックス文字列(例: `"GENRE2"`)。**デフォルトアカウント以外は必ず指定する**(未指定だと既存アカウントと同じ環境変数を共有してしまう)。
   - `historyFilePath`: `path.join(process.cwd(), "data", "history", "post-history-<id>.json")` のような、デフォルトアカウントとは別のパス。
2. GitHub Secretsに、指定したサフィックス付きの認証情報を追加登録する: `ANTHROPIC_API_KEY__<SUFFIX>` / `X_API_KEY__<SUFFIX>` / `X_API_SECRET__<SUFFIX>` / `X_ACCESS_TOKEN__<SUFFIX>` / `X_ACCESS_SECRET__<SUFFIX>`(既存のデフォルトアカウント用Secretsは変更不要)。
3. `.github/workflows/post.yml`の「Run posting pipeline」ステップに、上記Secretsを読み込む`env:`エントリと、新しいアカウントIDを許可する`case`分岐を追加する(ワークフロー内のコメント参照)。
4. cron-job.org側は、新規アカウント用のジョブのリクエストボディに`inputs.account`を追加する(既存ジョブは変更不要): `{"ref":"main","inputs":{"slot":"morning","mode":"post","account":"genre2"}}`。詳細手順は[docs/cron-setup.md](docs/cron-setup.md)を参照。

### アフィリエイト投稿(AIニュース3枠とは独立したパイプライン)

AIニュース投稿(朝/昼/夜3枠)とは完全に独立した、アフィリエイト商品紹介の投稿パイプライン。既存のAIニュース投稿の動作・履歴には一切影響しない。

- **商品情報**: `data/affiliate-products.json`(git管理対象)にユーザーが手動で商品を追加する。型定義は`src/affiliateProducts.ts`。各エントリ: `id`/`name`/`officialUrl`/`affiliateUrl`(ユーザーが手動入力するアフィリエイトリンク)/`facts`(事実ベースの特長の箇条書き、公式情報からユーザーが手動記入。AIは書かない)/`category`(任意)/`enabled`。初期状態は空配列で、商品が0件でもエラーにならず「投稿対象なし」として安全にスキップする。
- **選定(ローテーション)**: `src/selectAffiliateProduct.ts`が、`enabled:true`の商品のうち投稿回数(`data/history/affiliate-post-history.json`)が上限(既定3回、`AFFILIATE_MAX_POSTS_PER_PRODUCT`で変更可)未満のものから、最も直近に投稿していない商品を選ぶ。全商品が上限に達している場合も理由付きで安全にスキップする。
- **生成**: `src/generateAffiliatePost.ts`がClaude(Anthropic API)で紹介文を生成する。`facts`の範囲でのみ紹介し、以下を厳格に守る:
  - 本文の先頭に必ず「【PR】」を含める(景品表示法のステルスマーケティング規制対応)。プロンプトで指示するだけでなく、コード側の安全網(`ensurePrLabel`)でも常に先頭に付与することを保証する。
  - `facts`に書かれていない特長・効果を創作しない。
  - 「私は使ってみて〜」のような一人称の実体験談は書かない(捏造禁止)。
  - 誇大な効果効能・断定的な優良性の主張は避ける。
  - 文字数は既存の`src/tweetLength.ts`/`src/threadSplit.ts`のロジック(`src/affiliateThread.ts`)を再利用し、Xの上限を厳守。末尾に必ずアフィリエイトリンクを含む別ツイートを付与する。
- **投稿枠・冪等性**: `src/config.ts`の`getAffiliatePostSlot()`(既定19:00 JST、`AFFILIATE_POST_TIME`で変更可)を1日1枠として判定する(`src/postSchedule.ts`の`resolveCurrentAffiliateSlot()`、AIニュース3枠の判定ロジックと同じJST基準の日境界セーフな方式)。投稿履歴は専用ファイル(`data/history/affiliate-post-history.json`、git管理対象)を使うため、AIニュースの冪等性(`hasPostedSlotOnDate`)とは独立して同日重複投稿を防止する。
- **コマンド**: `npm run dryrun:affiliate` / `npm run post:affiliate`(`--auto-slot`/`--now`/`--slot`/`--scheduled-at`/`--account`/`--write-history`はAIニュース側と同様の意味)。結果は`data/output/latest-affiliate-dryrun.json` / `latest-affiliate-publish.json`に保存される。
  - `--force`: `--auto-slot`の時間帯チェック(19:00 JST目安)をスキップし、即座に選定・生成・投稿(またはドライラン)を実行する(手動テスト用)。同日重複投稿防止・ローテーション上限の冪等性チェックは`--force`指定時も引き続き有効(スキップされるのは時間帯チェックのみ)。例: `npm run dryrun:affiliate -- --force`
- **GitHub Actions連携**: `.github/workflows/post-affiliate.yml`が、既存の`.github/workflows/post.yml`と同じ設計(`workflow_dispatch`のinputsをenv:経由+case文で許可リスト検証、実行後に投稿履歴をコミット)でアフィリエイト投稿専用のcron連携を提供する。`workflow_dispatch`の`force`入力(boolean、既定false)に`true`を指定すると、上記`--force`相当で19:00 JST以外の時間帯でも手動テストできる。GitHub SecretsはAIニュースと同じデフォルトアカウントの認証情報をそのまま使う(同じXアカウントから投稿する想定)。

## 環境変数

`.env.example` をコピーして `.env` を作成し、値を設定する(`.env` はgit管理対象外)。

### 認証情報系(必須項目のみ)

| 変数名 | 必須 | 用途 |
|---|---|---|
| `ANTHROPIC_API_KEY` | F3(投稿文面生成)を使う場合は必須 | Anthropic API(Claude)の認証キー。[console.anthropic.com](https://console.anthropic.com/)で発行(従量課金)。未設定時は文面生成がエラーとして安全に終了する。 |
| `ANTHROPIC_MODEL` | 任意 | 使用するClaudeモデルID。未設定時はコード側のデフォルト(`claude-haiku-4-5-20251001`)を使う。 |
| `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_SECRET` | F6(`npm run post`、実際にXへ投稿)を使う場合は必須 | X API v2の認証情報。[developer.x.com](https://developer.x.com/)でアプリを作成し発行する。Access Tokenには「Read and Write」権限が必要。いずれか未設定の場合、投稿処理はAPIを呼び出さず安全にエラーとして終了する(`npm run dryrun`には影響しない)。4つのうち1〜3個だけ設定されている場合は設定ミスとみなし、起動時にエラーとして検知する。 |

### 挙動系(F12、任意。未設定時はすべてコード側の既定値を使う)

| 変数名 | 既定値 | 用途 |
|---|---|---|
| `POST_SLOT_MORNING_TIME` / `POST_SLOT_NOON_TIME` / `POST_SLOT_EVENING_TIME` | `07:30` / `12:15` / `21:00` | F7: 投稿枠(朝/昼/夜)の目安時刻(JST、`"HH:MM"`形式)。 |
| `POST_LANGUAGE` | `ja` | F3: 生成する投稿文面の言語。 |
| `POST_TONE` | (中立的・正確で煽りすぎない自然なトーン) | F3: 生成する投稿文面のトーン(自由文)。 |
| `POST_MAX_BODY_TWEETS` | `6` | F4: 1スレッドに含める本文ツイートの上限本数(1以上の整数)。 |
| `POST_LINK_TWEET_ENABLED` | `true` | F5: リンクツイートを付けるかどうか(`true`/`false`)。 |
| `POST_LINK_TWEET_POSITION` | `end` | F5: リンクツイートの位置(`start`=スレッド先頭 / `end`=スレッド末尾)。 |
| `POST_RECOVERY_WINDOW_HOURS` | `3` | F9: 不発リカバリの許容範囲(時間、0以上の数値)。`--slot`と`--scheduled-at`を指定した実行で使われる。 |
| `NOTIFY_WEBHOOK_URL` | (未設定) | F10: 投稿失敗・候補なし・不発リカバリ超過時に追加で通知するWebhook URL。 |
| `AFFILIATE_POST_TIME` | `19:00` | アフィリエイト投稿枠の目安時刻(JST、`"HH:MM"`形式)。AIニュース3枠とは独立。 |
| `AFFILIATE_MAX_POSTS_PER_PRODUCT` | `3` | アフィリエイト: 同一商品の投稿回数の上限(ローテーション、1以上の整数)。 |

不正な値(未設定の必須項目・不正な時刻形式・範囲外の値・X API認証情報の一部欠落等)が1つでもあると、`npm run dryrun` / `npm run post` は起動時にすべての問題をまとめたエラーを出して終了する(壊れた設定のまま投稿処理には進まない)。

`npm run collect` / `npm run select` 単体では外部認証情報は不要(情報源はすべて無認証の無料公開API/RSS)。
