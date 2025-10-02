import { describe, expect, it } from "vitest";
import type { SessionRow } from "../src/data/models";
import { getActiveSessionByDiscordUserId } from "../src/data/sessionRepository";

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
