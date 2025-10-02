# Discord Bot on Cloudflare Workers

結論から言うと：

- 受信は **Interactions の Webhook（/interactions）** を Workers で受けるのが王道（署名検証必須） ([Discord][1])
- 送信は **インタラクションの同期応答** または **REST API（Bot トークン）** で可能 ([Discord][1])
- 定期実行は **Workers の Cron Triggers → scheduled() ハンドラ** を使う ([Cloudflare Docs][2])

> ※ “ユーザーの通常メッセージ（非スラコ）を受け取る” のは Gateway(WebSocket) になるため、Workers では **Durable Objects で常時接続を維持** する高度な構成が必要です。基本編では **スラッシュコマンド等の Interactions** を前提にします。Cloudflare × Discord 公式チュートリアルでも Interactions を使っています。 ([Discord][3])

---

## 1) 事前準備（Discord 側）

1. Discord Developer Portal でアプリを作成し、**Public Key**／**Application ID** を控える（Bot を追加してサーバーへ招待）。
2. **Interactions Endpoint URL** に、あなたの Worker の `/interactions` を設定。設定時、Discord は `type:1 (PING)` を送ってくるので **`{"type":1}` を返せること** が必須です（署名検証が通っていないと失敗します）。 ([Discord][4])
3. スラッシュコマンドの定義（`/ping`, `/echo` など）を **アプリケーションコマンド API** で登録します（下に curl 例あり）。 ([Discord][5])

---

## 2) Workers 側：`wrangler.toml`

**MUST:** toml で定義しているが、2025/10/02 現在は jsonc で定義すべき

```toml
name = "discord-worker"
main = "src/worker.ts"
compatibility_date = "2025-10-02"

[triggers]
# 20分ごとに定期実行（自由に変更可）
crons = ["*/20 * * * *"]

[vars]
# 例: 固定の公開値／IDは [vars]、秘密は "wrangler secret put" で
DISCORD_APPLICATION_ID = "your_app_id"
ANNOUNCE_CHANNEL_ID = "your_channel_id"
```

※ 秘密情報は以下を `wrangler secret put` で投入してください：

- `DISCORD_PUBLIC_KEY`（アプリの “Public Key”）
- `DISCORD_BOT_TOKEN`（Bot Token）

Cron と scheduled ハンドラの紐づけはこれだけで完了です。 ([Cloudflare Docs][2])

---

## 3) Workers 本体：`src/worker.ts`（TypeScript / モジュールワーカー）

```ts
export interface Env {
  DISCORD_PUBLIC_KEY: string; // wrangler secret put DISCORD_PUBLIC_KEY
  DISCORD_APPLICATION_ID: string; // [vars]
  DISCORD_BOT_TOKEN: string; // wrangler secret put DISCORD_BOT_TOKEN
  ANNOUNCE_CHANNEL_ID: string; // [vars] 送信先チャンネル
}

type Interaction = {
  type: number;
  data?: { name: string; options?: any[] };
  token?: string;
};

// JSON レスポンス用ヘルパ
const json = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
    ...init,
  });

// --- Discord 署名検証（Ed25519 / X-Signature-*） ---
// 仕様：timestamp + rawBody を Ed25519 で検証。ヘッダ名は固定。
async function verifyDiscordRequest(
  bodyText: string,
  signatureHex: string,
  timestamp: string,
  publicKeyHex: string
): Promise<boolean> {
  const enc = new TextEncoder();
  const msg = enc.encode(timestamp + bodyText);
  const sig = hexToUint8(signatureHex);
  const pub = hexToUint8(publicKeyHex);

  // WorkersのWebCryptoは Ed25519 をサポート（互換のため NODE-ED25519 もフォールバック）
  // https://developers.cloudflare.com/workers/runtime-apis/web-crypto/
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      pub,
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    return await crypto.subtle.verify({ name: "Ed25519" }, key, sig, msg);
  } catch {
    // 古い互換名（環境差異吸収）
    const alg: any = { name: "NODE-ED25519", namedCurve: "NODE-ED25519" };
    const key = await crypto.subtle.importKey("raw", pub, alg, false, [
      "verify",
    ]);
    return await crypto.subtle.verify(alg, key, sig, msg);
  }
}

function hexToUint8(hex: string): Uint8Array {
  if (hex.startsWith("0x")) hex = hex.slice(2);
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

// --- Discord REST 送信（任意タイミング） ---
async function sendChannelMessage(
  env: Env,
  channelId: string,
  content: string
) {
  const r = await fetch(
    `https://discord.com/api/v10/channels/${channelId}/messages`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify({ content }),
    }
  );
  if (!r.ok) {
    console.error("Failed to send message:", r.status, await r.text());
  }
}

export default {
  // 受信（Interactions Webhook）
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/interactions" && request.method === "POST") {
      const signature = request.headers.get("X-Signature-Ed25519");
      const timestamp = request.headers.get("X-Signature-Timestamp");
      const bodyText = await request.text();
      if (!signature || !timestamp)
        return new Response("Bad request", { status: 401 });

      const ok = await verifyDiscordRequest(
        bodyText,
        signature,
        timestamp,
        env.DISCORD_PUBLIC_KEY
      );
      if (!ok) return new Response("Bad signature", { status: 401 });

      const interaction = JSON.parse(bodyText) as Interaction;

      // PING 応答（エンドポイント検証）
      if (interaction.type === 1 /* PING */) {
        return json({ type: 1 /* PONG */ }); // そのまま返すだけ
      }

      // Slash Command（/ping, /echo）— 即時応答
      if (
        interaction.type === 2 /* APPLICATION_COMMAND */ &&
        interaction.data
      ) {
        const name = interaction.data.name;

        if (name === "ping") {
          // flags: 64 でエフェメラル（実行者のみに表示）
          return json({
            type: 4 /* CHANNEL_MESSAGE_WITH_SOURCE */,
            data: { content: "Pong!", flags: 64 },
          });
        }

        if (name === "echo") {
          const text =
            interaction.data.options?.find((o: any) => o.name === "text")
              ?.value ?? "";
          return json({ type: 4, data: { content: `You said: ${text}` } });
        }

        return json({
          type: 4,
          data: { content: "Unknown command", flags: 64 },
        });
      }

      // それ以外
      return new Response("", { status: 204 });
    }

    // 簡易ヘルスチェック
    if (url.pathname === "/health") {
      return new Response("ok");
    }

    return new Response("not found", { status: 404 });
  },

  // 定期実行（Cron Trigger）
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const when = new Date(event.scheduledTime).toISOString();
    ctx.waitUntil(
      sendChannelMessage(
        env,
        env.ANNOUNCE_CHANNEL_ID,
        `⏰ cron fired at ${when} (Workers scheduled)`
      )
    );
  },
};
```

- **署名検証**：Discord は `X-Signature-Ed25519` と `X-Signature-Timestamp` を付けてリクエストします。`timestamp + body` を **Ed25519 で検証**する必要があります（未検証は 401 等で拒否）。 ([Discord][1])
- **Ed25519 on Workers**：Workers の WebCrypto は Ed25519 をサポート（歴史的理由で `NODE-ED25519` 名もあり）。上記は “まず `Ed25519`、失敗したら `NODE-ED25519`” のフォールバック実装です。 ([Cloudflare Docs][6])
- **インタラクション応答**：`type:1(PING)` → `type:1(PONG)`、スラコは `type:4(CHANNEL_MESSAGE_WITH_SOURCE)` で返信。長い処理は `type:5(DEFERRED_...)` を返して後から follow-up を送る方式もあります。 ([Discord][1])
- **エフェメラル**：`flags: 64` を付けると実行者にのみ表示されます。 ([Discord.Net Docs][7])
- **定期実行**：`wrangler.toml` の `triggers.crons` と `scheduled()` ハンドラで OK。 ([Cloudflare Docs][2])

---

## 4) スラッシュコマンド登録（最小）

グローバルコマンドを一括上書きする例（反映に最大 1 時間ほどかかることがあります。ギルドコマンドなら即時）：

```bash
APP_ID=your_app_id
BOT_TOKEN=your_bot_token

curl -X PUT "https://discord.com/api/v10/applications/$APP_ID/commands" \
  -H "Authorization: Bot $BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '[
    { "name": "ping", "type": 1, "description": "Replies with Pong!" },
    { "name": "echo", "type": 1, "description": "Echo text",
      "options": [
        { "type": 3, "name": "text", "description": "what to say", "required": true }
      ]
    }
  ]'
```

アプリケーションコマンドの仕様は公式ドキュメントを参照ください。 ([Discord][5])

---

## 5) 動作の要点（ダイジェスト）

- **往路（受信）**：Discord ⇒ `/interactions`（署名付き）。Workers で **Ed25519 検証** → `PING`/`COMMAND` をハンドリング。3 秒以内に応答（重い処理は deferred）。 ([Discord][1])
- **復路（送信）**：

  - 即時返信：`type:4`（必要なら `flags:64` でエフェメラル） ([discord-py-slash-command.readthedocs.io][8])
  - 任意送信：`POST /channels/{id}/messages`（Bot Token）。Bot がサーバー参加＆権限が必要。

- **定期トリガ**：`crons` → `scheduled()` 内で `fetch` すれば、バッチや定期投稿が書けます。 ([Cloudflare Docs][2])

---

### 参考リンク（公式多め）

- Discord — Receiving & Responding to Interactions（署名検証／応答種別） ([Discord][1])
- Discord — Interactions 概要（PING→PONG ハンドシェイク） ([Discord][4])
- Discord — Application Commands（Slash コマンド定義） ([Discord][5])
- Cloudflare — Cron Triggers（設定） / scheduled ハンドラ（実装） ([Cloudflare Docs][2])
- Cloudflare — WebCrypto（Workers での Ed25519 サポート） ([Cloudflare Docs][6])
- 参考：エフェメラル `flags: 64` の定義（Discord.Net の列挙） ([Discord.Net Docs][7])

---

必要なら、**Durable Objects を使って Discord Gateway へ常時接続する構成**（メッセージ作成イベントを受ける）や、**KV/D1 で状態保存**、**ギルドコマンド即時反映**（`/applications/{app}/guilds/{guild}/commands`）のテンプレも用意できます。次はどこまで広げたいか教えてください。

[1]: https://discord.com/developers/docs/interactions/receiving-and-responding?utm_source=chatgpt.com "Interactions | Documentation | Discord Developer Portal"
[2]: https://developers.cloudflare.com/workers/configuration/cron-triggers/?utm_source=chatgpt.com "Cron Triggers - Workers"
[3]: https://discord.com/developers/docs/tutorials/hosting-on-cloudflare-workers?utm_source=chatgpt.com "Hosting a Reddit API Discord app on Cloudflare Workers"
[4]: https://discord.com/developers/docs/interactions/overview?utm_source=chatgpt.com "Overview of Interactions | Documentation"
[5]: https://discord.com/developers/docs/interactions/application-commands?utm_source=chatgpt.com "Application Commands | Documentation"
[6]: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/?utm_source=chatgpt.com "Web Crypto - Workers"
[7]: https://docs.discordnet.dev/api/Discord.MessageFlags.html?utm_source=chatgpt.com "Enum MessageFlags"
[8]: https://discord-py-slash-command.readthedocs.io/en/latest/enums.html?utm_source=chatgpt.com "Enumerable Objects - interactions.py 4.4.0 documentation"
