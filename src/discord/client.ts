import {
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type Message,
  type StringSelectMenuInteraction,
} from "discord.js";
import { ai } from "../ai/ai.service.js";
import { askService } from "../assistant/index.js";
import { ConversationMemory } from "../assistant/memory.js";
import { HeroNotFoundError, ProviderUnavailableError, UserInputError } from "../shared/errors.js";
import { logger } from "../shared/logger.js";
import { VERSION } from "../shared/version.js";
import { commands } from "./commands/index.js";
import { renderAsk } from "./components/ask.render.js";
import { PROVIDER_UNAVAILABLE_MESSAGE, UNEXPECTED_ERROR_MESSAGE, renderHeroNotFound } from "./components/embeds.js";
import { messageImages } from "./attachments.js";
import { findComponentHandler } from "./components/handlers.js";

export function userMessageFor(err: unknown): string {
  if (err instanceof HeroNotFoundError) return renderHeroNotFound(err.query, err.suggestions, err.aiSuggestionCount);
  if (err instanceof UserInputError) return err.message;
  if (err instanceof ProviderUnavailableError) return `${PROVIDER_UNAVAILABLE_MESSAGE}\nI can still give general strategy advice: try \`/ask\`.`;
  return UNEXPECTED_ERROR_MESSAGE;
}

const isExpected = (err: unknown) =>
  err instanceof HeroNotFoundError || err instanceof UserInputError || err instanceof ProviderUnavailableError;

type Repliable = ChatInputCommandInteraction | ButtonInteraction | StringSelectMenuInteraction;

/** Show an error privately. If we already deferred publicly, remove the "thinking…" placeholder first. */
async function replyWithError(interaction: Repliable, err: unknown): Promise<void> {
  const payload = { content: userMessageFor(err), flags: MessageFlags.Ephemeral } as const;
  if (interaction.deferred && !interaction.replied) {
    const wasEphemeral = interaction.ephemeral === true;
    if (wasEphemeral) {
      await interaction.editReply({ content: payload.content, embeds: [], components: [] });
      return;
    }
    await interaction.deleteReply().catch(() => undefined);
    await interaction.followUp(payload);
  } else if (interaction.replied) {
    await interaction.followUp(payload);
  } else {
    await interaction.reply(payload);
  }
}

/** Routes one interaction. Exported so tooling can drive the bot without a gateway connection. */
export async function handleInteraction(interaction: Interaction): Promise<void> {
  const started = Date.now();

  if (interaction.isAutocomplete()) {
    const command = commands.get(interaction.commandName);
    try {
      await command?.autocomplete?.(interaction);
    } catch (err) {
      logger.warn("autocomplete failed", { command: interaction.commandName, error: err });
      if (!interaction.responded) await interaction.respond([]).catch(() => undefined);
    }
    return;
  }

  if (interaction.isButton() || interaction.isStringSelectMenu()) {
    const found = findComponentHandler(interaction.customId);
    if (!found) {
      await interaction.reply({ content: "That button is no longer supported.", flags: MessageFlags.Ephemeral });
      return;
    }
    try {
      await found.handler(interaction, found.args);
      logger.info("component handled", { component: found.key, latencyMs: Date.now() - started });
    } catch (err) {
      (isExpected(err) ? logger.warn : logger.error)("component failed", { component: found.key, latencyMs: Date.now() - started, error: err });
      await replyWithError(interaction, err);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  const subcommand = interaction.options.getSubcommand(false) ?? undefined;
  if (!command) {
    await interaction.reply({ content: "Unknown command.", flags: MessageFlags.Ephemeral });
    return;
  }

  try {
    await command.execute(interaction);
    logger.info("command handled", { command: interaction.commandName, subcommand, game: "dota2", latencyMs: Date.now() - started });
  } catch (err) {
    (isExpected(err) ? logger.warn : logger.error)("command failed", {
      command: interaction.commandName,
      subcommand,
      latencyMs: Date.now() - started,
      error: err,
    });
    await replyWithError(interaction, err);
  }
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Returns the question if the message is addressed to the bot, else null. Addressed means either an
 * @mention anywhere, or the message *starts* with a trigger name as a whole word
 * ("mustardbot, what counters Puck?" yes; "I love mustardbot" / "mustardbots" no).
 */
export function extractQuestion(content: string, mentioned: boolean, botUserId: string, triggerNames: string[]): string | null {
  const withoutMentions = content.replace(new RegExp(`\\s*<@!?${botUserId}>\\s*`, "g"), " ").trim();
  if (mentioned) return withoutMentions;
  for (const name of triggerNames) {
    const match = new RegExp(`^\\s*(?:hey\\s+|hi\\s+|yo\\s+)?${escapeRegExp(name)}(?=$|[\\s,:!?.])[\\s,:!?.]*`, "i").exec(content);
    if (match) return content.slice(match[0].length).trim();
  }
  return null;
}

/** @mention or plain-name trigger -> natural language, answered through the same pipeline as /ask. */
export async function handleMessage(message: Message, botUserId: string, triggerNames: string[] = []): Promise<void> {
  if (message.author.bot) return;
  const text = extractQuestion(message.content, message.mentions.users.has(botUserId), botUserId, triggerNames);
  if (text === null) return;
  const images = await messageImages(message);
  const started = Date.now();
  try {
    if ("sendTyping" in message.channel) await message.channel.sendTyping().catch(() => undefined);
    const result = await askService.ask(text, {
      key: ConversationMemory.key(message.guildId, message.channelId),
      author: message.member?.displayName ?? message.author.globalName ?? message.author.username,
      userId: message.author.id,
      names: Object.fromEntries(
        [...message.mentions.users.values()].map((u) => [u.id, message.mentions.members?.get(u.id)?.displayName ?? u.globalName ?? u.username]),
      ),
    }, images);
    await message.reply({ ...renderAsk(result), allowedMentions: { parse: [], repliedUser: false } });
    logger.info("mention handled", { kind: result.kind, intent: "intent" in result ? result.intent?.intent : undefined, latencyMs: Date.now() - started });
  } catch (err) {
    (isExpected(err) ? logger.warn : logger.error)("mention failed", { latencyMs: Date.now() - started, error: err });
    await message.reply({ content: userMessageFor(err), allowedMentions: { parse: [], repliedUser: false } }).catch(() => undefined);
  }
}

export function createClient(triggerNames: string[] = []): Client {
  // GuildMessages is enough for @mentions: Discord includes message content for messages that mention the bot.
  // Plain-name triggers need to read every message, which requires the privileged MessageContent intent
  // (must also be switched on under Developer Portal -> Bot -> Privileged Gateway Intents).
  const intents = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
  if (triggerNames.length) intents.push(GatewayIntentBits.MessageContent);
  // Never ping anyone: replies can contain AI-written text and user-supplied names/mentions.
  const client = new Client({ intents, allowedMentions: { parse: [], repliedUser: false } });
  client.once(Events.ClientReady, (c) =>
    logger.info("discord ready", { version: VERSION, user: c.user.tag, guilds: c.guilds.cache.size, ai: ai.model ?? "off", triggerNames }),
  );
  client.on(Events.InteractionCreate, (interaction) => {
    handleInteraction(interaction).catch((err) => logger.error("interaction handler crashed", { error: err }));
  });
  client.on(Events.MessageCreate, (message) => {
    if (!client.user) return;
    handleMessage(message, client.user.id, triggerNames).catch((err) => logger.error("message handler crashed", { error: err }));
  });
  return client;
}
