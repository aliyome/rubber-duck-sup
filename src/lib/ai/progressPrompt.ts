import type { MessageRow } from "../../data/models";

const DEFAULT_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";
const MAX_HISTORY_MESSAGES = 10;
const MAX_MESSAGE_LENGTH = 320;

export interface WorkersAiTextGenerationResult {
	response?: string;
	usage?: {
		prompt_tokens?: number;
		completion_tokens?: number;
		total_tokens?: number;
	};
	[key: string]: unknown;
}

export interface GenerateProgressPromptInput {
	ai: Ai;
	history: MessageRow[];
	now: Date;
	model?: keyof AiModels;
	cadenceMinutes?: number;
}

export interface GenerateProgressPromptResult {
	prompt: string;
	usage?: WorkersAiTextGenerationResult["usage"];
}

function trimWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function formatHistory(history: MessageRow[]): string {
	if (history.length === 0) {
		return "(no prior conversation)";
	}

	const recent = history.slice(-MAX_HISTORY_MESSAGES);
	return recent
		.map((message) => {
			const role =
				message.author === "user" ? "User" : message.author === "bot" ? "Assistant" : "System";
			const timestamp = new Date(message.created_at).toISOString();
			const content = truncate(trimWhitespace(message.content), MAX_MESSAGE_LENGTH);
			return `- [${role}] ${timestamp} :: ${content}`;
		})
		.join("\n");
}

function findLatestUserMessage(history: MessageRow[]): string | null {
	for (let index = history.length - 1; index >= 0; index -= 1) {
		const entry = history[index];
		if (entry.author === "user") {
			return trimWhitespace(entry.content);
		}
	}
	return null;
}

function buildFallbackPrompt(latestUserMessage: string | null): string {
	if (latestUserMessage && latestUserMessage.length > 0) {
		const excerpt = truncate(latestUserMessage, 60);
		return `前回は「${excerpt}」という状況でしたが、その後の進捗はいかがですか？`; // jpn fallback is intentional
	}
	return "最近の進捗を教えてください。小さなことでも大歓迎です！";
}

export async function generateProgressPrompt({
	ai,
	history,
	now,
	model = DEFAULT_MODEL,
	cadenceMinutes = 20,
}: GenerateProgressPromptInput): Promise<GenerateProgressPromptResult> {
	const latestUserMessage = findLatestUserMessage(history);
	const formattedHistory = formatHistory(history);

	const systemInstruction = trimWhitespace(`
		You are a friendly project mentor who helps users stay accountable.
		Your task is to craft a concise, encouraging, and professional check-in message in Japanese to be sent to the user.

		Follow these steps:
		1. First, internally, identify the user's primary goal or challenge based on the provided conversation history.
		2. Second, internally, summarize their recent progress.
		3. Finally, using the goal and progress you identified, craft the check-in message.

		**IMPORTANT**: Only output the final check-in message, without any of your internal analysis or preamble.
	`);

	const cadenceDescription =
		cadenceMinutes > 0 ? `${cadenceMinutes} minutes` : "the configured interval";

	const userPrompt = trimWhitespace(`
		Current time: ${now.toISOString()}
		Progress cadence: ${cadenceDescription}
		Conversation history (oldest to newest):
	${formattedHistory}

		Output requirements for the check-in message:
		- Language: Japanese
		- Tone: Encouraging, friendly, and professional.
		- Format:
			- Start with a summary of the user's goal and recent progress.
			- End with an open-ended question to encourage a status update.
			- Use newlines (\\n) to separate sentences for readability.
		- Total Length: At most 3 short sentences or 140 Japanese characters.
	`);

	try {
		const rawresult = await ai.run(model, {
			messages: [
				{ role: "system", content: systemInstruction },
				{ role: "user", content: userPrompt },
			],
			temperature: 0.4,
			top_p: 0.9,
			max_tokens: 180,
		});

		// we use `as` here for now
		const result = rawresult as BaseAiTextGeneration["postProcessedOutputs"];

		const prompt = (result.response ?? "").trim();
		if (prompt.length > 0) {
			return { prompt, usage: result.usage };
		}
	} catch (error) {
		console.warn("ai.generateProgressPrompt.failed", {
			error,
			model,
		});
	}

	return { prompt: buildFallbackPrompt(latestUserMessage) };
}
