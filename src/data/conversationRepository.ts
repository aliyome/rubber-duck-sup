import { insertMessage, listMessagesForSession } from "./messageRepository";
import type { MessageRow } from "./models";
import { getActiveSessionByDiscordUserId } from "./sessionRepository";

export interface SaveConversationMessageInput {
	db: D1Database;
	discordUserId: string;
	author: MessageRow["author"];
	content: string;
	discordMessageId?: string | null;
	createdAt?: number;
	id?: string;
}

/**
 * Persist a conversation message for the active session that belongs to the specified Discord user.
 * The caller is responsible for ensuring that an active session already exists.
 */
export async function saveConversationMessage({
	db,
	discordUserId,
	author,
	content,
	discordMessageId,
	createdAt,
	id,
}: SaveConversationMessageInput): Promise<MessageRow> {
	const session = await getActiveSessionByDiscordUserId(db, discordUserId);
	if (!session) {
		throw new Error(`Active session not found for Discord user ${discordUserId}`);
	}

	const message: MessageRow = {
		id: id ?? crypto.randomUUID(),
		session_id: session.id,
		author,
		discord_message_id: discordMessageId ?? null,
		content,
		created_at: createdAt ?? Date.now(),
	};

	await insertMessage(db, message);
	return message;
}

/**
 * Retrieve the persisted conversation history for the active session of the specified Discord user.
 * If no active session exists yet, an empty history is returned.
 */
export async function getConversationHistoryForUser(
	db: D1Database,
	discordUserId: string,
): Promise<MessageRow[]> {
	const session = await getActiveSessionByDiscordUserId(db, discordUserId);
	if (!session) {
		return [];
	}
	return listMessagesForSession(db, session.id);
}
