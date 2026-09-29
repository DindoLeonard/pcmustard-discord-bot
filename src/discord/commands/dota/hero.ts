import type { SlashCommandSubcommandBuilder } from "discord.js";
import { assistant } from "../../../assistant/index.js";
import { dota } from "../../../games/registry.js";
import { renderHero } from "../../components/embeds.js";
import type { Subcommand } from "../types.js";
import { heroAutocomplete } from "./autocomplete.js";
import { heroOption } from "./options.js";

export function buildHeroSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return sub
    .setName("hero")
    .setDescription("Show basic information about a Dota 2 hero")
    .addStringOption(heroOption("hero", "Hero name", true));
}

export const hero: Subcommand = {
  async execute(interaction) {
    await interaction.deferReply();
    const match = await assistant.withHeroGuess(() => dota.heroes.resolve(interaction.options.getString("hero", true)));
    await interaction.editReply(renderHero(match.hero, true));
  },
  autocomplete: heroAutocomplete,
};
