import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/data/sessionRepository", () => ({
	createSession: vi.fn(),
	markSessionAsStopped: vi.fn(),
	stopOtherActiveSessionsForUser: vi.fn(),
}));

vi.mock("../src/data/messageRepository", () => ({
	insertMessage: vi.fn(),
}));

vi.mock("../src/lib/discord/api", () => ({
	createDiscordMessage: vi.fn(),
	createDiscordThread: vi.fn(),
}));

import { insertMessage } from "../src/data/messageRepository";
import type { SessionRow } from "../src/data/models";
import {
	createSession,
	markSessionAsStopped,
	stopOtherActiveSessionsForUser,
} from "../src/data/sessionRepository";
import { createDiscordMessage, createDiscordThread } from "../src/lib/discord/api";
import { handleStartCommand } from "../src/lib/discord/interactions/start";

describe("handleStartCommand", () => {
	const mockedCreateSession = vi.mocked(createSession);
	const mockedMarkSessionAsStopped = vi.mocked(markSessionAsStopped);
	const mockedStopOtherSessions = vi.mocked(stopOtherActiveSessionsForUser);
	const mockedInsertMessage = vi.mocked(insertMessage);
	const mockedCreateDiscordThread = vi.mocked(createDiscordThread);
	const mockedCreateDiscordMessage = vi.mocked(createDiscordMessage);

	beforeEach(() => {
		vi.restoreAllMocks();
		mockedCreateSession.mockReset();
		mockedMarkSessionAsStopped.mockReset();
		mockedStopOtherSessions.mockReset();
		mockedInsertMessage.mockReset();
		mockedCreateDiscordThread.mockReset();
		mockedCreateDiscordMessage.mockReset();
	});

	it("stops existing sessions, creates a new thread, persists the session, and posts the initial message", async () => {
		const db = {} as D1Database;
		const now = new Date("2025-10-05T12:00:00.000Z");
		const startedAt = now.getTime();
		const cadenceMinutes = 15;
		const nextPromptDue = startedAt + cadenceMinutes * 60_000;

		mockedStopOtherSessions.mockResolvedValue(1);

		mockedCreateDiscordThread.mockResolvedValue({
			id: "thread-xyz",
			name: "thread-name",
		});

		mockedCreateSession.mockImplementation(async (_db, input) => {
			return {
				id: input.id,
				discord_user_id: input.discordUserId,
				discord_channel_id: input.discordChannelId,
				discord_thread_id: input.discordThreadId ?? null,
				status: input.status ?? "active",
				started_at: input.startedAt,
				ended_at: input.endedAt ?? null,
				cadence_minutes: input.cadenceMinutes,
				next_prompt_due: input.nextPromptDue,
				last_prompt_sent_at: input.lastPromptSentAt ?? null,
				last_user_reply_at: input.lastUserReplyAt ?? null,
			} satisfies SessionRow;
		});

		mockedCreateDiscordMessage.mockResolvedValue({
			id: "discord-message-1",
			channel_id: "thread-xyz",
			content: "",
			timestamp: now.toISOString(),
		});

		mockedInsertMessage.mockResolvedValue();

		const uuidSpy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValueOnce("message-id-1");

		const result = await handleStartCommand({
			db,
			discordToken: "bot-token",
			discordUserId: "user-123",
			baseChannelId: "channel-456",
			now,
			cadenceMinutes,
			userDisplayName: "alice",
			sessionId: "session-abc",
		});

		expect(mockedStopOtherSessions).toHaveBeenCalledWith(db, "user-123", startedAt, "session-abc");

		expect(mockedCreateDiscordThread).toHaveBeenCalledWith({
			token: "bot-token",
			channelId: "channel-456",
			name: expect.stringContaining("alice"),
			autoArchiveDuration: 1440,
			private: true,
		});

		expect(mockedCreateSession).toHaveBeenCalledWith(
			db,
			expect.objectContaining({
				id: "session-abc",
				discordUserId: "user-123",
				discordChannelId: "channel-456",
				discordThreadId: "thread-xyz",
				cadenceMinutes,
				startedAt,
				nextPromptDue,
			}),
		);

		expect(mockedCreateDiscordMessage).toHaveBeenCalledWith({
			token: "bot-token",
			channelId: "thread-xyz",
			content: expect.stringContaining("/progress"),
		});

		expect(mockedInsertMessage).toHaveBeenCalledWith(
			db,
			expect.objectContaining({
				session_id: "session-abc",
				author: "bot",
				discord_message_id: "discord-message-1",
			}),
		);

		expect(result.threadId).toBe("thread-xyz");
		expect(result.session.cadence_minutes).toBe(cadenceMinutes);
		expect(result.nextPromptDue).toBe(nextPromptDue);
		expect(result.endedSessionCount).toBe(1);
		expect(result.initialMessage.discord_message_id).toBe("discord-message-1");

		uuidSpy.mockRestore();
	});

	it("throws when the Discord API does not return a thread id", async () => {
		mockedStopOtherSessions.mockResolvedValue(0);
		mockedCreateDiscordThread.mockResolvedValue({ name: "broken" });

		await expect(
			handleStartCommand({
				db: {} as D1Database,
				discordToken: "t",
				discordUserId: "u",
				baseChannelId: "c",
				now: new Date(),
			}),
		).rejects.toThrow("Failed to create Discord thread");
	});

	it("stops the new session if a downstream step fails", async () => {
		const db = {} as D1Database;
		const now = new Date("2025-10-05T12:00:00.000Z");
		const startedAt = now.getTime();

		mockedStopOtherSessions.mockResolvedValue(0);
		mockedCreateDiscordThread.mockResolvedValue({ id: "thread-xyz" });
		mockedCreateSession.mockImplementation(async (_db, input) => {
			return {
				id: input.id,
				discord_user_id: input.discordUserId,
				discord_channel_id: input.discordChannelId,
				discord_thread_id: input.discordThreadId ?? null,
				status: "active",
				started_at: input.startedAt,
				ended_at: null,
				cadence_minutes: input.cadenceMinutes,
				next_prompt_due: input.nextPromptDue,
				last_prompt_sent_at: null,
				last_user_reply_at: null,
			} satisfies SessionRow;
		});
		mockedCreateDiscordMessage.mockRejectedValue(new Error("discord error"));
		mockedMarkSessionAsStopped.mockResolvedValue(true);

		await expect(
			handleStartCommand({
				db,
				discordToken: "bot-token",
				discordUserId: "user-1",
				baseChannelId: "channel-1",
				now,
			}),
		).rejects.toThrow("discord error");

		expect(mockedMarkSessionAsStopped).toHaveBeenCalledWith(db, expect.any(String), startedAt);
		expect(mockedStopOtherSessions).not.toHaveBeenCalled();
	});
});
