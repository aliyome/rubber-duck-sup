-- Initial schema for Discord progress assistant
CREATE TABLE `sessions` (
	id TEXT PRIMARY KEY,
	discord_user_id TEXT NOT NULL,
	discord_channel_id TEXT NOT NULL,
	discord_thread_id TEXT,
	`status` TEXT NOT NULL DEFAULT 'active',
	started_at INTEGER NOT NULL,
	ended_at INTEGER,
	cadence_minutes INTEGER NOT NULL,
	next_prompt_due INTEGER,
	last_prompt_sent_at INTEGER,
	last_user_reply_at INTEGER,
	CHECK (`status` IN ('active', 'stopped', 'paused')),
	CHECK (cadence_minutes > 0)
)STRICT;

CREATE INDEX idx_sessions_status_started_at
	ON `sessions`(`status`, started_at DESC);

CREATE INDEX idx_sessions_status_next_prompt
	ON `sessions`(`status`, next_prompt_due);

CREATE TABLE messages (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	author TEXT NOT NULL,
	discord_message_id TEXT,
	content TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (session_id) REFERENCES `sessions`(id) ON DELETE CASCADE,
	CHECK (author IN ('user', 'bot', 'system'))
)STRICT;

CREATE INDEX idx_messages_session_created_at
	ON messages(session_id, created_at);

CREATE TABLE ai_requests (
	id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	kind TEXT NOT NULL,
	model TEXT NOT NULL,
	input_tokens INTEGER,
	output_tokens INTEGER,
	created_at INTEGER NOT NULL,
	FOREIGN KEY (session_id) REFERENCES `sessions`(id) ON DELETE CASCADE
)STRICT;

CREATE INDEX idx_ai_requests_session_created_at
	ON ai_requests(session_id, created_at);
