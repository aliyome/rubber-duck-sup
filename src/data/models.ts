export interface SessionRow {
	id: string;
	discord_user_id: string;
	discord_channel_id: string;
	discord_thread_id: string | null;
	status: "active" | "stopped" | "paused";
	started_at: number;
	ended_at: number | null;
	cadence_minutes: number;
	next_prompt_due: number | null;
	last_prompt_sent_at: number | null;
	last_user_reply_at: number | null;
}

export interface MessageRow {
	id: string;
	session_id: string;
	author: "user" | "bot" | "system";
	discord_message_id: string | null;
	content: string;
	created_at: number;
}

export interface PromptDueSession extends SessionRow {
	next_prompt_due: number;
}
