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
