import type { SlashCommandSubcommandBuilder } from "discord.js";
import { dota } from "../../../games/registry.js";
import { renderMeta } from "../../components/meta.render.js";
import type { Subcommand } from "../types.js";
import { getPosition, getRank, positionOption, rankOption } from "./options.js";

export function buildMetaSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return sub
    .setName("meta")
    .setDescription("Strongest and most picked heroes this patch, by position and rank")
    .addIntegerOption(positionOption(false, "Only heroes that play this position"))
    .addIntegerOption(rankOption);
}

export const meta: Subcommand = {
  async execute(interaction) {
    await interaction.deferReply();
    const analysis = await dota.meta.analyze({ position: getPosition(interaction), bracket: getRank(interaction) });
    await interaction.editReply(renderMeta(analysis));
  },
};
