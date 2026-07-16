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

# テスト実行
npm test

# 型チェック
npm run typecheck
```

`npm run collect` を実行すると、Hacker News / Reddit(r/artificial, r/MachineLearning, r/OpenAI) / RSS(TechCrunch AI, VentureBeat AI, The Verge AI, Google News AI検索)から候補を収集し、急上昇スコア降順のテーブルをコンソールに出力し、構造化データを `data/output/latest-candidates.json` に保存する。一部の情報源への通信が失敗しても処理全体は継続し、失敗はログ(`[WARN]`)に残る。

`npm run select` を実行すると、候補リストから「過去に投稿(選定)済みのURL・実質同一記事・スコアしきい値未満」を除外した上で最高スコアの1件を選定し、タイトル・URL・スコア・選定理由をログに出力する。選定結果は `data/output/latest-selection.json` に保存され、選定した記事は `data/history/post-history.json`(記事URL・タイトル・スコア・選定日時に加え、Sprint 7以降は投稿枠(slot)・投稿完了日時(postedAt)・ツイートID(tweetIds)・状態(status)も記録。既出判定・冪等性判定に使う実行時の状態ファイルのためgit管理対象外)に追記される。有効な候補が1件もない場合は投稿せず、理由付きで `[WARN]` ログに残す(Xへの投稿はSprint 6以降で実装)。

### F9: 投稿状態・履歴管理と冪等性(不発リカバリ)

`src/postHistory.ts` が投稿履歴(`data/history/post-history.json`)の読み書きに加え、以下を提供する。

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

## 環境変数

`.env.example` をコピーして `.env` を作成し、値を設定する(`.env` はgit管理対象外)。

| 変数名 | 必須 | 用途 |
|---|---|---|
| `ANTHROPIC_API_KEY` | F3(投稿文面生成)を使う場合は必須 | Anthropic API(Claude)の認証キー。[console.anthropic.com](https://console.anthropic.com/)で発行(従量課金)。未設定時は文面生成がエラーとして安全に終了する。 |
| `ANTHROPIC_MODEL` | 任意 | 使用するClaudeモデルID。未設定時はコード側のデフォルト(`claude-3-5-haiku-20241022`)を使う。 |
| `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_SECRET` | F6(`npm run post`、実際にXへ投稿)を使う場合は必須 | X API v2の認証情報。[developer.x.com](https://developer.x.com/)でアプリを作成し発行する。Access Tokenには「Read and Write」権限が必要。いずれか未設定の場合、投稿処理はAPIを呼び出さず安全にエラーとして終了する(`npm run dryrun`には影響しない)。 |
| `POST_RECOVERY_WINDOW_HOURS` | 任意 | F9: 不発リカバリの許容範囲(時間)。`--slot`と`--scheduled-at`を指定した実行で使われる。未設定/不正値時は既定値(3時間)を使う。 |

`npm run collect` / `npm run select` 単体では外部認証情報は不要(情報源はすべて無認証の無料公開API/RSS)。
