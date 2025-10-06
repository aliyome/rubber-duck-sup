import { Hono } from "hono";
import { getActiveSessionByDiscordUserId } from "./data/sessionRepository";
import { handleProgressCommand } from "./lib/discord/interactions/progress";
import { handleStartCommand } from "./lib/discord/interactions/start";
import { handleStopCommand } from "./lib/discord/interactions/stop";
import { verifyDiscordSignature } from "./lib/discord/verifySignature";

const decoder = new TextDecoder();

const EPHEMERAL_FLAG = 1 << 6; // 64

enum InteractionType {
	PING = 1,
	APPLICATION_COMMAND = 2,
}

enum InteractionResponseType {
	PONG = 1,
	CHANNEL_MESSAGE_WITH_SOURCE = 4,
}

interface DiscordUser {
	id: string;
	username?: string;
}

interface DiscordMember {
	user?: DiscordUser;
}

interface DiscordCommandOption {
	name: string;
	value?: string | number | boolean;
}

interface DiscordCommandData {
	name?: string;
	options?: DiscordCommandOption[];
}

interface DiscordInteraction {
	type: InteractionType;
	data?: DiscordCommandData;
	member?: DiscordMember;
	user?: DiscordUser;
	token?: string;
	id?: string;
	application_id?: string;
	channel_id?: string;
}

function getCommandOption(
	options: DiscordCommandOption[] | undefined,
	name: string,
): DiscordCommandOption | undefined {
	return options?.find((option) => option.name === name);
}

function getStringOption(options: DiscordCommandOption[] | undefined, name: string): string | null {
	const option = getCommandOption(options, name);
	if (!option) {
		return null;
	}
	if (typeof option.value === "string") {
		return option.value;
	}
	return null;
}

function getNumericOption(
	options: DiscordCommandOption[] | undefined,
	name: string,
): number | null {
	const option = getCommandOption(options, name);
	if (!option) {
		return null;
	}
	if (typeof option.value === "number") {
		return option.value;
	}
	if (typeof option.value === "string") {
		const parsed = Number(option.value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

function getInteractionUserId(interaction: DiscordInteraction): string | null {
	return interaction.member?.user?.id ?? interaction.user?.id ?? null;
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

	if (interaction.type === InteractionType.APPLICATION_COMMAND) {
		const commandName = interaction.data?.name?.toLowerCase();
		if (commandName === "start") {
			const userId = getInteractionUserId(interaction);
			if (!userId) {
				return c.json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						content: "ユーザー情報を取得できませんでした。Discord 側の権限を確認してください。",
						flags: EPHEMERAL_FLAG,
					},
				});
			}

			const channelId = interaction.channel_id;
			if (!channelId) {
				return c.json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						content: "コマンドを実行したチャンネル情報を取得できませんでした。",
						flags: EPHEMERAL_FLAG,
					},
				});
			}

			const title = getStringOption(interaction.data?.options, "title") ?? undefined;
			const cadenceOptionValue = getNumericOption(interaction.data?.options, "cadence");
			const cadenceMinutes =
				cadenceOptionValue && cadenceOptionValue > 0 ? Math.floor(cadenceOptionValue) : undefined;

			const now = new Date();
			try {
				const result = await handleStartCommand({
					db: c.env.DB,
					discordToken: c.env.DISCORD_TOKEN,
					discordUserId: userId,
					baseChannelId: channelId,
					now,
					title,
					cadenceMinutes,
					userDisplayName: interaction.member?.user?.username ?? interaction.user?.username,
				});

				const cadenceText = result.session.cadence_minutes.toString();
				const closedSuffix =
					result.endedSessionCount > 0
						? `（以前のセッション ${result.endedSessionCount} 件は自動終了済み）`
						: "";
				return c.json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						content:
							`セッションを開始しました。リマインダー間隔は約${cadenceText}分です。新しいスレッドは <#${result.threadId}> です。${closedSuffix}`.trim(),
						flags: EPHEMERAL_FLAG,
					},
				});
			} catch (error) {
				console.error("interaction.start.failed", {
					error,
					userId,
					channelId,
				});
				return c.json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						content: "セッションの開始に失敗しました。しばらく待ってから再度お試しください。",
						flags: EPHEMERAL_FLAG,
					},
				});
			}
		}

		if (commandName === "stop") {
			const userId = getInteractionUserId(interaction);
			if (!userId) {
				return c.json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						content: "ユーザー情報を取得できませんでした。Discord 側の権限を確認してください。",
						flags: EPHEMERAL_FLAG,
					},
				});
			}

			const session = await getActiveSessionByDiscordUserId(c.env.DB, userId);
			if (!session) {
				return c.json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						content: "現在アクティブなセッションはありません。",
						flags: EPHEMERAL_FLAG,
					},
				});
			}

			const now = new Date();
			try {
				const result = await handleStopCommand({
					db: c.env.DB,
					discordToken: c.env.DISCORD_TOKEN,
					session,
					now,
				});

				if (!result.stopped) {
					return c.json({
						type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
						data: {
							content: "セッションはすでに終了しています。必要であれば /start で再開してください。",
							flags: EPHEMERAL_FLAG,
						},
					});
				}

				const threadMention = session.discord_thread_id
					? `（<#${session.discord_thread_id}>）`
					: "";
				return c.json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						content: `セッションを終了しました${threadMention}。必要になったら /start で再開できます。`,
						flags: EPHEMERAL_FLAG,
					},
				});
			} catch (error) {
				console.error("interaction.stop.failed", {
					error,
					sessionId: session.id,
					userId,
				});
				return c.json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						content: "セッションの終了に失敗しました。時間をおいて再度お試しください。",
						flags: EPHEMERAL_FLAG,
					},
				});
			}
		}

		if (commandName === "progress") {
			const progressOption = getCommandOption(interaction.data?.options, "status");
			const progressText =
				typeof progressOption?.value === "string" ? progressOption.value.trim() : "";
			if (progressText.length === 0) {
				return c.json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						content: "進捗内容のテキストが見つかりませんでした。もう一度入力してください。",
						flags: EPHEMERAL_FLAG,
					},
				});
			}

			const userId = getInteractionUserId(interaction);
			if (!userId) {
				return c.json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						content: "ユーザー情報を取得できませんでした。Discord 側の権限を確認してください。",
						flags: EPHEMERAL_FLAG,
					},
				});
			}

			const session = await getActiveSessionByDiscordUserId(c.env.DB, userId);
			if (!session) {
				return c.json({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						content: "/start でセッションを開始してから進捗を報告してください。",
						flags: EPHEMERAL_FLAG,
					},
				});
			}

			const now = new Date();
			c.executionCtx.waitUntil(
				handleProgressCommand({
					db: c.env.DB,
					ai: c.env.AI,
					discordToken: c.env.DISCORD_TOKEN,
					session,
					progressText,
					now,
				}).catch((error) => {
					console.error("interaction.progress.failed", {
						error,
						sessionId: session.id,
						userId,
					});
				}),
			);

			return c.json({
				type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
				data: {
					content:
						"進捗報告ありがとうございます！フィードバックをスレッドに投稿します。少々お待ちください。",
					flags: EPHEMERAL_FLAG,
				},
			});
		}

		return c.json({
			type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: {
				content: "未対応のコマンドです。",
				flags: EPHEMERAL_FLAG,
			},
		});
	}

	return c.json({ error: "unsupported interaction type" }, 501);
});
