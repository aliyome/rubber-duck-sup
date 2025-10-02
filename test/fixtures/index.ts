import progressPromptSuccess from "./cloudflare_ai/progress-prompt-success.json";
import summarySuccess from "./cloudflare_ai/summary-success.json";
import interactionProgress from "./discord/interaction-progress.json";

export interface DiscordUser {
	id: string;
	username: string;
	global_name: string;
	avatar: string | null;
	discriminator: string;
}

export interface DiscordMember {
	user: DiscordUser;
	roles: string[];
	joined_at: string;
	premium_since: string | null;
	pending: boolean;
	nick: string | null;
	communication_disabled_until: string | null;
	mute: boolean;
	deaf: boolean;
	flags: number;
}

export interface DiscordInteractionOption {
	name: string;
	type: number;
	value?: string;
}

export interface DiscordInteractionData {
	id: string;
	name: string;
	type: number;
	options?: DiscordInteractionOption[];
}

export interface DiscordInteractionRequest {
	id: string;
	application_id: string;
	type: number;
	data?: DiscordInteractionData;
	guild_id?: string;
	channel_id?: string;
	member?: DiscordMember;
	token: string;
	version: number;
	locale?: string;
	guild_locale?: string;
	app_permissions?: string;
}

export interface WorkersAiTextResponse {
	response: string;
	model: string;
	usage: {
		prompt_tokens: number;
		completion_tokens: number;
		total_tokens: number;
	};
	meta?: Record<string, unknown>;
}

export interface WorkersAiSummaryResponse {
	summary: string;
	model: string;
	usage: Record<string, number>;
	meta?: Record<string, unknown>;
}

export const fixtures = {
	discord: {
		slashProgress: interactionProgress as DiscordInteractionRequest,
	},
	cloudflareAi: {
		progressPrompt: progressPromptSuccess as WorkersAiTextResponse,
		summary: summarySuccess as WorkersAiSummaryResponse,
	},
} as const;

export type FixtureMap = typeof fixtures;
