import { SlashCommandBuilder } from "discord.js";
import type { Command, Subcommand } from "../types.js";
import { buildCounterSubcommand, counter } from "./counter.js";
import { buildDraftSubcommand, draft } from "./draft.js";
import { buildHeroSubcommand, hero } from "./hero.js";
import { buildMatchupSubcommand, matchup } from "./matchup.js";

const subcommands: Record<string, Subcommand> = { hero, counter, matchup, draft };

export const dotaCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("dota")
    .setDescription("Dota 2 assistant")
    .addSubcommand(buildHeroSubcommand)
    .addSubcommand(buildCounterSubcommand)
    .addSubcommand(buildMatchupSubcommand)
    .addSubcommand(buildDraftSubcommand),
  async execute(interaction) {
    const name = interaction.options.getSubcommand();
    const sub = subcommands[name];
    if (!sub) throw new Error(`Unknown subcommand: ${name}`);
    await sub.execute(interaction);
  },
  async autocomplete(interaction) {
    await subcommands[interaction.options.getSubcommand()]?.autocomplete?.(interaction);
  },
};
