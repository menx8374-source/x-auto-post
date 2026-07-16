---
tags: [sprint-selfeval]
sprint: 10
---

# Sprint 10 自己評価レポート

## 実装した内容

### F10: 実行ログとエラー通知
- `src/pipeline.ts`(`runPostingPipeline`)に以下のログを追加:
  - 実行開始(slot/scheduledAt/writeHistory/injectDecoy)
  - 候補件数(`candidates collected for this run`)
  - 選定記事(title/url/score/reason/consideredCount)
  - 投稿結果(成功/失敗/未送信を1行で判別できる集約ログ)
- `src/generatePost.ts`のログに生成本文そのもの(`text`)を追加(監査用)。
- `src/logger.ts`: 既知の認証情報系環境変数(`ANTHROPIC_API_KEY`/`X_API_KEY`/`X_API_SECRET`/`X_ACCESS_TOKEN`/`X_ACCESS_SECRET`)の実値がメッセージ・meta(ネスト・配列含む)に含まれていた場合、`***MASKED***`に置換する多層防御を追加。
- `src/notify.ts`(新規): 投稿失敗・候補なし・不発リカバリ超過を通知する関数。ログには必ず残し、`NOTIFY_WEBHOOK_URL`設定時はそこにもJSON POSTする(ベストエフォート、失敗してもパイプラインを止めない)。`src/publish.ts`から呼び出し。
- `.github/workflows/post.yml`に`Write job summary`ステップを追加。実行結果を`$GITHUB_STEP_SUMMARY`に書き出す(成功/停止段階/スキップ理由/選定記事/投稿結果)。投稿処理が失敗しても`!cancelled()`で必ず実行。

### F12: 設定管理
- `src/config.ts`(新規、認証情報とは別モジュール): 投稿枠時刻(`POST_SLOT_*_TIME`)・言語/トーン(`POST_LANGUAGE`/`POST_TONE`)・最大ツイート本数(`POST_MAX_BODY_TWEETS`)・リンクツイート有無/位置(`POST_LINK_TWEET_ENABLED`/`POST_LINK_TWEET_POSITION`)・許容遅延(`POST_RECOVERY_WINDOW_HOURS`)を一元管理。
  - 個別のgetter関数(`getPostSlots`等)は呼び出しのたびに`process.env`を読み直す(既存の`getConfiguredRecoveryWindowHours`と同じ方式)ため、`.env`の変更が実行のたびに反映される。不正値があれば警告ログ+既定値へフォールバック(cronの継続運用を優先)。
  - `assertValidConfig()`は全項目を厳格に検証し、不正値があれば全てをまとめた`ConfigError`を投げる。`runPostingPipeline()`の最初で呼び出し、壊れた設定のまま収集・生成・投稿へ進まない。
  - `getCredentialsStatus()`は認証情報の実値を一切返さず、設定済みかどうかの真偽値のみを返す(認証情報系設定との分離)。X API認証情報が1〜3個だけ設定されている場合を設定ミスとして検知する。
- `src/postHistory.ts`/`src/postSchedule.ts`/`src/generatePost.ts`: 既存の定数(`DEFAULT_RECOVERY_WINDOW_HOURS`/`POST_SLOTS`/`GENERATION_STYLE`)は後方互換のため残しつつ、実際の判定ロジック(`resolveCurrentSlot`/`buildGenerationPrompt`)は呼び出しのたびに`config.ts`のgetterを読み直すよう変更。
- `src/threadSplit.ts`: `composeThread`に`includeLinkTweet`/`linkPosition`オプションを追加。
- `src/pipeline.ts`: `buildThreadWithConfig`(export)が`getMaxBodyTweets`/`getLinkTweetConfig`を読み込んで`composeThread`へ渡す。`defaultDeps.buildThread`として使用。
- `src/buildThread.ts`(`npm run thread`)にも同じ設定を配線。

### 追加修正: F9回帰テストのflaky修正
- `test/pipeline.test.ts`の「F9回帰: 深夜跨ぎのルックバック...」テストが`Date.now()`相対計算に依存していた原因は、`pipeline.ts`内の不発リカバリ判定(`isWithinRecoveryWindow`)が常に実際の壁時計(`new Date()`)を使っていたこと。
- `src/pipeline.ts`の`RunPipelineOptions`に`now?: Date`(テスト用の現在時刻注入口)を追加し、`options.now ?? new Date()`で使用。
- テストを全面的に絶対固定日時ベースに書き換え、`Date.now()`を一切使わない決定論的なテストにした。5回連続実行で安定を確認済み。

### 今回の修正: `/code-review`指摘(2件、CONFIRMED)への対応
前回evaluator PASS後の`/code-review`で`src/logger.ts`の`maskValue`に以下2件の正しさのバグが見つかったため修正した。

1. **配列の循環参照でスタックオーバーフロー**: 旧実装は配列分岐で`seen`WeakSetへの登録を行っておらず、`value.map((v) => maskValue(v, seen))`するだけだった。自己参照する配列(`const arr=[]; arr.push(arr)`)を渡すと無限再帰し`RangeError: Maximum call stack size exceeded`でクラッシュしていた。
2. **`seen`が「一度でも訪問した全ノード」を記録しており、循環でない単なる重複参照まで`"[circular]"`に置き換えていた**: 旧実装は`seen.add(value)`した後に一切`delete`しないため、探索パスを抜けても登録が残り続け、同じオブジェクトを2つの異なるキーで参照しているだけの非循環ケースでも2回目の参照が誤って欠落していた。

**修正内容**(`src/logger.ts`の`maskValue`):
- 配列分岐でもオブジェクト分岐と同様に、処理開始時に`seen.add(value)`、そのノードの子要素すべてを処理し終えて再帰から戻る直前に`seen.delete(value)`する(パス離脱時のクリーンアップ)ようにした。
- これにより`seen`は「一度でも訪問した全ノード」ではなく「現在の深さ優先探索パス上にある祖先ノード」だけを表すようになり、真の循環参照(自分自身を祖先に持つ)のみを`"[circular]"`として検出し、単なる重複参照(兄弟・別枝からの参照)は両方とも通常通り実際の値としてマスク処理される。

## 技術選定
- 新規npm依存は追加していない(`fetch`はNode.js標準)。既存アーキテクチャ(`docs/spec/x-ai-news-autopost-architecture.md`)の技術選定を踏襲。
- 通知手段: GitHub Actionsジョブサマリー(既定、追加コストなし)+ 任意のWebhook(`NOTIFY_WEBHOOK_URL`、未設定なら何もしない)。「連続スキップ」の厳密なカウンタ管理までは実装せず、投稿失敗・候補なし・不発リカバリ超過という個別の「利用者対応が必要な事象」が発生するたびに通知する設計とした(連続発生時も含めて毎回気づけるため、要件を満たすと判断)。

## 受け入れ基準チェック(自己申告)
- [x] 各実行で開始・候補件数・選定記事・生成本文・投稿結果(成功/失敗/スキップ)・エラー内容がログに残り、認証情報の実値は出力されない(マスク済み)。`src/pipeline.ts`のログ追加箇所・`src/logger.ts`のマスク処理・`test/logger.test.ts`(7件、循環参照/重複参照の回帰含む)で確認。
- [x] 投稿失敗/連続スキップ時に利用者が気づける通知手段が用意され、ドキュメントで案内される。GitHub Actionsジョブサマリー(既定)+任意Webhook。README.md「F10」節に記載。
- [x] 投稿時刻・言語/トーン・最大ツイート本数・リンクツイート有無/位置・許容遅延が1箇所の設定で変更でき反映される。認証情報系と挙動系が分離される。`src/config.ts`に一元化、CLI実行(`npm run thread`)で`POST_LINK_TWEET_POSITION=start`/`POST_LINK_TWEET_ENABLED=false`が反映されることを実機確認済み(下記「アプリの起動方法」参照)。
- [x] 設定の必須項目未設定・不正な時刻等を起動時に検知して分かるエラーを出す。`assertValidConfig()`+`test/config.test.ts`(16件)で確認。CLI実機でも`POST_MAX_BODY_TWEETS=abc npm run dryrun`が起動直後にエラー終了(exitCode 1)することを確認済み。
- [ ] ドライランで収集→選定→生成→分割→リンク→(投稿はモック)まで一気通貫で成功することを確認する。**部分的に確認**(前回から変更なし)。`npm run dryrun`実機実行で収集(実ネットワーク)→選定(実ロジック)までは成功を確認したが、`ANTHROPIC_API_KEY`が本環境の`.env`に未設定(Sprint 3時点からの既知の制約、利用者がまだ用意していない)のため、生成(F3)段階でCLI実機からは「投稿しない安全側の停止」となり、そこから先(分割・リンク)へは実機E2Eで進めなかった。ただし: (a) `test/pipeline.test.ts`の全テスト(モックした`generate`を含む、実運用と同一コードパス`runPostingPipeline`)で収集→選定→生成→分割→リンク→publishの一気通貫成功を検証済み、(b) `npm run thread`単体では実際に分割・リンク付与・設定反映(位置/有無)が正しく動くことを実機確認済み。キー設定後に利用者が`npm run dryrun`を実行すれば完全なE2E成功を確認できる状態。

## アプリの起動方法
```bash
npm install
npm run dryrun          # ドライラン(ANTHROPIC_API_KEY未設定の場合、生成段階で安全に停止する)
npm run post             # 本番投稿(認証情報が必要)
npm test                 # テスト実行(119件、全て通過)
npm run typecheck        # 型チェック
```
設定不正値の確認例: `POST_MAX_BODY_TWEETS=abc npm run dryrun`(即座にConfigErrorでexitCode 1)。
リンクツイート設定の確認例: `POST_LINK_TWEET_POSITION=start npm run thread`(直近の`npm run generate`結果が必要)。

サーバー常駐プロセスは無し(すべて一回実行のCLIコマンド)。自己確認のためにバックグラウンド起動したプロセスはない。

## 既知の問題・懸念点
- **Sprint 3から継続**: `.env`に`ANTHROPIC_API_KEY`が未設定のため、`npm run dryrun`のCLI実機E2Eは生成(F3)段階で停止する(想定通りの安全側動作。バグではない)。パイプラインロジック自体は`test/pipeline.test.ts`のモックテストで一気通貫成功を検証済み。
- 「連続スキップ」の厳密なカウンタ(N回連続でのみ通知等)は実装しておらず、個別の失敗/スキップ事象ごとに通知する設計。ブリーフの「投稿失敗や連続スキップなど」という例示は満たすと判断したが、より厳密な連続回数トラッキングが必要であれば追加実装の余地あり。
- `.github/workflows/post.yml`の`Write job summary`ステップは実際のGitHub Actions実行環境でのみ動作確認可能($GITHUB_STEP_SUMMARY環境変数がローカルには無いため)。YAML構文は`js-yaml`でパース検証済み、シェル内のnode -eスクリプトはロジックレビュー済みだが実機未検証。
- X API/Anthropic APIの実疎通は引き続き未検証(Sprint 3・6から継続の既知の制約)。

## 追加したテスト
- `test/config.test.ts`(16件): 既定値・環境変数上書き・`assertValidConfig`の各種不正値検知(時刻形式・本数・enabled/position・recovery hours・言語/トーン空文字・X認証情報一部欠落・複数エラー同時検知)・`getCredentialsStatus`が実値を返さないこと。
- `test/logger.test.ts`(7件、内3件が今回追加の回帰テスト): メッセージ/meta(ネスト・配列含む)中の認証情報実値のマスク、無関係な値は消えないこと、環境変数未設定時は素通しされること、に加えて今回:
  - 自己参照する配列を含むmetaでログ出力してもクラッシュしないこと(`RangeError`が発生しないこと)。
  - 自己参照するオブジェクトを含むmetaでログ出力してもクラッシュせず、循環部分が`"[circular]"`で打ち切られること。
  - 循環していない単純な重複参照(同じオブジェクトを`first`/`second`の2キーで参照)は、両方とも実際の値(マスキング適用済み)としてログに出力され、`"[circular]"`にはならないこと。
- `test/threadSplit.test.ts`に3件追加: `includeLinkTweet:false`、`linkPosition:'start'`、`maxBodyTweets`オプション。
- `test/pipeline.test.ts`に2件追加: `buildThreadWithConfig`の環境変数反映、`runPostingPipeline`が不正設定でConfigErrorを投げ収集へ進まないこと。
- `test/pipeline.test.ts`のF9回帰テストを決定論的に修正(既存1件の書き換え、新規追加ではない)。
- `npm test`で119件すべて実行しパス、`npm run typecheck`もエラーなしを確認済み。

## 前回フィードバックへの対応(今回の修正)
- 指摘: `/code-review`で`maskValue`の配列分岐が循環参照検出用`seen`に自身を登録しておらず、自己参照する配列でスタックオーバーフローする(CONFIRMED)。 → 対応: `src/logger.ts`の配列分岐でもオブジェクト分岐と同様に`seen.add`/`seen.delete`を行うよう修正。回帰テスト追加済み。
- 指摘: `seen`が「一度でも訪問した全ノード」として扱われ、循環でない単なる重複参照まで`"[circular]"`に誤置換される(CONFIRMED)。 → 対応: 各ノードの子要素処理を終えて再帰から戻る際に`seen.delete(value)`する方式に変更し、`seen`が「現在の探索パス上の祖先」のみを表すようにした。真の循環参照は`"[circular]"`、単なる重複参照は両方とも実値としてマスク処理されることを回帰テストで確認済み。

## 関連ドキュメント
- [[sprint-10-brief]]
- [[x-ai-news-autopost-spec]]
