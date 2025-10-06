#!/usr/bin/env/ bun
import process from "node:process";
import type { RESTPostAPIApplicationCommandsJSONBody } from "discord.js";
import { REST, Routes, SlashCommandBuilder } from "discord.js";

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		console.error(`[deployCommands] Missing environment variable: ${name}`);
		process.exit(1);
	}
	return value;
}

async function main(): Promise<void> {
	const dryRun = process.argv.includes("--dry-run");

	const commands = [
		new SlashCommandBuilder()
			.setName("progress")
			.setDescription("進捗状況を報告します")
			.addStringOption((option) =>
				option
					.setName("status")
					.setDescription("現在の進捗内容を入力してください")
					.setRequired(true),
			)
			.toJSON(),
		new SlashCommandBuilder()
			.setName("start")
			.setDescription("セッションを開始します")
			.addStringOption((option) =>
				option.setName("title").setDescription("セッションのタイトル").setRequired(true),
			)
			.addIntegerOption((option) =>
				option.setName("cadence").setDescription("リマインダーの間隔（分単位）").setRequired(false),
			)
			.toJSON(),
		new SlashCommandBuilder().setName("stop").setDescription("セッションを終了します").toJSON(),
	] satisfies RESTPostAPIApplicationCommandsJSONBody[];

	const guildId = process.env.DISCORD_GUILD_ID ?? "";
	const target = guildId ? `guild ${guildId}` : "global";

	if (dryRun) {
		const applicationId = process.env.DISCORD_APPLICATION_ID ?? "(unset)";
		if (!process.env.DISCORD_TOKEN || process.env.DISCORD_TOKEN.length === 0) {
			console.log(
				"[deployCommands] Note: DISCORD_TOKEN is not set. Commands cannot be deployed without it.",
			);
		}
		if (applicationId === "(unset)") {
			console.log(
				"[deployCommands] Note: DISCORD_APPLICATION_ID is not set. Provide it before deploying.",
			);
		}
		console.log(`[deployCommands] Dry-run for application ${applicationId} targeting ${target}.`);
		console.log(JSON.stringify(commands, null, 2));
		return;
	}

	const token = requireEnv("DISCORD_TOKEN");
	const applicationId = requireEnv("DISCORD_APPLICATION_ID");
	const rest = new REST({ version: "10" }).setToken(token);

	try {
		if (guildId) {
			await rest.put(Routes.applicationGuildCommands(applicationId, guildId), {
				body: commands,
			});
			console.log(
				`[deployCommands] Successfully deployed ${commands.length} command(s) to guild ${guildId}.`,
			);
		} else {
			await rest.put(Routes.applicationCommands(applicationId), { body: commands });
			console.log(`[deployCommands] Successfully deployed ${commands.length} global command(s).`);
		}
	} catch (error) {
		console.error("[deployCommands] Failed to register slash commands:");
		if (error instanceof Error) {
			console.error(error.message);
			if ("code" in error) {
				console.error(`code: ${error.code}`);
			}
			if ("rawError" in error) {
				console.error(JSON.stringify(error.rawError, null, 2));
			}
		} else {
			console.error(error);
		}
		process.exit(1);
	}
}

await main();
