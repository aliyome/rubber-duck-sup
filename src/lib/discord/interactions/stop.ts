import { insertMessage } from "../../../data/messageRepository";
import type { MessageRow, SessionRow } from "../../../data/models";
import { markSessionAsStopped } from "../../../data/sessionRepository";
import { createDiscordMessage } from "../api";

function toTimestamp(date: Date): number {
	return date.getTime();
}

function buildStopMessage(now: Date): string {
	return [
		"セッションを終了しました。おつかれさまでした！",
		`また進めたくなったら /start で新しいセッションをはじめましょう (${now.toISOString()})。`,
	].join("\n");
}

export interface StopCommandContext {
	db: D1Database;
	discordToken: string;
	session: SessionRow;
	now: Date;
}

export interface StopCommandResult {
	stopped: boolean;
	message?: MessageRow;
	discordMessageId?: string;
}

export async function handleStopCommand({
	db,
	discordToken,
	session,
	now,
}: StopCommandContext): Promise<StopCommandResult> {
	const ended = await markSessionAsStopped(db, session.id, toTimestamp(now));
	if (!ended) {
		return { stopped: false };
	}

	const threadId = session.discord_thread_id;
	if (!threadId) {
		return { stopped: true };
	}

	const content = buildStopMessage(now);
	const discordMessage = await createDiscordMessage({
		token: discordToken,
		channelId: threadId,
		content,
	});

	const createdAtTimestamp = discordMessage.timestamp
		? Date.parse(discordMessage.timestamp)
		: toTimestamp(now);
	const createdAt = Number.isFinite(createdAtTimestamp) ? createdAtTimestamp : toTimestamp(now);

	const message: MessageRow = {
		id: crypto.randomUUID(),
		session_id: session.id,
		author: "bot",
		discord_message_id: discordMessage.id,
		content,
		created_at: createdAt,
	};

	await insertMessage(db, message);

	return {
		stopped: true,
		message,
		discordMessageId: discordMessage.id,
	};
}
