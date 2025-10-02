import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/data/messageRepository", () => ({
	insertMessage: vi.fn(),
	listMessagesForSession: vi.fn(),
}));

vi.mock("../src/data/sessionRepository", () => ({
	updateSessionAfterUserReply: vi.fn(),
}));

vi.mock("../src/lib/ai/progressFeedback", () => ({
	generateProgressFeedback: vi.fn(),
}));

vi.mock("../src/lib/discord/api", () => ({
	createDiscordMessage: vi.fn(),
}));

import { insertMessage, listMessagesForSession } from "../src/data/messageRepository";
import type { SessionRow } from "../src/data/models";
import { updateSessionAfterUserReply } from "../src/data/sessionRepository";
import { generateProgressFeedback } from "../src/lib/ai/progressFeedback";
import type { WorkersAiBinding } from "../src/lib/ai/progressPrompt";
import { createDiscordMessage } from "../src/lib/discord/api";
import { handleProgressCommand } from "../src/lib/discord/interactions/progress";

describe("handleProgressCommand", () => {
	const mockedListMessages = vi.mocked(listMessagesForSession);
	const mockedInsertMessage = vi.mocked(insertMessage);
	const mockedUpdateSession = vi.mocked(updateSessionAfterUserReply);
	const mockedGenerateFeedback = vi.mocked(generateProgressFeedback);
	const mockedCreateDiscordMessage = vi.mocked(createDiscordMessage);

	beforeEach(() => {
		vi.restoreAllMocks();
		mockedListMessages.mockReset();
		mockedInsertMessage.mockReset();
		mockedUpdateSession.mockReset();
		mockedGenerateFeedback.mockReset();
		mockedCreateDiscordMessage.mockReset();
	});

	it("persists the user update, generates feedback, posts to Discord, and updates the session schedule", async () => {
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
		const history = [
			{
				id: "message-0",
				session_id: session.id,
				author: "bot" as const,
				discord_message_id: "discord-old",
				content: "進捗どうですか？",
				created_at: Date.UTC(2025, 9, 2, 9, 20, 0),
			},
		];
		mockedListMessages.mockResolvedValue(history);

		const feedbackMessage =
			"昨日の署名検証を終えて順調ですね！次のAI統合の進み具合を教えてください。";
		mockedGenerateFeedback.mockResolvedValue({
			message: feedbackMessage,
			usage: { prompt_tokens: 120, completion_tokens: 64, total_tokens: 184 },
			model: "@cf/meta/llama-3.1-8b-instruct",
		});

		mockedCreateDiscordMessage.mockResolvedValue({
			id: "discord-123",
			channel_id: session.discord_thread_id,
			content: feedbackMessage,
			timestamp: "2025-10-02T10:00:02.000Z",
		});

		const uuidSpy = vi
			.spyOn(globalThis.crypto, "randomUUID")
			.mockReturnValueOnce("user-message-uuid")
			.mockReturnValueOnce("bot-message-uuid");

		const db = {} as D1Database;
		const aiBinding = { run: vi.fn() } as unknown as WorkersAiBinding;

		const result = await handleProgressCommand({
			db,
			ai: aiBinding,
			discordToken: "bot-token",
			session,
			progressText: "署名検証が完了したのでAI連携に着手しました",
			now,
		});

		expect(mockedListMessages).toHaveBeenCalledWith(db, session.id);

		expect(mockedInsertMessage).toHaveBeenNthCalledWith(1, db, {
			id: "user-message-uuid",
			session_id: session.id,
			author: "user",
			discord_message_id: null,
			content: "署名検証が完了したのでAI連携に着手しました",
			created_at: now.getTime(),
		});

		expect(mockedGenerateFeedback).toHaveBeenCalledWith({
			ai: aiBinding,
			history: expect.arrayContaining([
				expect.objectContaining({ id: "user-message-uuid", author: "user" }),
			]),
			now,
			userUpdate: "署名検証が完了したのでAI連携に着手しました",
		});

		expect(mockedCreateDiscordMessage).toHaveBeenCalledWith({
			token: "bot-token",
			channelId: "thread-1",
			content: feedbackMessage,
		});

		expect(mockedInsertMessage).toHaveBeenNthCalledWith(2, db, {
			id: "bot-message-uuid",
			session_id: session.id,
			author: "bot",
			discord_message_id: "discord-123",
			content: feedbackMessage,
			created_at: Date.parse("2025-10-02T10:00:02.000Z"),
		});

		expect(mockedUpdateSession).toHaveBeenCalledWith(db, session.id, {
			lastUserReplyAt: now.getTime(),
			nextPromptDue: now.getTime() + session.cadence_minutes * 60_000,
		});

		expect(result).toEqual({
			userMessage: expect.objectContaining({ id: "user-message-uuid" }),
			botMessage: expect.objectContaining({
				id: "bot-message-uuid",
				discord_message_id: "discord-123",
			}),
			discordMessageId: "discord-123",
			nextPromptDue: now.getTime() + session.cadence_minutes * 60_000,
			model: "@cf/meta/llama-3.1-8b-instruct",
		});

		uuidSpy.mockRestore();
	});
});
