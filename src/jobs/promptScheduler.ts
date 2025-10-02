interface PromptSchedulerContext {
	db: D1Database;
	discordToken: string;
	discordApplicationId: string;
	scheduled: Date;
}

/**
 * Entry point for the cron trigger to enqueue and deliver progress prompts.
 * The detailed implementation will follow the design in
 * docs/research/processing_flow_and_data_model.md.
 */
export async function processPromptSchedulerTick({
	db,
	discordToken,
	discordApplicationId,
	scheduled,
}: PromptSchedulerContext): Promise<void> {
	console.info("cron.tick", {
		executedAt: scheduled.toISOString(),
		discordApplicationId,
	});

	// TODO: Query active sessions with next_prompt_due <= scheduled time.
	void db;
	void discordToken;
}
