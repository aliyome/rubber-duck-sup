# Cloudflare Workers AI：テキスト生成 & 要約 API まとめ（公式ドキュメント調査）

## 全体像（呼び出し方）

- **REST API**
  `POST https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/run/{MODEL}`
  認証は `Authorization: Bearer {API_TOKEN}`。レスポンスは Cloudflare v4 形式（`result`, `success`, `errors` などを含む）。例では `result.response` に生成テキストが返ります。 ([Cloudflare Docs][1])
- **Workers Binding（env.AI.run）**
  Worker/Pages から `await env.AI.run(model, payload)` で直接実行。`stream: true` を指定すると **SSE（text/event-stream）** でストリーミング可能。レスポンスはモデル固有の**素のオブジェクト**（例：`{ response, usage, ... }`）を返します。 ([Cloudflare Docs][2])
- **OpenAI 互換エンドポイント**
  `/ai/v1/chat/completions`（および `/ai/v1/embeddings`）を提供。OpenAI SDK の `baseURL` を差し替えて使えます（ボディは OpenAI の Chat Completions 仕様：`model`, `messages`, …）。 ([Cloudflare Docs][3])

---

## テキスト生成（Text Generation）

### リクエスト形式（代表：Llama 3.x / Mistral / Gemma など）

どのモデルも概ね以下をサポート：

- **入力**

  - `prompt: string` **または** `messages: Array<{ role, content }>`（チャット形式）
  - 生成制御：`max_tokens`, `temperature`, `top_p`, `top_k`, `seed`, `frequency_penalty`, `presence_penalty`, `repetition_penalty`
  - **JSON Mode**：`response_format`（`type: "json_object" | "json_schema"` など）
  - **ストリーミング**：`stream: true`（SSE）
  - その他：`lora`、`raw`（チャットテンプレート無効化） など
    仕様例（llama-3.2-1b-instruct のパラメータ定義）に準拠。 ([Cloudflare Docs][2])

- **Workers でのストリーミング例**

  - `const stream = await env.AI.run("<model>", { messages, stream: true });`
  - `return new Response(stream, { headers: { "content-type": "text/event-stream" } });` ([Cloudflare Docs][2])

### レスポンス形式

- **REST API**：Cloudflare v4 エンベロープ

  ```json
  {
    "result": { "response": "<生成テキスト>" },
    "success": true,
    "errors": [],
    "messages": []
  }
  ```

  （例は Llama 3.1 8B instruct） ([Cloudflare Docs][1])

- **Workers Binding**：モデル固有オブジェクト

  - 代表例（llama 系）：

    ```json
    { "response": "<生成テキスト>", "usage": { "prompt_tokens": n, "completion_tokens": m, "total_tokens": t }, "tool_calls": [...] }
    ```

    ※出力スキーマとして `response` 必須、`usage` 等が付随。 ([Cloudflare Docs][2])

### cURL（REST）最小例

````bash
curl https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/ai/run/@cf/meta/llama-3.1-8b-instruct \
  -H "Authorization: Bearer $API_TOKEN" \
  -d '{ "messages": [{ "role":"user", "content":"Hello World の語源は?" }] }'
``` :contentReference[oaicite:7]{index=7}

---

## 要約（Summarization）

### 利用可能な要約モデル（公式）
- **@cf/facebook/bart-large-cnn**（Summarization）
  BART による要約専用モデル（Beta）。 :contentReference[oaicite:8]{index=8}

※ Llama/Gemma など汎用テキスト生成モデルでもプロンプト設計次第で要約は可能ですが、**専用モデルは I/O が簡潔**でコスト効率が良い場合があります。 :contentReference[oaicite:9]{index=9}

### リクエスト形式（bart-large-cnn）
- **入力**：
  - `input_text: string`（必須, 要約対象）
  - `max_length: number`（省略可, 既定 1024）
- **Workers 例**：`await env.AI.run("@cf/facebook/bart-large-cnn", { input_text, max_length })`
- **REST 例**（cURL）：
  ```bash
  curl https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/ai/run/@cf/facebook/bart-large-cnn \
    -H "Authorization: Bearer $API_TOKEN" \
    -d '{ "input_text":"...", "max_length": 200 }'
````

- **レスポンス**：

  - **Workers**：`{ "summary": "<要約テキスト>" }`
  - **REST**　：`{ "result": { "summary": "<要約テキスト>" }, "success": true, ... }` ([Cloudflare Docs][4])

---

## 代表的な「テキスト生成」モデル（モデル ID）

- **Meta Llama**

  - `@cf/meta/llama-3.2-1b-instruct`（小型/60K ctx・多言語） ([Cloudflare Docs][5])
  - `@cf/meta/llama-3.1-8b-instruct`（多言語/チャット最適化） ([Cloudflare Docs][6])
  - `@cf/meta/llama-3.1-8b-instruct-fast`（高速版・最大 128K ctx） ([Cloudflare Docs][7])
  - `@cf/meta/llama-3.1-70b-instruct`（大型） ([Cloudflare Docs][8])

- **Google Gemma**

  - `@cf/google/gemma-3-12b-it`（要約・推論にも適性／マルチモーダル入力対応） ([Cloudflare Docs][9])

- **Mistral**

  - `@cf/mistral/mistral-small-3.1-24b-instruct` ([Cloudflare Docs][10])

- **Qwen（Reasoning）**

  - `@cf/qwen/qwq-32b`（思考特化：Structured 出力/JSON ガイド付きにも対応） ([Cloudflare Docs][11])

- **（カタログ全体）**
  最新のモデルカタログは **Workers AI models catalog** を参照。 ([Cloudflare Docs][1])

---

## 補足（実装時の要点）

- **JSON Mode**（`response_format`）で厳密な JSON 出力を強制可能（スキーマ指定可）。ツール実行やエージェント連携に有用。 ([Cloudflare Docs][12])
- **OpenAI 互換**を使うと既存の OpenAI SDK/クライアントをそのまま流用しやすい（`baseURL` を Cloudflare に変更）。 ([Cloudflare Docs][3])
- **ストリーミング**は `stream: true` + `text/event-stream` で SSE。長文や推論負荷の高いモデルで体感を改善。 ([Cloudflare Docs][2])

---

### すぐ使える最小サンプル（Workers・TypeScript）

```ts
export interface Env {
  AI: Ai;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    // テキスト生成（チャット形式）
    const r1 = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [{ role: "user", content: "3行で自己紹介して" }],
      max_tokens: 128,
    });

    // 要約（専用モデル）
    const r2 = await env.AI.run("@cf/facebook/bart-large-cnn", {
      input_text: "（長文テキスト…）",
      max_length: 120,
    });

    return Response.json({ gen: r1, summary: r2 });
  },
} satisfies ExportedHandler<Env>;
```

（各モデルの詳細パラメータと I/O 仕様は上記リンク先のモデルページに準拠） ([Cloudflare Docs][6])

---

必要なら、あなたの要件（Workers or REST / ストリーミング要否 / JSON 出力 / コスト上限 など）に合わせて**最適なモデル選定とコード雛形**まで落とし込みます。

[1]: https://developers.cloudflare.com/workers-ai/get-started/rest-api/ "Get started - REST API · Cloudflare Workers AI docs"
[2]: https://developers.cloudflare.com/workers-ai/models/llama-3.2-1b-instruct/ "llama-3.2-1b-instruct · Cloudflare Workers AI docs"
[3]: https://developers.cloudflare.com/workers-ai/configuration/open-ai-compatibility/ "OpenAI compatible API endpoints · Cloudflare Workers AI docs"
[4]: https://developers.cloudflare.com/workers-ai/models/bart-large-cnn/?utm_source=chatgpt.com "bart-large-cnn Beta - Workers AI"
[5]: https://developers.cloudflare.com/workers-ai/models/llama-3.2-1b-instruct/?utm_source=chatgpt.com "llama-3.2-1b-instruct - Workers AI"
[6]: https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct/?utm_source=chatgpt.com "llama-3.1-8b-instruct · Cloudflare Workers AI docs"
[7]: https://developers.cloudflare.com/workers-ai/models/llama-3.1-8b-instruct-fast/?utm_source=chatgpt.com "llama-3.1-8b-instruct-fast - Workers AI"
[8]: https://developers.cloudflare.com/workers-ai/models/llama-3.1-70b-instruct/?utm_source=chatgpt.com "llama-3.1-70b-instruct - Workers AI"
[9]: https://developers.cloudflare.com/workers-ai/models/gemma-3-12b-it/?utm_source=chatgpt.com "gemma-3-12b-it - Workers AI"
[10]: https://developers.cloudflare.com/workers-ai/models/mistral-small-3.1-24b-instruct/?utm_source=chatgpt.com "mistral-small-3.1-24b-instruct - Workers AI"
[11]: https://developers.cloudflare.com/workers-ai/models/qwq-32b/?utm_source=chatgpt.com "qwq-32b - Workers AI"
[12]: https://developers.cloudflare.com/workers-ai/features/json-mode/?utm_source=chatgpt.com "JSON Mode - Workers AI"
