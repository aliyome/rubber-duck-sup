# Vitest テスト計画

## 目的

- Cloudflare Workers 上で動作する Discord ボットの主要フローを自動テストで担保し、署名検証や AI 呼び出しを含む重要ロジックのリグレッションを防ぐ。
- Discord API・Workers AI・D1 など外部依存をモック化し、ローカルでも安定してテストを実行できる環境を構築する。

## 使用ツールとランタイム

- テストフレームワーク: Vitest
- 実行プール: `@cloudflare/vitest-pool-workers`
  - Cloudflare Workers ランタイムを模倣し、`fetch`、`scheduled()`、WebCrypto(Ed25519) などをそのまま利用可能にする。
- 型定義: `@cloudflare/workers-types`
- 代替案: Workers プールで不足がある場合は Miniflare を併用し、個別テストで `testEnvironment` を切り替える。

## 依存注入 (DI) 方針

- Discord REST 呼び出しと Cloudflare Workers AI 呼び出しを薄いアダプタへ分離し、呼び出し側はインターフェースに依存する。
  - 例: `createDiscordClient(fetchImpl)`、`createWorkersAiClient(aiBinding)` のようなファクトリを用意。
  - 本番コードは `env` から取得した `fetch` / `env.AI` を渡す。テストではモック実装を注入する。
- D1 へのアクセスもセッション化したクエリレイヤー (`createSessionRepository(db)`) に切り出し、テスト時にインメモリ実装やスタブを注入。
- DI によってテストが外部サービス状態に依存せず、モック差し替えでエッジケースを検証できるようにする。

## モック戦略

- **Discord API**
  - `vi.stubGlobal('fetch', ...)` で全体の HTTP 呼び出しを監視し、URL・HTTP メソッド・ペイロードをアサート。
  - 正常系 / 429 / 5xx / 署名不正などケース別のレスポンスを `test/fixtures/discord/*.json` に用意。
  - インタラクション Webhook の入力 (PING、slash コマンド、無効署名) も JSON で管理。
- **Cloudflare Workers AI**
  - `createMockAI()` を実装し、`run` を `vi.fn()` としてモデル ID ごとに戻り値を制御。
  - テキスト生成と要約で別フィクスチャを持たせ、エラー時は例外や `error` プロパティを返すケースを用意。
- **D1 / Sessions API**
  - 小規模ユニットテストでは SQL を実行しないレイヤーに限定し、リポジトリインターフェースをモック。
  - シナリオテストでは `better-sqlite3` などインメモリ SQLite を利用し、最低限のスキーマを作成してクエリ整合を検証。
- **日時処理**
  - Vitest の `vi.useFakeTimers()` / `vi.setSystemTime()` を使い、cron 判定や TTL ロジックのテストを安定化。

## テストカテゴリ

- **ユニットテスト**
  - Ed25519 署名検証: 正常 / 署名不一致 / タイムスタンプ欠落 / ヘッダ欠損。
  - Slash コマンドルータ: PING、`/start`、`/progress`、未知コマンド、検証失敗時の 401。
  - AI プロンプト整形・要約テキスト生成のフォーマット確認。
  - D1 クエリビルダ（セッション抽出、次回送信スケジュール再計算）。
- **統合に近いテスト**
  - Workers プールで `fetch('/interactions')` を実行し、レスポンス JSON・HTTP ステータス・追跡された Discord 送信を検証。
  - `scheduled()` ハンドラに対してダミーイベントを投入し、モック Discord クライアントが期待通り呼び出されたか確認。
- **回帰テストのためのケース**
  - シグネチャ検証で `NODE-ED25519` フォールバックが必要なケース。
  - Cron の多重実行時に同一セッションが二重送信されないこと。
  - Workers AI の異常応答（タイムアウト・API エラー）時のリトライ/フォールバック処理。

## 実装ステップ

1. `npm install -D vitest @cloudflare/vitest-pool-workers @cloudflare/workers-types` を実行。
2. `vitest.config.ts` を作成し、`test` セクションで Workers プールと TypeScript パス解決を設定。
3. Discord REST・Workers AI・D1 リポジトリのアダプタ層を導入し、依存注入できる形に整理。
4. `test/fixtures` ディレクトリを用意し、インタラクションリクエストやレスポンス例を整理。
5. 署名検証ユニットテストを追加し、Workers プール経由で WebCrypto が利用できることを確認。
6. `/interactions` ハンドラの統合テスト（PING → PONG、slash コマンドの同期応答）を実装。
7. Cron (`scheduled()`) のテストを追加し、擬似的な時間設定とモック Discord クライアントで動作を確認。
8. 継続的な回帰対策として、AI モックのバリエーションやエラーパスのテストケースを増強。

## 成果物

- テスト方針文書（本ファイル）
- `vitest.config.ts` およびテスト実行スクリプト（`npm run test`）
- `/test` 配下のフィクスチャ・モック・テストスイート

## 今後の展開

- CI 実行（GitHub Actions 等）で Vitest を定期的に実行し、デプロイ前の安全網とする。
- Miniflare との併用や E2E テストを導入し、本番エンドポイントを使った疎通確認テストへ段階的に拡張。
