---
tags: [sprint-selfeval]
sprint: 6
---

# Sprint 6 自己評価レポート

## 実装した内容
- `src/xPublish.ts`: F6本体。X API v2(`twitter-api-v2`)を使い、`pipeline.ts`の`PublishFn`と同じシグネチャで差し替え可能な`xApiPublish`(既定エクスポート)と、クライアント/リトライ方針/sleep関数を注入できる`createXApiPublish(client?, retryPolicy?, sleep?)`を実装。
  - `createXClient()`: `X_API_KEY`/`X_API_SECRET`/`X_ACCESS_TOKEN`/`X_ACCESS_SECRET`(すべて`.env`経由)からクライアントを構築。いずれか未設定なら`null`を返す。
  - スレッド2件目以降は直前のツイートID(`in_reply_to_tweet_id`)への返信として投稿(スレッド連結)。
  - 途中失敗時は、そこまでの`tweetIds`・`failedAtIndex`・`error`を`PublishResult`に記録し、以降のツイートは送信しない。
  - レート制限(HTTP 429、`ApiResponseError`)検知時は既定で最大2回・待機上限60秒の範囲でのみリトライ(`X-Rate-Limit-Reset`ベースの待機時間を計算、取得できない場合は指数バックオフ)。上限を超える場合は諦めて理由を記録(無制限リトライ・連投回避策はしない)。
  - 全件成功時は`tweetIds`(投稿順)と`postedAt`(ISO8601)を記録。
  - `XPostClient`最小インターフェース経由でクライアントを注入可能にし、テストは実SDK/実APIを一切使わない。
- `src/pipeline.ts`: `PublishResult`型に`tweetIds`/`postedAt`/`failedAtIndex`/`error`を追加(既存の`dryRunPublish`とは後方互換、フィールドはすべてoptional)。
- `src/publish.ts`: 本番投稿用CLIエントリポイント(`npm run post`)。`runPostingPipeline`に`xApiPublish`を渡して実行し、結果を`data/output/latest-publish.json`に保存。
- `.env.example`にX API認証情報4変数のキー名のみ追記。実値はコミットしていない。
- `package.json`に`"post": "tsx src/publish.ts"`スクリプトを追加。依存関係に`twitter-api-v2`(^1.29.0)を追加。
- `README.md`に起動コマンド(`npm run post`)と環境変数表(X API 4変数)を追記。
- `docs/spec/x-ai-news-autopost-architecture.md`に「F6: X API v2投稿クライアント」の技術選定を追記。

## 技術選定
- **X API v2クライアント**: `twitter-api-v2`(npm, MIT, 実績あり)を選定。OAuth1.0a署名・v2エンドポイント・レート制限情報(`rateLimit.reset`)の抽出を自前実装せず既存の保守ライブラリに委ねた。純npmで管理者権限不要にインストール可能(Windows/GitHub Actions双方で追加ツールチェーン不要)。詳細は`docs/spec/x-ai-news-autopost-architecture.md`参照。

## 受け入れ基準チェック(自己申告)
- [x] 正しい認証情報下で単一ツイート/スレッド投稿ができる: **モック検証で確認**。`test/xPublish.test.ts`で単一ツイート・3件スレッド投稿の呼び出し順序・戻り値を検証。実X APIとの疎通は認証情報未設定のため未検証(下記懸念点参照)。
- [x] スレッド2件目以降が直前ツイートへの返信として連結される呼び出しになっている: `test/xPublish.test.ts`の「スレッド投稿」テストで、2件目の`replyTo`が1件目のID、3件目の`replyTo`が2件目のIDであることを確認。
- [x] 途中失敗時にどこまで投稿されたかが記録される: 「途中失敗」テストで、2件目失敗時に1件目のIDのみ`tweetIds`に残り、`failedAtIndex:2`が記録され、3件目は送信されないことを確認。
- [x] レート制限/上限エラー検知時に、規約範囲のリトライに留め、超過時は諦めて記録する: 3種のテスト(reset時刻内でリトライ成功/リトライ回数上限で諦め/待機上限超過で即座に諦め)で確認。無制限リトライは行わない設計(`RateLimitRetryPolicy.maxRetries`・`maxWaitMs`で上限を規定)。
- [x] 投稿成功時にツイートID群と時刻が記録される: 全件成功テストで`tweetIds`配列と`postedAt`(ISO8601)が返ることを確認。

## アプリの起動方法
```bash
npm install
npm test          # 全テスト実行(70件、xPublish関連7件含む)
npm run typecheck # 型チェック
npm run dryrun     # ドライラン(Xへ投稿しない、既存Sprint5機能)
npm run post       # 本番投稿。.envにX_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_SECRET(+ANTHROPIC_API_KEY)が必要
npm run post -- --inject-decoy  # 検証用ダミー候補を混ぜて実行
```
起動に使うサーバー・ポートはなし(画面を持たないCLIバックエンド)。

## 既知の問題・懸念点
- **実X API疎通は未検証**: `.env`にX API認証情報が用意されていない検証環境のため、`xApiPublish`から実際にX(x.com)へネットワーク接続してツイートを投稿する検証は行っていない。事前確認の結果(ブリーフ記載)通り、モック/スタブでの検証(`test/xPublish.test.ts`、実SDK/実APIを一切使わないユニットテスト)で「投稿順序・返信連結・途中失敗記録・レート制限時の限定リトライ」を確認済み。実認証情報が用意された時点で、単一ツイート投稿→スレッド投稿の順に少数回だけ実投稿で確認することを推奨(無闇な連投検証はしない、とブリーフの評価基準にも明記あり)。
- **認証情報未設定時の安全終了パスは実行確認済み**: `.env`未作成・環境変数未設定の状態で、(1)`xApiPublish`を直接呼び出す一時検証スクリプト(検証後削除)、(2)`npm run post`のCLI実行、の両方で、APIを一切呼び出さず`posted:false`と理由を返す/ログに出すことを実際に確認した(実行ログは本レポート作成時に確認済みでコード内に不要な副作用は残していない)。ただし`npm run post`の実行では`ANTHROPIC_API_KEY`も未設定のため、パイプラインは`generate`段階で停止し、`publish`段階(X API呼び出し)には到達しなかった。X API呼び出し自体の安全終了は上記(1)の直接呼び出しで確認済み。
- レート制限の待機見積もり(`estimateWaitMs`)は`ApiResponseError.rateLimit.reset`(UNIX秒)を優先し、取得できない場合のみ指数バックオフにフォールバックする設計。実際のX API側のレスポンスヘッダー形式は未検証(twitter-api-v2の型定義に基づく実装)。

## 追加したテスト
- `test/xPublish.test.ts`(新規、7件): 認証情報未設定時の安全終了/単一ツイート投稿/スレッド返信連結/途中失敗時の記録/レート制限リトライ成功/リトライ上限超過/待機上限超過の即時諦め。すべてモッククライアント・no-op sleepを使い、実ネットワーク・実待機なしで実行(`npm test`で70件中これら7件を含め全件パス)。

## 関連ドキュメント
- [[sprint-6-brief]]
- [[x-ai-news-autopost-spec]]
