import type { PromptDueSession, SessionRow } from "./models";

const SESSION_COLUMNS = [
	"id",
	"discord_channel_id",
	"discord_thread_id",
	"status",
	"started_at",
	"ended_at",
	"cadence_minutes",
	"next_prompt_due",
	"last_prompt_sent_at",
	"last_user_reply_at",
].join(", ");

function mapSession(row: Record<string, unknown>): SessionRow {
	return {
		id: String(row.id),
		discord_channel_id: String(row.discord_channel_id),
		discord_thread_id: row.discord_thread_id === null ? null : String(row.discord_thread_id),
		status: row.status as SessionRow["status"],
		started_at: Number(row.started_at),
		ended_at: row.ended_at === null ? null : Number(row.ended_at),
		cadence_minutes: Number(row.cadence_minutes),
		next_prompt_due: row.next_prompt_due === null ? null : Number(row.next_prompt_due),
		last_prompt_sent_at: row.last_prompt_sent_at === null ? null : Number(row.last_prompt_sent_at),
		last_user_reply_at: row.last_user_reply_at === null ? null : Number(row.last_user_reply_at),
	};
}

export async function getActiveSession(db: D1Database): Promise<SessionRow | null> {
	const statement = db.prepare(
		`SELECT ${SESSION_COLUMNS} FROM sessions WHERE status = ? ORDER BY started_at DESC LIMIT 1`,
	);
	const result = await statement.bind("active").first<Record<string, unknown>>();
	return result ? mapSession(result) : null;
}

export async function getDueSessions(
	db: D1Database,
	referenceTime: number,
): Promise<PromptDueSession[]> {
	const statement = db.prepare(
		`SELECT ${SESSION_COLUMNS} FROM sessions WHERE status = ? AND next_prompt_due IS NOT NULL AND next_prompt_due <= ? ORDER BY next_prompt_due ASC`,
	);
	const result = await statement.bind("active", referenceTime).all<Record<string, unknown>>();
	return result.results.map((row) => {
		const session = mapSession(row);
		if (session.next_prompt_due === null) {
			throw new Error("Expected next_prompt_due to be non-null for due session");
		}
		return { ...session, next_prompt_due: session.next_prompt_due } satisfies PromptDueSession;
	});
}
