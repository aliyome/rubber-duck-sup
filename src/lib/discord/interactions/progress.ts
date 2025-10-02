import { insertMessage, listMessagesForSession } from "../../../data/messageRepository";
import type { MessageRow, SessionRow } from "../../../data/models";
import { updateSessionAfterUserReply } from "../../../data/sessionRepository";
import { generateProgressFeedback } from "../../ai/progressFeedback";
import { createDiscordMessage } from "../api";

export interface ProgressCommandContext {
	db: D1Database;
	ai: Ai;
	discordToken: string;
	session: SessionRow;
	progressText: string;
	now: Date;
}

export interface ProgressCommandResult {
	userMessage: MessageRow;
	botMessage: MessageRow;
	discordMessageId: string;
	nextPromptDue: number;
	model: string;
}

export class MissingThreadTargetError extends Error {
	constructor(sessionId: string) {
		super(`Session ${sessionId} does not have a Discord channel or thread configured`);
		this.name = "MissingThreadTargetError";
	}
}

export async function handleProgressCommand({
	db,
	ai,
	discordToken,
	session,
	progressText,
	now,
}: ProgressCommandContext): Promise<ProgressCommandResult> {
	const normalized = progressText.trim();
	if (normalized.length === 0) {
		throw new Error("Progress text must not be empty");
	}

	const history = await listMessagesForSession(db, session.id);
	const timestamp = now.getTime();

	const userMessage: MessageRow = {
		id: crypto.randomUUID(),
		session_id: session.id,
		author: "user",
		discord_message_id: null,
		content: normalized,
		created_at: timestamp,
	};
	await insertMessage(db, userMessage);

	const feedback = await generateProgressFeedback({
		ai,
		history: [...history, userMessage],
		now,
		userUpdate: normalized,
	});

	const channelId = session.discord_thread_id ?? session.discord_channel_id;
	if (!channelId) {
		throw new MissingThreadTargetError(session.id);
	}

	const discordResponse = await createDiscordMessage({
		token: discordToken,
		channelId,
		content: feedback.message,
	});

	const responseTimestamp = discordResponse.timestamp
		? Date.parse(discordResponse.timestamp)
		: timestamp;
	const createdAt = Number.isFinite(responseTimestamp) ? responseTimestamp : timestamp;

	const botMessage: MessageRow = {
		id: crypto.randomUUID(),
		session_id: session.id,
		author: "bot",
		discord_message_id: discordResponse.id,
		content: feedback.message,
		created_at: createdAt,
	};
	await insertMessage(db, botMessage);

	const nextPromptDue = timestamp + session.cadence_minutes * 60_000;
	await updateSessionAfterUserReply(db, session.id, {
		lastUserReplyAt: timestamp,
		nextPromptDue,
	});

	return {
		userMessage,
		botMessage,
		discordMessageId: discordResponse.id,
		nextPromptDue,
		model: feedback.model,
	};
}
