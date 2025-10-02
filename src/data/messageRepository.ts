import type { MessageRow } from "./models";

const MESSAGE_COLUMNS = [
	"id",
	"session_id",
	"author",
	"discord_message_id",
	"content",
	"created_at",
].join(", ");

function mapMessage(row: Record<string, unknown>): MessageRow {
	return {
		id: String(row.id),
		session_id: String(row.session_id),
		author: row.author as MessageRow["author"],
		discord_message_id: row.discord_message_id === null ? null : String(row.discord_message_id),
		content: String(row.content ?? ""),
		created_at: Number(row.created_at),
	};
}

export async function listMessagesForSession(
	db: D1Database,
	sessionId: string,
): Promise<MessageRow[]> {
	const statement = db.prepare(
		`SELECT ${MESSAGE_COLUMNS} FROM messages WHERE session_id = ? ORDER BY created_at ASC`,
	);
	const result = await statement.bind(sessionId).all<Record<string, unknown>>();
	return result.results.map(mapMessage);
}

export async function insertMessage(db: D1Database, message: MessageRow): Promise<void> {
	const statement = db.prepare(
		`INSERT INTO messages (id, session_id, author, discord_message_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
	);
	await statement
		.bind(
			message.id,
			message.session_id,
			message.author,
			message.discord_message_id,
			message.content,
			message.created_at,
		)
		.run();
}
