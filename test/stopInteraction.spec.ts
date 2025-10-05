import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/data/messageRepository", () => ({
	insertMessage: vi.fn(),
}));

vi.mock("../src/data/sessionRepository", () => ({
	markSessionAsStopped: vi.fn(),
}));

vi.mock("../src/lib/discord/api", () => ({
	createDiscordMessage: vi.fn(),
}));

import { insertMessage } from "../src/data/messageRepository";
import type { SessionRow } from "../src/data/models";
import { markSessionAsStopped } from "../src/data/sessionRepository";
import { createDiscordMessage } from "../src/lib/discord/api";
import { handleStopCommand } from "../src/lib/discord/interactions/stop";

describe("handleStopCommand", () => {
	const mockedInsertMessage = vi.mocked(insertMessage);
	const mockedMarkSessionAsStopped = vi.mocked(markSessionAsStopped);
	const mockedCreateDiscordMessage = vi.mocked(createDiscordMessage);

	beforeEach(() => {
		vi.restoreAllMocks();
		mockedInsertMessage.mockReset();
		mockedMarkSessionAsStopped.mockReset();
		mockedCreateDiscordMessage.mockReset();
	});

	it("marks the session as stopped, posts a closing message, and records it", async () => {
		const db = {} as D1Database;
		const session: SessionRow = {
			id: "session-1",
			discord_user_id: "user-1",
			discord_channel_id: "channel-1",
			discord_thread_id: "thread-1",
			status: "active",
			started_at: Date.now() - 10_000,
			ended_at: null,
			cadence_minutes: 20,
			next_prompt_due: Date.now() + 20 * 60_000,
			last_prompt_sent_at: null,
			last_user_reply_at: null,
		};

		mockedMarkSessionAsStopped.mockResolvedValue(true);
		mockedCreateDiscordMessage.mockResolvedValue({
			id: "discord-stop-1",
			channel_id: "thread-1",
			content: "",
			timestamp: "2025-10-05T12:05:00.000Z",
		});
		mockedInsertMessage.mockResolvedValue();

		const uuidSpy = vi
			.spyOn(globalThis.crypto, "randomUUID")
			.mockReturnValueOnce("stop-message-uuid");

		const now = new Date("2025-10-05T12:05:00.000Z");
		const result = await handleStopCommand({
			db,
			discordToken: "bot-token",
			session,
			now,
		});

		expect(mockedMarkSessionAsStopped).toHaveBeenCalledWith(db, "session-1", now.getTime());
		expect(mockedCreateDiscordMessage).toHaveBeenCalledWith({
			token: "bot-token",
			channelId: "thread-1",
			content: expect.stringContaining("セッションを終了"),
		});
		expect(mockedInsertMessage).toHaveBeenCalledWith(
			db,
			expect.objectContaining({
				id: "stop-message-uuid",
				session_id: "session-1",
				discord_message_id: "discord-stop-1",
			}),
		);
		expect(result.stopped).toBe(true);
		expect(result.discordMessageId).toBe("discord-stop-1");

		uuidSpy.mockRestore();
	});

	it("returns stopped=false when the session was already closed", async () => {
		mockedMarkSessionAsStopped.mockResolvedValue(false);

		const db = {} as D1Database;
		const result = await handleStopCommand({
			db,
			discordToken: "bot-token",
			session: {
				id: "session-2",
				discord_user_id: "user",
				discord_channel_id: "channel",
				discord_thread_id: null,
				status: "stopped",
				started_at: 0,
				ended_at: null,
				cadence_minutes: 20,
				next_prompt_due: null,
				last_prompt_sent_at: null,
				last_user_reply_at: null,
			},
			now: new Date(),
		});

		expect(result.stopped).toBe(false);
		expect(mockedCreateDiscordMessage).not.toHaveBeenCalled();
		expect(mockedInsertMessage).not.toHaveBeenCalled();
	});
});
