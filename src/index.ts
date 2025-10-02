/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Bind resources to your worker in `wrangler.jsonc`. After adding bindings, a type definition for the
 * `Env` object can be regenerated with `npm run cf-typegen`.
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { app } from "./hono";
import { processPromptSchedulerTick } from "./jobs/promptScheduler";

export default {
	fetch: app.fetch,
	scheduled(event, env, ctx) {
		ctx.waitUntil(
			processPromptSchedulerTick({
				db: env.DB,
				discordToken: env.DISCORD_TOKEN,
				discordApplicationId: env.DISCORD_APPLICATION_ID,
				ai: env.AI,
				scheduled: new Date(event.scheduledTime),
			}),
		);
	},
} satisfies ExportedHandler<Env>;
