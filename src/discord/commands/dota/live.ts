import { MessageFlags, type ChatInputCommandInteraction, type SlashCommandSubcommandGroupBuilder } from "discord.js";
import { ai } from "../../../ai/ai.service.js";
import { assistant, liveDrafts } from "../../../assistant/index.js";
import type { DraftSide, LiveDraft } from "../../../assistant/liveDraft.js";
import { ConversationMemory } from "../../../assistant/memory.js";
import { renderDraft } from "../../components/draft.render.js";
import { renderLiveBoard, renderLiveEnded } from "../../components/live.render.js";
import type { Subcommand } from "../types.js";
import { heroAutocomplete } from "./autocomplete.js";
import { getPosition, heroOption, positionOption } from "./options.js";

export const liveKey = (i: { guildId: string | null; channelId: string }) => ConversationMemory.key(i.guildId, i.channelId);
const who = (i: ChatInputCommandInteraction) =>
  (i.member && "displayName" in i.member ? i.member.displayName : undefined) ?? i.user.globalName ?? i.user.username;

/**
 * Post the updated board as a fresh message and delete the previous one, so the current board is always the
 * newest message in the channel (easy to find mid-draft).
 */
async function postBoard(interaction: ChatInputCommandInteraction, d: LiveDraft): Promise<void> {
  await interaction.reply(renderLiveBoard(d));
  const msg = await interaction.fetchReply();
  const previous = d.boardMessageId;
  liveDrafts.setBoard(d.key, msg.id);
  if (previous && previous !== msg.id) await interaction.channel?.messages.delete(previous).catch(() => undefined);
}

export function buildLiveGroup(group: SlashCommandSubcommandGroupBuilder): SlashCommandSubcommandGroupBuilder {
  const hero = heroOption("hero", "Hero", true);
  return group
    .setName("live")
    .setDescription("A shared draft board for this channel: add picks and bans as they happen")
    .addSubcommand((s) => s.setName("start").setDescription("Start a live draft in this channel").addIntegerOption(positionOption(false, "The position you're picking for")))
    .addSubcommand((s) => s.setName("ally").setDescription("Add a hero to your team").addStringOption(hero))
    .addSubcommand((s) => s.setName("enemy").setDescription("Add a hero to the enemy team").addStringOption(hero))
    .addSubcommand((s) => s.setName("ban").setDescription("Add a banned hero").addStringOption(hero))
    .addSubcommand((s) => s.setName("remove").setDescription("Remove a hero from the draft").addStringOption(hero))
    .addSubcommand((s) => s.setName("position").setDescription("Set the position you're picking for").addIntegerOption(positionOption(true)))
    .addSubcommand((s) => s.setName("suggest").setDescription("Recommend a pick for the current draft"))
    .addSubcommand((s) => s.setName("undo").setDescription("Undo the last change"))
    .addSubcommand((s) => s.setName("board").setDescription("Show the draft board again"))
    .addSubcommand((s) => s.setName("end").setDescription("End the live draft"));
}

const sides: Record<string, DraftSide> = { ally: "ally", enemy: "enemy", ban: "ban" };

export const live: Subcommand = {
  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const key = liveKey(interaction);
    const by = who(interaction);

    switch (sub) {
      case "start": {
        const existing = liveDrafts.get(key);
        const d = liveDrafts.start(key, by, getPosition(interaction));
        if (existing?.boardMessageId) d.boardMessageId = existing.boardMessageId; // so the old board gets replaced
        return postBoard(interaction, d);
      }
      case "ally":
      case "enemy":
      case "ban": {
        const { draft } = await liveDrafts.add(key, sides[sub]!, interaction.options.getString("hero", true), by);
        return postBoard(interaction, draft);
      }
      case "remove":
        return postBoard(interaction, await liveDrafts.remove(key, interaction.options.getString("hero", true), by));
      case "position":
        return postBoard(interaction, liveDrafts.setPosition(key, getPosition(interaction)!, by));
      case "undo":
        return postBoard(interaction, liveDrafts.undo(key, by));
      case "board":
        return postBoard(interaction, liveDrafts.require(key));
      case "suggest": {
        const input = liveDrafts.toInput(liveDrafts.require(key));
        await interaction.deferReply();
        await interaction.editReply(renderDraft(await assistant.draft(input), ai.model));
        return;
      }
      case "end": {
        const d = liveDrafts.end(key);
        if (!d) {
          await interaction.reply({ content: "There's no live draft in this channel.", flags: MessageFlags.Ephemeral });
          return;
        }
        await interaction.reply(renderLiveEnded(d, by));
        if (d.boardMessageId) await interaction.channel?.messages.delete(d.boardMessageId).catch(() => undefined);
        return;
      }
    }
    throw new Error(`Unknown live subcommand: ${sub}`);
  },
  autocomplete: heroAutocomplete,
};
