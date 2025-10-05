import { describe, expect, it } from "vitest";
import type { SessionRow } from "../src/data/models";
import {
	createSession,
	getActiveSessionByDiscordUserId,
	markSessionAsStopped,
	stopOtherActiveSessionsForUser,
	updateSessionThreadId,
} from "../src/data/sessionRepository";

function createStubDatabase(row: Record<string, unknown> | null) {
	const captured: { sql: string | null; params: unknown[] } = {
		sql: null,
		params: [],
	};

	const db = {
		prepare(sql: string) {
			captured.sql = sql;
			return {
				bind(...params: unknown[]) {
					captured.params = params;
					return {
						async first<T>() {
							return row as T | null;
						},
					};
				},
			};
		},
	} as unknown as D1Database;

	return { db, captured };
}

function createRunStub(runResult: { success: boolean; meta?: { changes?: number } }) {
	const captured: { sql: string | null; params: unknown[] } = {
		sql: null,
		params: [],
	};

	const db = {
		prepare(sql: string) {
			captured.sql = sql;
			return {
				bind(...params: unknown[]) {
					captured.params = params;
					return {
						async run() {
							return runResult;
						},
					};
				},
			};
		},
	} as unknown as D1Database;

	return { db, captured };
}

describe("getActiveSessionByDiscordUserId", () => {
	it("returns the latest active session for the Discord user", async () => {
		const now = Date.now();
		const row = {
			id: "session-123",
			discord_user_id: "user-456",
			discord_channel_id: "channel-789",
			discord_thread_id: "thread-000",
			status: "active",
			started_at: now,
			ended_at: null,
			cadence_minutes: 20,
			next_prompt_due: now + 1,
			last_prompt_sent_at: null,
			last_user_reply_at: null,
		} satisfies Record<string, unknown>;
		const { db, captured } = createStubDatabase(row);

		const result = await getActiveSessionByDiscordUserId(db, "user-456");

		expect(result).toEqual<SessionRow>({
			id: "session-123",
			discord_user_id: "user-456",
			discord_channel_id: "channel-789",
			discord_thread_id: "thread-000",
			status: "active",
			started_at: now,
			ended_at: null,
			cadence_minutes: 20,
			next_prompt_due: now + 1,
			last_prompt_sent_at: null,
			last_user_reply_at: null,
		});
		expect(captured.sql).toContain("discord_user_id");
		expect(captured.params).toEqual(["active", "user-456"]);
	});

	it("returns null when no active session exists", async () => {
		const { db } = createStubDatabase(null);
		const result = await getActiveSessionByDiscordUserId(db, "user-456");
		expect(result).toBeNull();
	});
});

describe("createSession", () => {
	it("inserts the session and returns the normalized row", async () => {
		const { db, captured } = createRunStub({ success: true, meta: { changes: 1 } });
		const startedAt = Date.UTC(2025, 9, 5, 12, 0, 0);
		const nextPromptDue = startedAt + 20 * 60_000;
		const result = await createSession(db, {
			id: "session-1",
			discordUserId: "user-1",
			discordChannelId: "channel-1",
			discordThreadId: "thread-1",
			cadenceMinutes: 20,
			startedAt,
			nextPromptDue,
		});

		expect(captured.sql).toMatch(/INSERT INTO sessions/);
		expect(captured.params).toEqual([
			"session-1",
			"user-1",
			"channel-1",
			"thread-1",
			"active",
			startedAt,
			null,
			20,
			nextPromptDue,
			null,
			null,
		]);
		expect(result).toEqual<SessionRow>({
			id: "session-1",
			discord_user_id: "user-1",
			discord_channel_id: "channel-1",
			discord_thread_id: "thread-1",
			status: "active",
			started_at: startedAt,
			ended_at: null,
			cadence_minutes: 20,
			next_prompt_due: nextPromptDue,
			last_prompt_sent_at: null,
			last_user_reply_at: null,
		});
	});
});

describe("updateSessionThreadId", () => {
	it("updates the thread id when the update succeeds", async () => {
		const { db, captured } = createRunStub({ success: true, meta: { changes: 1 } });
		await updateSessionThreadId(db, "session-1", "thread-99");
		expect(captured.sql).toContain("SET discord_thread_id = ?");
		expect(captured.params).toEqual(["thread-99", "session-1"]);
	});

	it("throws when no rows are updated", async () => {
		const { db } = createRunStub({ success: true, meta: { changes: 0 } });
		await expect(updateSessionThreadId(db, "session-1", "thread-x")).rejects.toThrow(
			/Failed to update session/,
		);
	});
});

describe("markSessionAsStopped", () => {
	it("returns true when the session is updated", async () => {
		const { db, captured } = createRunStub({ success: true, meta: { changes: 1 } });
		const now = Date.now();
		const result = await markSessionAsStopped(db, "session-1", now);
		expect(result).toBe(true);
		expect(captured.params).toEqual(["stopped", now, "session-1", "active"]);
	});

	it("returns false when no session is updated", async () => {
		const { db } = createRunStub({ success: true, meta: { changes: 0 } });
		const result = await markSessionAsStopped(db, "session-unknown", Date.now());
		expect(result).toBe(false);
	});
});

describe("stopOtherActiveSessionsForUser", () => {
	it("stops all other active sessions for the user", async () => {
		const { db, captured } = createRunStub({ success: true, meta: { changes: 1 } });
		const endedAt = 1700000000000;
		const updated = await stopOtherActiveSessionsForUser(db, "user-1", endedAt, "session-keep");
		expect(updated).toBe(1);
		expect(captured.sql).toMatch(/id != \?/);
		expect(captured.params).toEqual(["stopped", endedAt, "active", "user-1", "session-keep"]);
	});
});
