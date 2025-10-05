const DISCORD_API_BASE = "https://discord.com/api/v10";

export interface CreateMessageInput {
	token: string;
	channelId: string;
	content: string;
	mentionEveryone?: boolean;
}

export interface DiscordMessageResponse {
	id: string;
	channel_id: string;
	content: string;
	timestamp?: string;
	thread?: unknown;
	[key: string]: unknown;
}

export class DiscordApiError extends Error {
	readonly status: number;
	readonly responseBody: unknown;

	constructor(message: string, status: number, responseBody: unknown) {
		super(message);
		this.name = "DiscordApiError";
		this.status = status;
		this.responseBody = responseBody;
	}
}

export async function createDiscordMessage({
	token,
	channelId,
	content,
	mentionEveryone = false,
}: CreateMessageInput): Promise<DiscordMessageResponse> {
	const allowedMentions = mentionEveryone
		? undefined
		: {
				parse: [] as string[],
			};

	const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/messages`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bot ${token}`,
		},
		body: JSON.stringify({
			content,
			allowed_mentions: allowedMentions,
		}),
	});

	if (!response.ok) {
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			body = await response.text();
		}
		throw new DiscordApiError(
			`Failed to create Discord message (status ${response.status})`,
			response.status,
			body,
		);
	}

	return (await response.json()) as DiscordMessageResponse;
}

export interface CreateThreadInput {
	token: string;
	channelId: string;
	name: string;
	autoArchiveDuration?: 60 | 1440 | 4320 | 10080;
	private?: boolean;
	reason?: string;
}

export interface DiscordThreadResponse {
	id: string;
	name?: string;
	parent_id?: string;
	type?: number;
	thread_metadata?: {
		auto_archive_duration?: number;
		archived?: boolean;
		locked?: boolean;
		invitable?: boolean;
		create_timestamp?: string | null;
	};
	[key: string]: unknown;
}

export async function createDiscordThread({
	token,
	channelId,
	name,
	autoArchiveDuration = 1440,
	private: isPrivate = false,
	reason,
}: CreateThreadInput): Promise<DiscordThreadResponse> {
	const payload: Record<string, unknown> = {
		name,
		auto_archive_duration: autoArchiveDuration,
		type: isPrivate ? 12 : 11,
	};

	if (isPrivate) {
		payload.invitable = false;
	}

	const headers: Record<string, string> = {
		"content-type": "application/json",
		authorization: `Bot ${token}`,
	};

	if (reason) {
		headers["x-audit-log-reason"] = reason;
	}

	const response = await fetch(`${DISCORD_API_BASE}/channels/${channelId}/threads`, {
		method: "POST",
		headers,
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		let body: unknown;
		try {
			body = await response.json();
		} catch {
			body = await response.text();
		}
		throw new DiscordApiError(
			`Failed to create Discord thread (status ${response.status})`,
			response.status,
			body,
		);
	}

	return (await response.json()) as DiscordThreadResponse;
}
