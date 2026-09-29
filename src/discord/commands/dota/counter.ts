import type { SlashCommandSubcommandBuilder } from "discord.js";
import { ai } from "../../../ai/ai.service.js";
import { assistant } from "../../../assistant/index.js";
import { renderCounter } from "../../components/counter.render.js";
import type { Subcommand } from "../types.js";
import { heroAutocomplete } from "./autocomplete.js";
import { getPosition, getRank, heroOption, positionOption, rankOption } from "./options.js";

export function buildCounterSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return sub
    .setName("counter")
    .setDescription("Heroes and strategies that counter an enemy hero")
    .addStringOption(heroOption("hero", "Enemy hero to counter", true))
    .addIntegerOption(positionOption(false, "Only suggest heroes for this position"))
    .addIntegerOption(rankOption);
}

export const counter: Subcommand = {
  async execute(interaction) {
    await interaction.deferReply();
    const result = await assistant.counter(interaction.options.getString("hero", true), {
      position: getPosition(interaction),
      bracket: getRank(interaction),
    });
    await interaction.editReply(renderCounter(result, ai.model));
  },
  autocomplete: heroAutocomplete,
};
