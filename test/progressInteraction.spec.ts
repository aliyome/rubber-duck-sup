import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/data/messageRepository", () => ({
	insertMessage: vi.fn(),
}));

vi.mock("../src/data/sessionRepository", () => ({
	updateSessionAfterUserReply: vi.fn(),
}));

import { insertMessage } from "../src/data/messageRepository";
import type { SessionRow } from "../src/data/models";
import { updateSessionAfterUserReply } from "../src/data/sessionRepository";
import { handleProgressCommand } from "../src/lib/discord/interactions/progress";

describe("handleProgressCommand", () => {
	const mockedInsertMessage = vi.mocked(insertMessage);
	const mockedUpdateSession = vi.mocked(updateSessionAfterUserReply);

	beforeEach(() => {
		vi.restoreAllMocks();
		mockedInsertMessage.mockReset();
		mockedUpdateSession.mockReset();
	});

	it("persists the user update and updates the session schedule", async () => {
		const session: SessionRow = {
			id: "session-1",
			discord_user_id: "user-1",
			discord_channel_id: "channel-1",
			discord_thread_id: "thread-1",
			status: "active",
			started_at: Date.UTC(2025, 8, 30, 9, 0, 0),
			ended_at: null,
			cadence_minutes: 20,
			next_prompt_due: Date.UTC(2025, 9, 2, 9, 40, 0),
			last_prompt_sent_at: Date.UTC(2025, 9, 2, 9, 20, 0),
			last_user_reply_at: null,
		};

		const now = new Date("2025-10-02T10:00:00.000Z");

		const uuidSpy = vi
			.spyOn(globalThis.crypto, "randomUUID")
			.mockReturnValueOnce("user-message-uuid");

		const db = {} as D1Database;

		const result = await handleProgressCommand({
			db,
			session,
			progressText: "署名検証が完了したのでAI連携に着手しました",
			now,
		});

		expect(mockedInsertMessage).toHaveBeenCalledWith(db, {
			id: "user-message-uuid",
			session_id: session.id,
			author: "user",
			discord_message_id: null,
			content: "署名検証が完了したのでAI連携に着手しました",
			created_at: now.getTime(),
		});

		expect(mockedUpdateSession).toHaveBeenCalledWith(db, session.id, {
			lastUserReplyAt: now.getTime(),
			nextPromptDue: now.getTime() + session.cadence_minutes * 60_000,
		});

		expect(result).toEqual({
			userMessage: expect.objectContaining({ id: "user-message-uuid" }),
			nextPromptDue: now.getTime() + session.cadence_minutes * 60_000,
		});

		uuidSpy.mockRestore();
	});
});
