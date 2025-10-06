import { insertMessage, listMessagesForSession } from "../data/messageRepository";
import type { MessageRow, PromptDueSession } from "../data/models";
import { getDueSessions, updateSessionAfterPrompt } from "../data/sessionRepository";
import { generateProgressPrompt } from "../lib/ai/progressPrompt";
import { createDiscordMessage } from "../lib/discord/api";

interface PromptSchedulerContext {
	db: D1Database;
	discordToken: string;
	discordApplicationId: string;
	scheduled: Date;
	ai: Ai;
}

/**
 * Entry point for the cron trigger to enqueue and deliver progress prompts.
 * The detailed implementation will follow the design in
 * docs/research/processing_flow_and_data_model.md.
 */
export async function processPromptSchedulerTick({
	db,
	discordToken,
	discordApplicationId,
	scheduled,
	ai,
}: PromptSchedulerContext): Promise<void> {
	console.info("cron.tick", {
		executedAt: scheduled.toISOString(),
		discordApplicationId,
	});

	const referenceTime = scheduled.getTime();
	const dueSessions = await getDueSessions(db, referenceTime);
	if (dueSessions.length === 0) {
		console.info("cron.tick.noop", { referenceTime });
		return;
	}

	for (const session of dueSessions) {
		await processDueSession({
			db,
			discordToken,
			session,
			scheduled,
			ai,
		}).catch((error) => {
			console.error("cron.prompt.failed", {
				error,
				sessionId: session.id,
				referenceTime,
			});
		});
	}
}

interface DueSessionContext {
	db: D1Database;
	discordToken: string;
	session: PromptDueSession;
	scheduled: Date;
	ai: Ai;
}

function safeTimestamp(value: string | undefined, fallback: number): number {
	if (!value) {
		return fallback;
	}
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

async function processDueSession({
	db,
	discordToken,
	session,
	scheduled,
	ai,
}: DueSessionContext): Promise<void> {
	const history = await listMessagesForSession(db, session.id);
	const { prompt } = await generateProgressPrompt({
		ai,
		history,
		now: scheduled,
		cadenceMinutes: session.cadence_minutes,
	});

	const channelId = session.discord_thread_id ?? session.discord_channel_id;
	if (!channelId) {
		console.warn("cron.prompt.skip", {
			sessionId: session.id,
			reason: "missing_channel",
		});
		return;
	}

	const content = `<@${session.discord_user_id}> \n${prompt}`;
	const discordMessage = await createDiscordMessage({
		token: discordToken,
		channelId,
		content,
		mentionEveryone: true,
	});

	const createdAt = safeTimestamp(discordMessage.timestamp, scheduled.getTime());
	const botMessage: MessageRow = {
		id: crypto.randomUUID(),
		session_id: session.id,
		author: "bot",
		discord_message_id: discordMessage.id,
		content: prompt,
		created_at: createdAt,
	};

	await insertMessage(db, botMessage);

	const nextPromptDue = createdAt + session.cadence_minutes * 60_000;
	await updateSessionAfterPrompt(db, session.id, {
		lastPromptSentAt: createdAt,
		nextPromptDue,
	});

	console.info("cron.prompt.sent", {
		sessionId: session.id,
		discordMessageId: discordMessage.id,
		nextPromptDue,
	});
}
