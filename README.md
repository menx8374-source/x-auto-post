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

# テスト実行
npm test

# 型チェック
npm run typecheck
```

`npm run collect` を実行すると、Hacker News / Reddit(r/artificial, r/MachineLearning, r/OpenAI) / RSS(TechCrunch AI, VentureBeat AI, The Verge AI, Google News AI検索)から候補を収集し、急上昇スコア降順のテーブルをコンソールに出力し、構造化データを `data/output/latest-candidates.json` に保存する。一部の情報源への通信が失敗しても処理全体は継続し、失敗はログ(`[WARN]`)に残る。

## 環境変数

Sprint 1時点では外部認証情報は不要(情報源はすべて無認証の無料公開API/RSS)。今後のスプリント(X API・Anthropic API等)で追加され次第この節を更新する。
