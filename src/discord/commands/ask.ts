import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { askService } from "../../assistant/index.js";
import { ConversationMemory } from "../../assistant/memory.js";
import type { Conversation } from "../../assistant/ask.service.js";
import { downloadImages } from "../attachments.js";
import { renderAsk } from "../components/ask.render.js";
import type { Command } from "./types.js";

/** Everyone in a channel shares one conversation; the author name tells the AI who said what. */
export function interactionConversation(interaction: ChatInputCommandInteraction): Conversation {
  const member = interaction.member && "displayName" in interaction.member ? interaction.member.displayName : undefined;
  return {
    key: ConversationMemory.key(interaction.guildId, interaction.channelId),
    author: member ?? interaction.user.globalName ?? interaction.user.username,
    userId: interaction.user.id,
  };
}

export const ask: Command = {
  data: new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask a Dota 2 question in plain English")
    .addStringOption((o) =>
      o.setName("question").setDescription('e.g. "I\'m Invoker mid vs Huskar, what should I do?"').setRequired(true).setMaxLength(1000),
    )
    .addAttachmentOption((o) => o.setName("image").setDescription("A screenshot (e.g. the draft screen) or any image to ask about").setRequired(false)),
  async execute(interaction) {
    await interaction.deferReply();
    const attachment = interaction.options.getAttachment("image");
    const images = attachment ? await downloadImages([attachment]) : [];
    const result = await askService.ask(interaction.options.getString("question", true), interactionConversation(interaction), images);
    await interaction.editReply(renderAsk(result));
  },
};

export const forget: Command = {
  data: new SlashCommandBuilder().setName("forget").setDescription("Clear the bot's conversation memory for this channel"),
  async execute(interaction) {
    const result = askService.forget(interactionConversation(interaction).key);
    await interaction.reply(renderAsk(result));
  },
};
