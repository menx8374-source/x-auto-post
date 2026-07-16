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

# テスト実行
npm test

# 型チェック
npm run typecheck
```

`npm run collect` を実行すると、Hacker News / Reddit(r/artificial, r/MachineLearning, r/OpenAI) / RSS(TechCrunch AI, VentureBeat AI, The Verge AI, Google News AI検索)から候補を収集し、急上昇スコア降順のテーブルをコンソールに出力し、構造化データを `data/output/latest-candidates.json` に保存する。一部の情報源への通信が失敗しても処理全体は継続し、失敗はログ(`[WARN]`)に残る。

`npm run select` を実行すると、候補リストから「過去に投稿(選定)済みのURL・実質同一記事・スコアしきい値未満」を除外した上で最高スコアの1件を選定し、タイトル・URL・スコア・選定理由をログに出力する。選定結果は `data/output/latest-selection.json` に保存され、選定した記事は `data/history/post-history.json`(記事URL・タイトル・スコア・選定日時を記録。既出判定に使う実行時の状態ファイルのためgit管理対象外)に追記される。有効な候補が1件もない場合は投稿せず、理由付きで `[WARN]` ログに残す(Xへの投稿はSprint 6以降で実装)。

`npm run generate` を実行すると、`data/output/latest-selection.json` の選定記事をもとに、Claude(Anthropic API)で日本語の投稿文面を1つ生成し、コンソールに表示した上で `data/output/latest-post.json` に保存する(`{ success: true, text, candidate }` または失敗時 `{ success: false, error, candidate }`)。`ANTHROPIC_API_KEY` が未設定、またはAPI呼び出しが失敗した場合や生成結果がタイトルの丸写しに近い/空/長すぎる等の検証に通らない場合は、投稿処理には進まず `success: false` としてエラーを記録し、プロセスは終了コード1で終わる(壊れた/空の投稿をしない)。

## 環境変数

`.env.example` をコピーして `.env` を作成し、値を設定する(`.env` はgit管理対象外)。

| 変数名 | 必須 | 用途 |
|---|---|---|
| `ANTHROPIC_API_KEY` | F3(投稿文面生成)を使う場合は必須 | Anthropic API(Claude)の認証キー。[console.anthropic.com](https://console.anthropic.com/)で発行(従量課金)。未設定時は文面生成がエラーとして安全に終了する。 |
| `ANTHROPIC_MODEL` | 任意 | 使用するClaudeモデルID。未設定時はコード側のデフォルト(`claude-3-5-haiku-20241022`)を使う。 |

`npm run collect` / `npm run select` 単体では外部認証情報は不要(情報源はすべて無認証の無料公開API/RSS)。
