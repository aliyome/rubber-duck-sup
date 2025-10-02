import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/data/sessionRepository", () => ({
	getActiveSessionByDiscordUserId: vi.fn(),
}));

vi.mock("../src/data/messageRepository", () => ({
	insertMessage: vi.fn(),
	listMessagesForSession: vi.fn(),
}));

import {
	getConversationHistoryForUser,
	saveConversationMessage,
} from "../src/data/conversationRepository";
import { insertMessage, listMessagesForSession } from "../src/data/messageRepository";
import type { MessageRow, SessionRow } from "../src/data/models";
import { getActiveSessionByDiscordUserId } from "../src/data/sessionRepository";

const mockedGetActiveSession = vi.mocked(getActiveSessionByDiscordUserId);
const mockedInsertMessage = vi.mocked(insertMessage);
const mockedListMessages = vi.mocked(listMessagesForSession);

function createSession(overrides: Partial<SessionRow> = {}): SessionRow {
	return {
		id: "session-id",
		discord_user_id: "user-id",
		discord_channel_id: "channel-id",
		discord_thread_id: "thread-id",
		status: "active",
		started_at: 1,
		ended_at: null,
		cadence_minutes: 20,
		next_prompt_due: 2,
		last_prompt_sent_at: null,
		last_user_reply_at: null,
		...overrides,
	};
}

beforeEach(() => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	mockedGetActiveSession.mockReset();
	mockedInsertMessage.mockReset();
	mockedListMessages.mockReset();
});

describe("saveConversationMessage", () => {
	it("persists a message for the active session", async () => {
		const db = {} as D1Database;
		const now = new Date("2025-10-02T12:00:00Z");
		vi.useFakeTimers();
		vi.setSystemTime(now);
		const randomUuidSpy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue("generated-id");

		const session = createSession();
		mockedGetActiveSession.mockResolvedValue(session);
		mockedInsertMessage.mockResolvedValue();

		const saved = await saveConversationMessage({
			db,
			discordUserId: session.discord_user_id,
			author: "user",
			content: "Working on persistence layer",
		});

		expect(randomUuidSpy).toHaveBeenCalledTimes(1);
		expect(saved).toEqual<MessageRow>({
			id: "generated-id",
			session_id: session.id,
			author: "user",
			discord_message_id: null,
			content: "Working on persistence layer",
			created_at: now.getTime(),
		});
		expect(mockedInsertMessage).toHaveBeenCalledWith(db, saved);

		vi.useRealTimers();
	});

	it("allows overriding identifiers and timestamps", async () => {
		const db = {} as D1Database;
		const session = createSession();
		mockedGetActiveSession.mockResolvedValue(session);

		const customMessage = await saveConversationMessage({
			db,
			discordUserId: session.discord_user_id,
			author: "bot",
			content: "Nice progress!",
			discordMessageId: "discord-123",
			createdAt: 1730470800000,
			id: "message-456",
		});

		expect(mockedInsertMessage).toHaveBeenCalledWith(db, customMessage);
		expect(customMessage).toEqual<MessageRow>({
			id: "message-456",
			session_id: session.id,
			author: "bot",
			discord_message_id: "discord-123",
			content: "Nice progress!",
			created_at: 1730470800000,
		});
	});

	it("throws when no active session is available", async () => {
		mockedGetActiveSession.mockResolvedValue(null);

		await expect(
			saveConversationMessage({
				db: {} as D1Database,
				discordUserId: "missing-user",
				author: "user",
				content: "Hello",
			}),
		).rejects.toThrowError("Active session not found for Discord user missing-user");
		expect(mockedInsertMessage).not.toHaveBeenCalled();
	});
});

describe("getConversationHistoryForUser", () => {
	it("returns an empty list when there is no active session", async () => {
		mockedGetActiveSession.mockResolvedValue(null);
		const db = {} as D1Database;
		const history = await getConversationHistoryForUser(db, "user-id");
		expect(history).toEqual([]);
		expect(mockedListMessages).not.toHaveBeenCalled();
	});

	it("returns persisted messages for the active session", async () => {
		const session = createSession();
		mockedGetActiveSession.mockResolvedValue(session);
		const messages: MessageRow[] = [
			{
				id: "m1",
				session_id: session.id,
				author: "user",
				discord_message_id: null,
				content: "Progress report",
				created_at: 1,
			},
		];
		mockedListMessages.mockResolvedValue(messages);

		const db = {} as D1Database;
		const history = await getConversationHistoryForUser(db, session.discord_user_id);
		expect(history).toBe(messages);
		expect(mockedListMessages).toHaveBeenCalledWith(db, session.id);
	});
});
