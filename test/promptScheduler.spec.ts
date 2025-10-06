import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/data/sessionRepository", () => ({
	getDueSessions: vi.fn(),
	updateSessionAfterPrompt: vi.fn(),
}));

vi.mock("../src/data/messageRepository", () => ({
	listMessagesForSession: vi.fn(),
	insertMessage: vi.fn(),
}));

vi.mock("../src/lib/ai/progressPrompt", () => ({
	generateProgressPrompt: vi.fn(),
}));

vi.mock("../src/lib/discord/api", () => ({
	createDiscordMessage: vi.fn(),
}));

import { insertMessage, listMessagesForSession } from "../src/data/messageRepository";
import type { PromptDueSession } from "../src/data/models";
import { getDueSessions, updateSessionAfterPrompt } from "../src/data/sessionRepository";
import { processPromptSchedulerTick } from "../src/jobs/promptScheduler";
import type { WorkersAiBinding } from "../src/lib/ai/progressPrompt";
import { generateProgressPrompt } from "../src/lib/ai/progressPrompt";
import { createDiscordMessage } from "../src/lib/discord/api";

describe("processPromptSchedulerTick", () => {
	const mockedGetDueSessions = vi.mocked(getDueSessions);
	const mockedUpdateSession = vi.mocked(updateSessionAfterPrompt);
	const mockedListMessages = vi.mocked(listMessagesForSession);
	const mockedInsertMessage = vi.mocked(insertMessage);
	const mockedGeneratePrompt = vi.mocked(generateProgressPrompt);
	const mockedCreateDiscordMessage = vi.mocked(createDiscordMessage);

	beforeEach(() => {
		vi.restoreAllMocks();
		mockedGetDueSessions.mockReset();
		mockedUpdateSession.mockReset();
		mockedListMessages.mockReset();
		mockedInsertMessage.mockReset();
		mockedGeneratePrompt.mockReset();
		mockedCreateDiscordMessage.mockReset();
	});

	it("sends prompts for due sessions and updates state", async () => {
		const scheduled = new Date("2025-10-02T10:00:00.000Z");
		const dueSession: PromptDueSession = {
			id: "session-1",
			discord_user_id: "user-1",
			discord_channel_id: "channel-1",
			discord_thread_id: "thread-99",
			status: "active",
			started_at: Date.UTC(2025, 8, 30, 9, 0, 0),
			ended_at: null,
			cadence_minutes: 20,
			next_prompt_due: scheduled.getTime(),
			last_prompt_sent_at: Date.UTC(2025, 9, 2, 9, 20, 0),
			last_user_reply_at: Date.UTC(2025, 9, 2, 9, 35, 0),
		};
		mockedGetDueSessions.mockResolvedValue([dueSession]);
		mockedListMessages.mockResolvedValue([
			{
				id: "msg-1",
				session_id: dueSession.id,
				author: "user",
				discord_message_id: null,
				content: "AI連携を進めています",
				created_at: Date.UTC(2025, 9, 2, 9, 35, 0),
			},
		]);
		mockedGeneratePrompt.mockResolvedValue({
			prompt: "昨日のAI連携の進捗はどうですか？",
			usage: { prompt_tokens: 200, completion_tokens: 40, total_tokens: 240 },
		});
		mockedCreateDiscordMessage.mockResolvedValue({
			id: "discord-456",
			content: "<@user-1> 昨日のAI連携の進捗はどうですか？",
			timestamp: "2025-10-02T10:00:05.000Z",
		});

		const uuidSpy = vi
			.spyOn(globalThis.crypto, "randomUUID")
			.mockReturnValue("prompt-message-uuid");

		const db = {} as D1Database;
		const aiBinding = { run: vi.fn() } as unknown as WorkersAiBinding;

		await processPromptSchedulerTick({
			db,
			discordToken: "bot-token",
			discordApplicationId: "app-1",
			scheduled,
			ai: aiBinding,
		});

		expect(mockedGetDueSessions).toHaveBeenCalledWith(db, scheduled.getTime());
		expect(mockedListMessages).toHaveBeenCalledWith(db, dueSession.id);
		expect(mockedGeneratePrompt).toHaveBeenCalledWith({
			ai: aiBinding,
			history: expect.any(Array),
			now: scheduled,
			cadenceMinutes: dueSession.cadence_minutes,
		});
		expect(mockedCreateDiscordMessage).toHaveBeenCalledWith({
			token: "bot-token",
			channelId: "thread-99",
			content: "<@user-1> 昨日のAI連携の進捗はどうですか？",
		});
		expect(mockedInsertMessage).toHaveBeenCalledWith(db, {
			id: "prompt-message-uuid",
			session_id: dueSession.id,
			author: "bot",
			discord_message_id: "discord-456",
			content: "昨日のAI連携の進捗はどうですか？",
			created_at: Date.parse("2025-10-02T10:00:05.000Z"),
		});
		expect(mockedUpdateSession).toHaveBeenCalledWith(db, dueSession.id, {
			lastPromptSentAt: Date.parse("2025-10-02T10:00:05.000Z"),
			nextPromptDue: Date.parse("2025-10-02T10:00:05.000Z") + dueSession.cadence_minutes * 60_000,
		});

		uuidSpy.mockRestore();
	});

	it("exits early when no sessions are due", async () => {
		mockedGetDueSessions.mockResolvedValue([]);

		await processPromptSchedulerTick({
			db: {} as D1Database,
			discordToken: "bot-token",
			discordApplicationId: "app-1",
			scheduled: new Date("2025-10-02T11:00:00.000Z"),
			ai: { run: vi.fn() } as unknown as WorkersAiBinding,
		});

		expect(mockedListMessages).not.toHaveBeenCalled();
		expect(mockedGeneratePrompt).not.toHaveBeenCalled();
		expect(mockedCreateDiscordMessage).not.toHaveBeenCalled();
		expect(mockedInsertMessage).not.toHaveBeenCalled();
		expect(mockedUpdateSession).not.toHaveBeenCalled();
	});
});
