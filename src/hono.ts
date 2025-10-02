import { Hono } from "hono";
import { verifyDiscordSignature } from "./lib/discord/verifySignature";

const decoder = new TextDecoder();

enum InteractionType {
	PING = 1,
}

enum InteractionResponseType {
	PONG = 1,
}

interface DiscordInteraction {
	type: InteractionType;
}

export const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.text("Hello World!"));

app.post("/interactions", async (c) => {
	const signature = c.req.header("x-signature-ed25519") ?? "";
	const timestamp = c.req.header("x-signature-timestamp") ?? "";
	const rawBody = await c.req.raw.arrayBuffer();

	const isValid = await verifyDiscordSignature({
		signature,
		timestamp,
		publicKey: c.env.DISCORD_PUBLIC_KEY,
		rawBody,
	});

	if (!isValid) {
		return c.json({ error: "invalid request signature" }, 401);
	}

	let interaction: DiscordInteraction;
	try {
		interaction = JSON.parse(decoder.decode(rawBody)) as DiscordInteraction;
	} catch (_error) {
		return c.json({ error: "invalid request body" }, 400);
	}

	if (interaction.type === InteractionType.PING) {
		return c.json({ type: InteractionResponseType.PONG });
	}

	return c.json({ error: "unsupported interaction type" }, 501);
});
