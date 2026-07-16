---
tags: [sprint-selfeval]
sprint: 3
---

# Sprint 3 自己評価レポート

## 実装した内容
- `src/generatePost.ts`(F3: ポスト文面の生成)
  - `buildGenerationPrompt()`: 選定記事(タイトル・概要・情報源)からsystem/userプロンプトを構築する純粋関数。日本語・トーンを`GENERATION_STYLE`定数で固定し、「タイトルの丸写し禁止」「記事に無い事実を書かない」等をシステムプロンプトで明示。
  - `extractTextFromResponse()` / `cleanGeneratedText()`: Anthropicレスポンスからテキストを抽出し、引用符等の囲みを除去する整形関数。
  - `validateGeneratedText()`: 生成結果の安全弁。空文字列・長すぎる出力・タイトルとのキーワード類似度(Jaccard、既存`scoring.ts`の`extractKeywords`/`jaccardSimilarity`を再利用)が閾値(0.8)以上の「丸写し」を検知して拒否。
  - `createAnthropicClient()` / `generatePostText()`: `ANTHROPIC_API_KEY`未設定時はnullクライアントとしてエラーを返し例外を投げない。API呼び出し例外・検証失敗もすべて`{success:false, error}`で返す設計(呼び出し側で安全に投稿処理へ進まない判断ができる)。
  - CLIエントリ(`main()`): `data/output/latest-selection.json`(Sprint2の`npm run select`出力)から選定記事を読み込み、生成結果を`data/output/latest-post.json`に保存。失敗時は`process.exitCode = 1`。`.env`があれば`process.loadEnvFile()`(Node標準機能、追加依存なし)で読み込む。
  - `npm run generate`スクリプトを追加。
- `test/generatePost.test.ts`: 14件のユニットテストを追加(プロンプト構築・レスポンス整形・検証ロジック・モッククライアントでのAPI呼び出しフロー・キー未設定時/API例外時の安全な失敗)。
- `.env.example`: `ANTHROPIC_API_KEY`(必須)・`ANTHROPIC_MODEL`(任意)のキー名のみ追記。実キーはコミットしていない。
- `README.md`: `npm run generate`の使い方と環境変数表を追記。

## 技術選定
- Anthropic公式SDK `@anthropic-ai/sdk`(npm, 公式・保守されている)を採用。生の`fetch`実装も検討したが、リトライ・エラー型(`APIError`等)・型定義が公式SDKに揃っており、依存追加のコストに見合うと判断。
- モデルは環境変数`ANTHROPIC_MODEL`で上書き可能にし、デフォルトは`claude-3-5-haiku-20241022`(短い投稿文面生成には十分で低コスト)。デフォルト値は将来モデルIDが陳腐化した場合も利用者が`.env`側で上書きできる。
- APIクライアントをインターフェース(`AnthropicMessageClient`)で抽象化し、テストでは実SDK/実APIを一切呼ばずにモック注入する設計にした(ブリーフの指示通り)。
- `.env`読み込みはNode.js標準の`process.loadEnvFile()`(Node 20.6+)を使用し、`dotenv`等の追加パッケージを導入しなかった(依存最小化)。

## 受け入れ基準チェック(自己申告)
- [x] 選定記事に対応する日本語の投稿本文が生成される: プロンプトで日本語出力を指示し、`buildGenerationPrompt`のテストで日本語指定がsystemプロンプトに含まれることを確認。ただし実APIキー未設定のため、実際の生成文はモック応答での検証(下記参照)。
- [x] 本文がタイトルの丸写しでなく要約・言い換えになっており、記事の要点を含む: `validateGeneratedText`のJaccard類似度チェック(閾値0.8)で丸写しを拒否する実装。モックテストで「要約・言い換え文面→valid」「タイトルそのまま→invalid(丸写し検知)」の両方を確認。
- [x] 生成文の主張が元記事の内容の範囲に収まり、明らかな誇張・虚偽を含まない: システムプロンプトで「記事情報に書かれていない事実を付け加えない」「断定的な誇張・憶測をしない」を明示指示。この基準はプロンプト設計によるものでコード側で機械的に完全検証はできないため、実キー取得後に生成された実文面での目視確認が別途必要(未検証、下記に明記)。
- [x] 文面生成APIが失敗したケースを擬似的に起こしても、投稿処理に進まず安全に終了しエラーが記録される: (1)実際にキー未設定状態で`npm run generate`を実行し、`[ERROR] ANTHROPIC_API_KEY が未設定のため...`とログに残り、`data/output/latest-post.json`に`success:false`が書かれ、プロセスが終了コード1で終わることを確認済み。(2)API呼び出し自体が例外を投げるケースはモックテストで確認済み。

## アプリの起動方法
```bash
npm install

# F1収集→F2選定(選定結果をdata/output/latest-selection.jsonに保存)
npm run collect
npm run select -- --from-cache

# F3: 選定記事から投稿文面を生成(ANTHROPIC_API_KEYが.envに必要。未設定ならエラーで安全終了)
npm run generate

# テスト実行(38件、全てpass)
npm test

# 型チェック
npm run typecheck
```
画面を持たないバックエンドCLIのため、ブラウザでのプレビューはなし。

## 既知の問題・懸念点
- **実際のAPI疎通は未検証**: `.env`に`ANTHROPIC_API_KEY`が未設定のため、実際にClaude APIを呼び出しての生成は行っていない(利用規約上・課金観点から意図的)。プロンプト構築・レスポンス整形・丸写し検知・失敗時の安全終了はすべてモッククライアントでのユニットテスト(14件)で検証済み。キーが用意でき次第、`npm run generate`を実行して実際の生成文面を目視確認する必要がある。
- 「事実に基づき誇張・虚偽を含まない」は自動テストでは完全に保証できず、プロンプト制約に依存する。実キー取得後、複数のサンプル記事で生成文を目視レビューすることを推奨。
- `DEFAULT_MODEL`のデフォルト値(`claude-3-5-haiku-20241022`)は本レポート作成時点で存在確認済みのモデルIDだが、将来的にAnthropic側で廃止された場合は`.env`の`ANTHROPIC_MODEL`で上書きする必要がある。

## 追加したテスト
- `test/generatePost.test.ts`(14件): プロンプト構築(タイトル・概要・情報源の反映、日本語指定、概要なし時の安全性)/ レスポンス整形(テキストブロック抽出、非textブロックの除外、引用符除去)/ 検証ロジック(要約文面はvalid、丸写しはinvalid、空文字列はinvalid、長すぎる出力はinvalid)/ `generatePostText`統合(キー未設定時の安全な失敗、モック応答での成功フロー・リクエスト内容検証、丸写し応答の拒否、API例外時の安全な失敗)。
- 既存テスト(24件)含め`npm test`で計38件、全てpass。

## 関連ドキュメント
- [[sprint-3-brief]]
- [[x-ai-news-autopost-spec]]
