import type { MessageRow } from "../../data/models";
import type { WorkersAiTextGenerationResult } from "./progressPrompt";

const FEEDBACK_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8";
const MAX_HISTORY_MESSAGES = 8;
const MAX_MESSAGE_LENGTH = 280;

export interface GenerateProgressFeedbackInput {
	ai: Ai;
	history: MessageRow[];
	now: Date;
	userUpdate: string;
}

export interface GenerateProgressFeedbackResult {
	message: string;
	usage?: WorkersAiTextGenerationResult["usage"];
	model: string;
}

function trimWhitespace(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function formatHistory(history: MessageRow[]): string {
	if (history.length === 0) {
		return "(no previous conversation logs)";
	}

	const recent = history.slice(-MAX_HISTORY_MESSAGES);
	return recent
		.map((entry) => {
			const roleLabel =
				entry.author === "user" ? "User" : entry.author === "bot" ? "Assistant" : "System";
			const timestamp = new Date(entry.created_at).toISOString();
			const content = truncate(trimWhitespace(entry.content), MAX_MESSAGE_LENGTH);
			return `- [${roleLabel}] ${timestamp} :: ${content}`;
		})
		.join("\n");
}

function buildFallbackMessage(userUpdate: string): string {
	const excerpt = truncate(trimWhitespace(userUpdate), 120);
	return `進捗ありがとうございます！要約: ${excerpt}。この調子で進めていきましょう。次はどのタスクに取り組む予定ですか？`;
}

export async function generateProgressFeedback({
	ai,
	history,
	now,
	userUpdate,
}: GenerateProgressFeedbackInput): Promise<GenerateProgressFeedbackResult> {
	const formattedHistory = formatHistory(history);
	const trimmedUpdate = trimWhitespace(userUpdate);

	const systemInstruction = trimWhitespace(`
		You are a supportive Japanese-speaking project mentor.
		Write a short response (2-3 sentences) that first summarizes the user's latest progress and then gives encouraging feedback with a gentle follow-up question.
		Keep the tone positive, professional, and concise.
	`);

	const userPrompt = trimWhitespace(`
		Current time: ${now.toISOString()}
		Latest user update: """${trimmedUpdate}"""
		Recent conversation (oldest to newest):
	${formattedHistory}

		Response requirements:
		- Language: Japanese
		- Keep it within 220 Japanese characters or roughly 2-3 short sentences
		- Start by acknowledging or summarizing the latest update
		- Offer positive reinforcement and invite the user to share their next step or blockers
	`);

	try {
		const result = await ai.run(FEEDBACK_MODEL, {
			messages: [
				{ role: "system", content: systemInstruction },
				{ role: "user", content: userPrompt },
			],
			temperature: 0.5,
			top_p: 0.9,
			max_tokens: 220,
		});

		const message = trimWhitespace(result.response ?? "");
		if (message.length > 0) {
			return { message, usage: result.usage, model: FEEDBACK_MODEL };
		}
	} catch (error) {
		console.warn("ai.generateProgressFeedback.failed", { error });
	}

	return { message: buildFallbackMessage(trimmedUpdate), model: FEEDBACK_MODEL };
}
