import { describe, expect, it, vi } from "vitest";
import type { MessageRow } from "../src/data/models";
import type { WorkersAiBinding } from "../src/lib/ai/progressPrompt";
import { generateProgressPrompt } from "../src/lib/ai/progressPrompt";

describe("generateProgressPrompt", () => {
	const baseHistory: MessageRow[] = [
		{
			id: "m-1",
			session_id: "s-1",
			author: "user",
			discord_message_id: null,
			content: "昨日は新しいバリデーションロジックを実装しました",
			created_at: Date.UTC(2025, 8, 30, 12, 0, 0),
		},
		{
			id: "m-2",
			session_id: "s-1",
			author: "bot",
			discord_message_id: null,
			content: "素晴らしい進捗です！次はテストも追加しましょう",
			created_at: Date.UTC(2025, 8, 30, 12, 5, 0),
		},
	];

	it("calls Workers AI with the expected payload and returns the model output", async () => {
		const aiResult = {
			response: "前回のテスト追加についての進捗はどうですか？小さなことでも教えてください。",
			usage: { prompt_tokens: 120, completion_tokens: 32, total_tokens: 152 },
		};
		const run = vi.fn<WorkersAiBinding["run"]>().mockResolvedValue(aiResult);
		const ai: WorkersAiBinding = { run };

		const now = new Date("2025-10-02T00:00:00.000Z");
		const result = await generateProgressPrompt({
			ai,
			history: baseHistory,
			now,
			cadenceMinutes: 30,
		});

		expect(result).toEqual({ prompt: aiResult.response, usage: aiResult.usage });
		expect(run).toHaveBeenCalledTimes(1);

		const [model, payload] = run.mock.calls[0];
		expect(model).toBe("@cf/meta/llama-3.1-8b-instruct-fp8");
		expect(payload).toMatchObject({
			temperature: 0.4,
			top_p: 0.9,
			max_tokens: 180,
		});

		const { messages } = payload as { messages: Array<{ role: string; content: string }> };
		expect(messages).toHaveLength(2);
		expect(messages[0].role).toBe("system");
		expect(messages[0].content).toContain("Identify the user's primary goal or challenge");
		expect(messages[1].role).toBe("user");
		expect(messages[1].content).toContain("Current time: 2025-10-02T00:00:00.000Z");
		expect(messages[1].content).toContain("Conversation history (oldest to newest):");
		expect(messages[1].content).toContain("Output requirements:");
	});

	it("falls back to a handcrafted message when the model response is empty", async () => {
		const run = vi.fn<WorkersAiBinding["run"]>().mockResolvedValue({ response: "" });
		const ai: WorkersAiBinding = { run };

		const longUpdate = "".padEnd(120, "進捗");
		const history: MessageRow[] = [
			{
				id: "m-3",
				session_id: "s-1",
				author: "user",
				discord_message_id: null,
				content: longUpdate,
				created_at: Date.UTC(2025, 8, 30, 18, 0, 0),
			},
		];

		const result = await generateProgressPrompt({
			ai,
			history,
			now: new Date("2025-10-02T09:00:00.000Z"),
		});

		expect(result.prompt).toContain("前回は");
		expect(result.prompt).toContain("進捗進捗進捗");
		expect(run).toHaveBeenCalledTimes(1);
	});

	it("uses a generic fallback when no user history is available", async () => {
		const run = vi.fn<WorkersAiBinding["run"]>().mockRejectedValue(new Error("network"));
		const ai: WorkersAiBinding = { run };

		const history: MessageRow[] = [
			{
				id: "m-4",
				session_id: "s-1",
				author: "bot",
				discord_message_id: null,
				content: "最新の進捗を教えてください",
				created_at: Date.UTC(2025, 8, 29, 9, 0, 0),
			},
		];

		const result = await generateProgressPrompt({
			ai,
			history,
			now: new Date("2025-10-02T09:00:00.000Z"),
		});

		expect(result.prompt).toBe("最近の進捗を教えてください。小さなことでも大歓迎です！");
		expect(run).toHaveBeenCalledTimes(1);
	});
});
