import type { PromptDueSession, SessionRow } from "./models";

const ACTIVE_STATUS: SessionRow["status"] = "active";
const STOPPED_STATUS: SessionRow["status"] = "stopped";

const SESSION_COLUMNS = [
	"id",
	"discord_user_id",
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
		discord_user_id: String(row.discord_user_id),
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
	const result = await statement.bind(ACTIVE_STATUS).first<Record<string, unknown>>();
	return result ? mapSession(result) : null;
}

export async function getActiveSessionByDiscordUserId(
	db: D1Database,
	discordUserId: string,
): Promise<SessionRow | null> {
	const statement = db.prepare(
		`SELECT ${SESSION_COLUMNS} FROM sessions WHERE status = ? AND discord_user_id = ? ORDER BY started_at DESC LIMIT 1`,
	);
	const result = await statement
		.bind(ACTIVE_STATUS, discordUserId)
		.first<Record<string, unknown>>();
	return result ? mapSession(result) : null;
}

export async function getDueSessions(
	db: D1Database,
	referenceTime: number,
): Promise<PromptDueSession[]> {
	const statement = db.prepare(
		`SELECT ${SESSION_COLUMNS} FROM sessions WHERE status = ? AND next_prompt_due IS NOT NULL AND next_prompt_due <= ? ORDER BY next_prompt_due ASC`,
	);
	const result = await statement.bind(ACTIVE_STATUS, referenceTime).all<Record<string, unknown>>();
	return result.results.map((row) => {
		const session = mapSession(row);
		if (session.next_prompt_due === null) {
			throw new Error("Expected next_prompt_due to be non-null for due session");
		}
		return { ...session, next_prompt_due: session.next_prompt_due } satisfies PromptDueSession;
	});
}

export async function getSessionById(
	db: D1Database,
	sessionId: string,
): Promise<SessionRow | null> {
	const statement = db.prepare(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = ? LIMIT 1`);
	const result = await statement.bind(sessionId).first<Record<string, unknown>>();
	return result ? mapSession(result) : null;
}

interface UpdateResult {
	success: boolean;
	meta?: {
		changes?: number;
	};
}

function ensureUpdate(result: UpdateResult, context: string, sessionId: string): void {
	if (!result.success || (result.meta?.changes ?? 0) === 0) {
		throw new Error(`Failed to update session ${sessionId} during ${context}`);
	}
}

export async function updateSessionAfterPrompt(
	db: D1Database,
	sessionId: string,
	{ lastPromptSentAt, nextPromptDue }: { lastPromptSentAt: number; nextPromptDue: number },
): Promise<void> {
	const statement = db.prepare(
		`UPDATE sessions SET last_prompt_sent_at = ?, next_prompt_due = ? WHERE id = ?`,
	);
	const result = await statement.bind(lastPromptSentAt, nextPromptDue, sessionId).run();
	ensureUpdate(result, "updateSessionAfterPrompt", sessionId);
}

export async function updateSessionAfterUserReply(
	db: D1Database,
	sessionId: string,
	{ lastUserReplyAt, nextPromptDue }: { lastUserReplyAt: number; nextPromptDue: number | null },
): Promise<void> {
	const statement = db.prepare(
		`UPDATE sessions SET last_user_reply_at = ?, next_prompt_due = ? WHERE id = ?`,
	);
	const result = await statement.bind(lastUserReplyAt, nextPromptDue, sessionId).run();
	ensureUpdate(result, "updateSessionAfterUserReply", sessionId);
}

export interface CreateSessionInput {
	id: string;
	discordUserId: string;
	discordChannelId: string;
	cadenceMinutes: number;
	startedAt: number;
	nextPromptDue: number | null;
	discordThreadId?: string | null;
	endedAt?: number | null;
	status?: SessionRow["status"];
	lastPromptSentAt?: number | null;
	lastUserReplyAt?: number | null;
}

export async function createSession(
	db: D1Database,
	{
		id,
		discordUserId,
		discordChannelId,
		discordThreadId,
		cadenceMinutes,
		startedAt,
		nextPromptDue,
		endedAt = null,
		status = ACTIVE_STATUS,
		lastPromptSentAt = null,
		lastUserReplyAt = null,
	}: CreateSessionInput,
): Promise<SessionRow> {
	const statement = db.prepare(
		`INSERT INTO sessions (id, discord_user_id, discord_channel_id, discord_thread_id, status, started_at, ended_at, cadence_minutes, next_prompt_due, last_prompt_sent_at, last_user_reply_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	);
	const result = await statement
		.bind(
			id,
			discordUserId,
			discordChannelId,
			discordThreadId ?? null,
			status,
			startedAt,
			endedAt,
			cadenceMinutes,
			nextPromptDue,
			lastPromptSentAt,
			lastUserReplyAt,
		)
		.run();

	if (!result.success) {
		throw new Error(`Failed to create session ${id}`);
	}

	return {
		id,
		discord_user_id: discordUserId,
		discord_channel_id: discordChannelId,
		discord_thread_id: discordThreadId ?? null,
		status,
		started_at: startedAt,
		ended_at: endedAt,
		cadence_minutes: cadenceMinutes,
		next_prompt_due: nextPromptDue,
		last_prompt_sent_at: lastPromptSentAt,
		last_user_reply_at: lastUserReplyAt,
	};
}

export async function updateSessionThreadId(
	db: D1Database,
	sessionId: string,
	threadId: string,
): Promise<void> {
	const statement = db.prepare(`UPDATE sessions SET discord_thread_id = ? WHERE id = ?`);
	const result = await statement.bind(threadId, sessionId).run();
	ensureUpdate(result, "updateSessionThreadId", sessionId);
}

export async function markSessionAsStopped(
	db: D1Database,
	sessionId: string,
	endedAt: number,
): Promise<boolean> {
	const statement = db.prepare(
		`UPDATE sessions SET status = ?, ended_at = ?, next_prompt_due = NULL WHERE id = ? AND status = ?`,
	);
	const result = await statement.bind(STOPPED_STATUS, endedAt, sessionId, ACTIVE_STATUS).run();
	return (result.meta?.changes ?? 0) > 0;
}

export async function stopOtherActiveSessionsForUser(
	db: D1Database,
	discordUserId: string,
	endedAt: number,
	excludeSessionId: string,
): Promise<number> {
	const statement = db.prepare(
		`UPDATE sessions SET status = ?, ended_at = ?, next_prompt_due = NULL WHERE status = ? AND discord_user_id = ? AND id != ?`,
	);
	const result = await statement
		.bind(STOPPED_STATUS, endedAt, ACTIVE_STATUS, discordUserId, excludeSessionId)
		.run();
	return result.meta?.changes ?? 0;
}
