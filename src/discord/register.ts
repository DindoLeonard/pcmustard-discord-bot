import { REST, Routes } from "discord.js";
import { loadDiscordEnv } from "../config/env.js";
import { logger } from "../shared/logger.js";
import { commands } from "./commands/index.js";

const { DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID } = loadDiscordEnv();
const body = [...commands.values()].map((c) => c.data.toJSON());
const rest = new REST().setToken(DISCORD_TOKEN);

const route = DISCORD_GUILD_ID
  ? Routes.applicationGuildCommands(DISCORD_CLIENT_ID, DISCORD_GUILD_ID)
  : Routes.applicationCommands(DISCORD_CLIENT_ID);

await rest.put(route, { body });
logger.info("commands registered", {
  scope: DISCORD_GUILD_ID ? "guild" : "global",
  commands: body.map((c) => c.name),
});
