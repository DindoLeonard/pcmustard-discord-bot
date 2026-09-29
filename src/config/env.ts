import "dotenv/config";
import { z } from "zod";

const optional = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== "" ? v.trim() : undefined));

const baseSchema = z.object({
  OPENDOTA_API_KEY: optional,
  OPENDOTA_BASE_URL: z.url().default("https://api.opendota.com/api"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  OPENAI_API_KEY: optional,
  OPENAI_MODEL: z.string().min(1).default("gpt-5.4-mini"),
  OPENAI_REASONING_EFFORT: z.enum(["none", "minimal", "low", "medium", "high"]).default("low"),
  AI_TIMEOUT_MS: z.coerce.number().int().positive().default(25_000),
  /** Web search for questions our data can't answer (other games, Dota news/patch notes). Costs extra per search. */
  WEB_SEARCH_ENABLED: z
    .string()
    .default("true")
    .transform((v) => !["false", "0", "no", "off", ""].includes(v.trim().toLowerCase())),
  WEB_SEARCH_MODEL: optional,
  WEB_SEARCH_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  /** Shared per-channel conversation memory for /ask, @mentions and trigger names. */
  MEMORY_MAX_TURNS: z.coerce.number().int().min(0).max(50).default(6),
  MEMORY_TTL_MINUTES: z.coerce.number().positive().default(30),
  /** Discord user -> Dota account links (/dota link). */
  PLAYER_LINKS_FILE: z.string().min(1).default("data/player-links.json"),
});

const discordSchema = z.object({
  DISCORD_TOKEN: z.string({ error: "DISCORD_TOKEN is required" }).min(1, "DISCORD_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string({ error: "DISCORD_CLIENT_ID is required" }).min(1, "DISCORD_CLIENT_ID is required"),
  DISCORD_GUILD_ID: optional,
  /**
   * Comma-separated names that trigger a reply when a message starts with them ("mustardbot what counters Puck?").
   * Needs the privileged Message Content intent enabled in the Developer Portal. Set to empty to disable.
   */
  BOT_TRIGGER_NAMES: z
    .string()
    .default("mustardbot")
    .transform((v) =>
      v
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    ),
});

export type BaseEnv = z.infer<typeof baseSchema>;
export type DiscordEnv = z.infer<typeof discordSchema>;

function parse<T extends z.ZodType>(schema: T, source: NodeJS.ProcessEnv): z.infer<T> {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}\nSee .env.example.`);
  }
  return result.data;
}

/** Settings needed by game services; never requires secrets. */
export const env: BaseEnv = parse(baseSchema, process.env);

/** Settings needed to connect to Discord. Call only from bot entrypoints. */
export function loadDiscordEnv(source: NodeJS.ProcessEnv = process.env): DiscordEnv {
  return parse(discordSchema, source);
}
