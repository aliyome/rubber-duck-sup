import { insertMessage } from "../../../data/messageRepository";
import type { MessageRow, SessionRow } from "../../../data/models";
import { updateSessionAfterUserReply } from "../../../data/sessionRepository";

export interface ProgressCommandContext {
	db: D1Database;
	session: SessionRow;
	progressText: string;
	now: Date;
}

export interface ProgressCommandResult {
	userMessage: MessageRow;
	nextPromptDue: number;
}

export async function handleProgressCommand({
	db,
	session,
	progressText,
	now,
}: ProgressCommandContext): Promise<ProgressCommandResult> {
	const normalized = progressText.trim();
	if (normalized.length === 0) {
		throw new Error("Progress text must not be empty");
	}

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

	const nextPromptDue = timestamp + session.cadence_minutes * 60_000;
	await updateSessionAfterUserReply(db, session.id, {
		lastUserReplyAt: timestamp,
		nextPromptDue,
	});

	return {
		userMessage,
		nextPromptDue,
	};
}
