import type { SlashCommandSubcommandBuilder } from "discord.js";
import { ai } from "../../../ai/ai.service.js";
import { assistant } from "../../../assistant/index.js";
import { renderMatchup } from "../../components/matchup.render.js";
import type { Subcommand } from "../types.js";
import { heroAutocomplete } from "./autocomplete.js";
import { getPosition, heroOption, positionOption } from "./options.js";

export function buildMatchupSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return sub
    .setName("matchup")
    .setDescription("How to play your hero against a specific enemy hero")
    .addStringOption(heroOption("my_hero", "Your hero", true))
    .addStringOption(heroOption("enemy_hero", "Enemy hero", true))
    .addIntegerOption(positionOption(false));
}

export const matchup: Subcommand = {
  async execute(interaction) {
    await interaction.deferReply();
    const result = await assistant.matchup(
      interaction.options.getString("my_hero", true),
      interaction.options.getString("enemy_hero", true),
      { position: getPosition(interaction) },
    );
    await interaction.editReply(renderMatchup(result, ai.model));
  },
  autocomplete: heroAutocomplete,
};
