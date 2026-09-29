import { loadDiscordEnv } from "./config/env.js";
import { createClient } from "./discord/client.js";
import { logger } from "./shared/logger.js";

let discordEnv;
try {
  discordEnv = loadDiscordEnv();
} catch (err) {
  logger.error("startup failed", { error: err });
  process.exit(1);
}

const client = createClient(discordEnv.BOT_TRIGGER_NAMES);

const shutdown = (signal: string) => {
  logger.info("shutting down", { signal });
  client.destroy().finally(() => process.exit(0));
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

try {
  await client.login(discordEnv.DISCORD_TOKEN);
} catch (err) {
  const disallowed = err instanceof Error && /disallowed intents/i.test(err.message);
  logger.error("login failed", {
    error: err,
    hint: disallowed
      ? "Enable 'Message Content Intent' under Developer Portal -> your app -> Bot -> Privileged Gateway Intents, or set BOT_TRIGGER_NAMES= (empty) to disable plain-name triggers."
      : undefined,
  });
  await client.destroy();
  process.exitCode = 1;
}
