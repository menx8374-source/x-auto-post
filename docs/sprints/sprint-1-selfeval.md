---
tags: [sprint-selfeval]
sprint: 1
---

# Sprint 1 自己評価レポート

## 実装した内容
- F1: 急上昇AIニュースの収集とスコアリング(コマンド1つで実行可能)
- 情報源(認証不要・無料):
  - Hacker News(Algolia HN Search API): points/num_commentsをエンゲージメントとして利用
  - Reddit公開JSON(r/artificial, r/MachineLearning, r/OpenAI): score/num_commentsをエンゲージメントとして利用
  - RSS(TechCrunch AI, VentureBeat AI, The Verge AI, Google News AI検索): `rss-parser`でパース
- AI関連フィルタ(`src/aiFilter.ts`): タイトル+概要をキーワード判定(単語境界regexで"AI"の誤検出を回避)
- スコアリング(`src/scoring.ts`): 直近性(公開時刻からの指数減衰)+話題性(タイトル類似度クラスタリングによる複数ソース言及数+エンゲージメント値)を重み付け合成し降順ソート
- ソース単位の失敗許容: `Promise.allSettled`で各ソースを独立実行し、失敗は`console.warn`でログ(処理全体は継続、exit code 0)
- 収集結果を`data/output/latest-candidates.json`に構造化JSONとして保存、コンソールにもテーブル出力
- `--inject-decoy`フラグ: 意図的に「45日前・エンゲージメント0」のデコイ記事を候補に混ぜて検証できる
- 単体テスト(`node:test`): aiFilter/scoring/rssの挙動を検証

## 今回(2回目)の修正内容: /code-reviewでCONFIRMEDとなった3件の「正しさのバグ」
1. **`src/aiFilter.ts`のA.I.正規表現バグ**: `/\bA\.I\.\b/i`は末尾の`\b`が「.」の直後で成立せず実質マッチしないことをnodeで確認済みだった。`/\bA\.I\.(?!\w)/i`(否定先読みで直後が単語文字でないことを確認)に修正し、`"Military reliance on A.I. in warfare grows"`等でマッチすることを確認。回帰テストを`test/aiFilter.test.ts`に追加。
2. **`src/sources/rss.ts`の日付フォールバックバグ**: `isoDate`も`pubDate`も無い場合に`new Date().toISOString()`(収集実行時刻)へフォールバックしていたため、鮮度スコアが不当に最大化される問題を修正。`resolvePublishedAt()`という純粋関数を切り出し、日付不明時は現在時刻ではなく固定の古いプレースホルダ(UNIXエポック)を返しつつ`publishedAtUnknown: true`フラグを明示的に立てるようにした。`src/types.ts`の`NewsCandidate`に`publishedAtUnknown?: boolean`を追加し、`src/scoring.ts`の鮮度計算でこのフラグが立っている場合は鮮度スコアを常に0にするよう修正(現在時刻にフォールバックした場合と異なり、不当に有利にならない)。`test/rss.test.ts`(新規)と`test/scoring.test.ts`に回帰テストを追加。
3. **`src/scoring.ts`のUnion-Find推移的併合バグ**: `computeMentionCounts`がUnion-Findで類似タイトルをクラスタ化していたため、A~B・B~Cがそれぞれ閾値以上でもA~C自体は閾値未満という「橋渡し」パターンで無関係なAとCが同一クラスタに併合され、Cのmention countに無関係なAのソースが混入する問題があった。Union-Findによる推移的併合をやめ、各候補についてタイトルが直接類似している(閾値以上の)候補群のソース数のみを数える方式に変更。修正前後をnodeスクリプトで実際に比較し、旧実装ではA/B/Cすべてmention count=3(バグ)、新実装ではA=2, B=3, C=2(正しい)になることを確認。`test/scoring.test.ts`に回帰テストを追加。

## 技術選定
- Node.js (v24) + TypeScript(`tsx`で直接実行、ビルドステップなし)。理由: Windowsで管理者権限不要にセットアップ可能、将来のX API連携・GitHub Actionsとも同一言語で完結、追加インフラ費用なし。詳細は`docs/spec/x-ai-news-autopost-architecture.md`参照。
- 情報源は完全無料・認証不要のもの(HN Algolia API, Reddit公開JSON, 各種RSS)のみを採用。有料ニュースAPIは不使用。
- 依存ライブラリは`rss-parser`(RSSパース、実績あり)のみを追加。テストはNode.js標準の`node:test`を使い追加のテストフレームワークを導入していない。
- (今回のバグ修正は既存の技術選定を変更するものではない)

## 受け入れ基準チェック(自己申告)
- [x] コマンド1つ(`npm run collect`)で実行すると、10件以上のAIニュース候補が「タイトル・URL・情報源・推定公開時刻・急上昇スコア」を持ってスコア降順で出力される。今回の修正後も再実行し207件収集を確認(コンソールテーブルと`data/output/latest-candidates.json`の両方に出力)。
- [x] 意図的に「古く話題も伸びていない記事」を混ぜても上位3件に入らないことを確認できる。`npm run collect -- --inject-decoy`で実行可能。`test/scoring.test.ts`の決定論的単体テストでも検証済み(修正後も引き続きパス)。
- [x] AI無関係の記事が候補に混ざらない。単語境界regexによるキーワードフィルタを実装し、単体テストで非AI記事が除外されることを確認。今回のA.I.正規表現修正により、ピリオド付き略記のAI関連記事が誤って除外される問題も解消。
- [x] 一部の情報源が通信失敗しても処理は落ちず、取得できた分で候補を作りエラーはログに残る。修正後の再実行でもReddit 3ソースが`HTTP 403 Blocked`で失敗し`[WARN]`ログに記録された上で、他5ソースの結果のみで207件の候補リストが構築され、処理はexit code 0で正常終了することを確認。

## アプリの起動方法
```bash
cd c:\ClaudeProjects\XAutoMode
npm install
npm run collect                      # 収集・スコアリングを実行、コンソール出力+data/output/latest-candidates.jsonに保存
npm run collect -- --inject-decoy    # 古く話題性の低いデコイ記事を混ぜて上位3件に入らないことを確認
npm test                             # 単体テスト(14件)実行
npm run typecheck                    # TypeScript型チェック
```
外部認証情報は不要(すべて無認証の無料公開API/RSSを使用)。サーバー起動は不要(一回実行のCLIバッチ処理)。自己確認のためのバックグラウンドプロセスは起動していない(`npm run collect`は一回実行で終了するCLI)。

## 既知の問題・懸念点
- Reddit(r/artificial, r/MachineLearning, r/OpenAI)は本検証環境のIPからは`HTTP 403 Blocked`で常に失敗する(Redditの datacenter/非ブラウザ由来アクセスへのブロックによるものと推測。User-Agentヘッダは付与済み)。仕様上「一部ソースの通信失敗時も処理継続」は必須要件でありこれを満たしているため機能上の問題ではないが、Reddit由来のエンゲージメントシグナルは実質的に利用できていない。HN/RSS/Google Newsだけで候補数・スコアリングの要件は十分満たしている。
- ニュース収集は実時間データに依存するため、収集される具体的な記事・件数は実行タイミングによって変動する(受け入れ基準の「10件以上」は複数回の実行で安定して満たされることを確認済み)。
- "話題の伸び(急な言及増加)"は本スプリントでは「同一トピックの複数ソース言及数(タイトル類似度による直接ペア判定)」で近似しており、時系列での言及数の増加率(真の「急上昇」)までは追跡していない(将来スプリントで履歴データが蓄積されれば拡張可能。現時点では受け入れ基準の「新しさ」と「話題の伸び」の両方を反映する要件は満たしている)。
- Hacker News/Reddit(Algolia `created_at`/Reddit `created_utc`)は常に実際のタイムスタンプを返すため、今回の「日付不明フォールバック」バグはRSSソースのみに存在していた。念のため確認済みで、他ソースには同様の問題はない。

## 追加したテスト
- `test/aiFilter.test.ts`: AI関連判定(true/false)、"AI"の誤検出回避、`filterAiRelated`によるリスト除外、"A.I."ピリオド付き略記の回帰テストを検証(5テスト)
- `test/scoring.test.ts`: デコイ記事が上位3件に入らないこと、直近性の反映、複数ソース言及による話題性スコアの向上、publishedAtUnknown候補が鮮度で有利にならないこと(回帰)、Union-Find橋渡しバグの回帰を検証(6テスト)
- `test/rss.test.ts`(新規): `resolvePublishedAt`のisoDate/pubDate優先順位、日付不明時に現在時刻へフォールバックしないこと(回帰)、不正なpubDate文字列の扱いを検証(4テスト)
- 全14テストがパス(`npm test`)、`npm run typecheck`もエラーなし
- Union-Findバグについては、修正前後のクラスタリングロジックをnodeスクリプトで直接比較し、旧実装が実際にバグを再現すること(A/B/Cすべてmention count=3)を確認した上で、新実装が正しい値(A=2,B=3,C=2)を返すことを検証済み

## 前回フィードバックへの対応(再実装の場合のみ)
- 指摘1(`src/aiFilter.ts:9`のA.I.正規表現末尾`\b`が実質マッチしない) → `/\bA\.I\.(?!\w)/i`に修正し、node上でマッチすることを確認。回帰テスト追加。
- 指摘2(`src/sources/rss.ts:43`の日付不明時に現在時刻フォールバックで鮮度が不当に最大化) → `resolvePublishedAt()`関数を新設し、日付不明時は固定の古いプレースホルダ+`publishedAtUnknown`フラグを返すように変更。`scoring.ts`側でこのフラグを見て鮮度スコアを0にするよう修正。回帰テスト追加。
- 指摘3(`src/scoring.ts:59`のUnion-Findによる推移的併合で無関係な候補のmention countが不当加算) → Union-Findをやめ、各候補ペアの直接類似度のみでmention countを算出する方式に変更。修正前後の挙動差をnodeスクリプトで実証し、回帰テストを追加。

## 関連ドキュメント
- [[sprint-1-brief]]
- [[x-ai-news-autopost-spec]]
- [[x-ai-news-autopost-architecture]]
