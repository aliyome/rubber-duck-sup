import { insertMessage } from "../../../data/messageRepository";
import type { MessageRow, SessionRow } from "../../../data/models";
import {
	type CreateSessionInput,
	createSession,
	markSessionAsStopped,
	stopOtherActiveSessionsForUser,
} from "../../../data/sessionRepository";
import { type CreateThreadInput, createDiscordMessage, createDiscordThread } from "../api";

const DEFAULT_CADENCE_MINUTES = 20;
const DEFAULT_THREAD_AUTO_ARCHIVE_MINUTES: CreateThreadInput["autoArchiveDuration"] = 1440;

function toTimestamp(date: Date): number {
	return date.getTime();
}

function buildThreadName(
	title: string | undefined,
	userLabel: string | undefined,
	now: Date,
): string {
	const iso = now.toISOString();
	const compact = iso.slice(0, 16).replace(/[-T:]/g, "");
	const prefix = title ?? (userLabel ? userLabel : "session");
	return `${prefix}-progress-${compact}`.slice(0, 96);
}

function buildInitialMessage(cadenceMinutes: number): string {
	const cadenceText =
		cadenceMinutes === DEFAULT_CADENCE_MINUTES ? "約20分ごと" : `約${cadenceMinutes}分ごと`;
	return [
		"進捗セッションを開始しました！",
		`このスレッドで /progress を使って進捗を共有してください。`,
		`${cadenceText} にリマインダーが届きます。`,
		"完了したら /stop でセッションを終了できます。",
	].join("\n");
}

export interface StartCommandContext {
	db: D1Database;
	discordToken: string;
	discordUserId: string;
	baseChannelId: string;
	now: Date;
	title: string;
	cadenceMinutes?: number;
	userDisplayName?: string;
	sessionId?: string;
	threadName?: string;
	autoArchiveDuration?: CreateThreadInput["autoArchiveDuration"];
}

export interface StartCommandResult {
	session: SessionRow;
	threadId: string;
	initialMessage: MessageRow;
	discordMessageId: string;
	nextPromptDue: number;
	endedSessionCount: number;
}

export async function handleStartCommand({
	db,
	discordToken,
	discordUserId,
	baseChannelId,
	now,
	title,
	cadenceMinutes = DEFAULT_CADENCE_MINUTES,
	userDisplayName,
	sessionId,
	threadName,
	autoArchiveDuration = DEFAULT_THREAD_AUTO_ARCHIVE_MINUTES,
}: StartCommandContext): Promise<StartCommandResult> {
	if (cadenceMinutes <= 0) {
		throw new Error("Cadence minutes must be greater than zero");
	}

	const startedAt = toTimestamp(now);
	const id = sessionId ?? crypto.randomUUID();
	const resolvedThreadName = threadName ?? buildThreadName(title, userDisplayName, now);

	let session: SessionRow | null = null;
	let threadId: string | null = null;

	try {
		const thread = await createDiscordThread({
			token: discordToken,
			channelId: baseChannelId,
			name: resolvedThreadName,
			autoArchiveDuration,
			private: true,
		});

		if (!thread.id) {
			throw new Error("Failed to create Discord thread: missing thread id in response");
		}
		threadId = thread.id;

		const nextPromptDue = startedAt + cadenceMinutes * 60_000;
		session = await createSession(db, {
			id,
			discordUserId,
			discordChannelId: baseChannelId,
			discordThreadId: threadId,
			title,
			cadenceMinutes,
			startedAt,
			nextPromptDue,
		} satisfies CreateSessionInput);

		const initialContent = buildInitialMessage(cadenceMinutes);
		const discordMessage = await createDiscordMessage({
			token: discordToken,
			channelId: threadId,
			content: initialContent,
		});

		const createdAtTimestamp = discordMessage.timestamp
			? Date.parse(discordMessage.timestamp)
			: startedAt;
		const createdAt = Number.isFinite(createdAtTimestamp) ? createdAtTimestamp : startedAt;

		const message: MessageRow = {
			id: crypto.randomUUID(),
			session_id: session.id,
			author: "bot",
			discord_message_id: discordMessage.id,
			content: initialContent,
			created_at: createdAt,
		};

		await insertMessage(db, message);

		const endedSessionCount = await stopOtherActiveSessionsForUser(
			db,
			discordUserId,
			startedAt,
			session.id,
		);

		return {
			session,
			threadId,
			initialMessage: message,
			discordMessageId: discordMessage.id,
			nextPromptDue,
			endedSessionCount,
		};
	} catch (error) {
		if (session) {
			try {
				await markSessionAsStopped(db, session.id, startedAt);
			} catch (rollbackError) {
				console.error("interaction.start.rollback_failed", {
					sessionId: session.id,
					rollbackError,
				});
			}
		}
		throw error;
	}
}
