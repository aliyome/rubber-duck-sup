# **D1** と **KV** を比較する

用途は「20 分ごとに進捗を聞きつつ、直前の会話や前回のタスク状況を踏まえて問いかけ・要約・助言を返す」ボット
この要件に絞って、Cloudflare Workers での永続化手段として **Workers KV** と **D1** を比較し、結論を出します。

## 結論（先に）

- **会話コンテキストの“正(ソース・オブ・トゥルース)”は D1 一択。**
  理由は、直近の書き込みが **即座に確実に読める** こと（セッション整合性）と、**時系列・検索**・整形（JOIN/INDEX）・**復旧（Time Travel）**が必要だから。KV は最終的整合で秒オーダーの遅延があり、直後の問いかけで**古い状態を読む恐れ**があるため、対話の土台には不向きです。([Cloudflare Docs][1])
- **KV は“読み速いキャッシュ”として併用**が最適。たとえば「直近サマリ」「次回プロンプト文」「前回実行時刻」などを 60–600 秒 TTL で置くと、応答レイテンシとコストを下げられます。KV は高スループットのグローバルキャッシュで、**最終的整合**（～ 60 秒）という性質を理解したうえで使うのがコツ。([Cloudflare Docs][2])

---

## 要件に対する適合性

| 観点             | Workers KV                                                                | D1                                                                                                   |
| ---------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 直後の読取一貫性 | **最終的整合**。他 PoP で反映に最大 ~60s（“見えない/古い値”が起こりうる） | **セッション整合性**（Sessions API）。直前の書き込みを同一セッションの後続クエリで確実に可視化できる |
| データ構造       | Key-Value のみ。スキャンも限定的（prefix+list）                           | SQL（SQLite 準拠）。時系列ログ、検索、集計、JOIN/INDEX 可                                            |
| 書込頻度/衝突    | 同一キーは **1 秒に 1 回**まで（超えると 429）                            | 通常の SQL 書き込み（複数ステートメントは `batch`/`exec` で順次実行）。セッション API で順序保証     |
| 値サイズ         | 最大 **25 MiB/Key**                                                       | 行・テーブルで分割して格納                                                                           |
| 規模上限         | （総量はプラン依存）キー列挙は 1,000 件/回などの API 上限                 | **DB あたり 10GB（Paid）**。**Time Travel**（復旧）あり。読み取りレプリカ（グローバル複製）あり      |
| レイテンシ       | ホットリードは超低遅延（キャッシュ前提）                                  | プライマリ所在に依存。**Read Replication** + Sessions でグローバル読取を最適化                       |

（出典：KV の整合性/キャッシュ動作、レート制限・サイズ、D1 のセッション整合・レプリケーション・TimeTravel/上限）([Cloudflare Docs][3])

---

## 推奨アーキテクチャ（最小構成）

1. **D1 を“会話ログの正”として設計**

- `sessions(id, platform, user_id, channel_id, last_prompt_at, …)`
- `messages(id, session_id, role, content, created_at)`（`INDEX(session_id, created_at)`）
- `summaries(session_id, summary, updated_at)`（長い履歴は節目で要約して圧縮）
- アクセスは **D1 Sessions API** を使い、**ブックマーク**を HTTP ヘッダや KV に保持 → 後続リクエストで渡すと直前書込を確実に読めます。([Cloudflare Docs][1])

2. **KV で“速い一時情報”をキャッシュ**

- 例：`kv:session:{id}:last_summary`（TTL=300s）、`kv:session:{id}:next_prompt`、`kv:user:{id}:last_status`
- 1 キーに 1 秒 1 回という制限があるので、**まとめ書き**（一度に上書き） or キーを分散。値は 25MiB まで。([Cloudflare Docs][4])

3. **20 分ごとのトリガ**

- Workers **Cron Triggers** で `*/20 * * * *` を設定し、`scheduled()` から「未応答セッション」をスキャン →Discord へ DM/リプライ送信。([Cloudflare Docs][5])

> 参考コード断片（概念）

```ts
// D1: 新規メッセージの追加とセッションの更新（Sessions APIで一貫性確保）
const session = env.DB.withSession(sessionId); // 任意のセッションID
await session.batch([
  session
    .prepare(
      `INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)`
    )
    .bind(msgId, sessId, role, content, Date.now()),
  session
    .prepare(`UPDATE sessions SET last_prompt_at = ? WHERE id = ?`)
    .bind(Date.now(), sessId),
]);
// KV: サマリをキャッシュ（レート制限に注意）
await env.KV.put(`session:${sessId}:last_summary`, summary, {
  expirationTtl: 300,
});
```

---

## 使い分けの指針（超要約）

- **“整合性/順序/検索/復旧”が要る会話ログ → D1（正）**。Sessions API と Bookmark を使う。([Cloudflare Docs][1])
- **“速い読み出しで十分な派生情報” → KV（キャッシュ）**。最終的整合（～ 60s）と 1 秒 1 書込/Key を前提に設計。([Cloudflare Docs][3])

---

## 補足（将来の拡張）

- **Read Replication** を有効化すると、世界中からの読み取りをレプリカに逃がし低遅延化。セッション API と一緒に使うと「直前書込が見えない」問題を回避しつつ高速化できます。([Cloudflare Docs][1])
- **Time Travel** で事故時に直近 30 日（Paid）まで**指定時点復旧**が可能。運用上の安心感が高いです。([Cloudflare Docs][6])
- 「1 セッション＝ 1 の順序制御」がより厳密に必要なら、**Durable Objects** を書き込みの単一経路（シリアライザ）として併用するとさらに堅牢です。([Cloudflare Docs][2])

---

必要なら、この方針で **D1 スキーマ（DDL）** と **実装テンプレ（Hono/Discord SDK 連携 + Cron + KV キャッシュ）** を一気に出します。どのスタックで進めます？（Hono / itty-router / 生の `fetch` など）

[1]: https://developers.cloudflare.com/d1/best-practices/read-replication/?utm_source=chatgpt.com "Global read replication - D1"
[2]: https://developers.cloudflare.com/workers/platform/storage-options/?utm_source=chatgpt.com "Choosing a data or storage product. - Workers"
[3]: https://developers.cloudflare.com/kv/concepts/how-kv-works/ "How KV works · Cloudflare Workers KV docs"
[4]: https://developers.cloudflare.com/kv/api/write-key-value-pairs/?utm_source=chatgpt.com "Write key-value pairs - KV"
[5]: https://developers.cloudflare.com/workers/configuration/cron-triggers/?utm_source=chatgpt.com "Cron Triggers - Workers"
[6]: https://developers.cloudflare.com/d1/platform/limits/?utm_source=chatgpt.com "Limits - D1"
