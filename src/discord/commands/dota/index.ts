import { SlashCommandBuilder } from "discord.js";
import type { Command, Subcommand } from "../types.js";
import { buildCounterSubcommand, counter } from "./counter.js";
import { buildDraftSubcommand, draft } from "./draft.js";
import { buildHeroSubcommand, hero } from "./hero.js";
import { buildMatchupSubcommand, matchup } from "./matchup.js";
import { buildLinkSubcommand, buildPlayerSubcommand, buildUnlinkSubcommand, link, player, unlink } from "./player.js";
import { buildScoutSubcommand, scout } from "./scout.js";
import { buildLiveGroup, live } from "./live.js";
import { buildMatchSubcommand, match } from "./match.js";
import { buildMetaSubcommand, meta } from "./meta.js";

const subcommands: Record<string, Subcommand> = { hero, counter, matchup, draft, meta, match, player, scout, link, unlink };
/** Subcommand groups: /dota live <start|ally|enemy|...>. */
const groups: Record<string, Subcommand> = { live };

const route = (i: { options: { getSubcommandGroup(required?: boolean): string | null; getSubcommand(): string } }) => {
  const group = i.options.getSubcommandGroup(false);
  return group ? groups[group] : subcommands[i.options.getSubcommand()];
};

export const dotaCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("dota")
    .setDescription("Dota 2 assistant")
    .addSubcommand(buildHeroSubcommand)
    .addSubcommand(buildCounterSubcommand)
    .addSubcommand(buildMatchupSubcommand)
    .addSubcommand(buildDraftSubcommand)
    .addSubcommand(buildMetaSubcommand)
    .addSubcommand(buildMatchSubcommand)
    .addSubcommand(buildPlayerSubcommand)
    .addSubcommand(buildScoutSubcommand)
    .addSubcommand(buildLinkSubcommand)
    .addSubcommand(buildUnlinkSubcommand)
    .addSubcommandGroup(buildLiveGroup),
  async execute(interaction) {
    const sub = route(interaction);
    if (!sub) throw new Error(`Unknown subcommand: ${interaction.options.getSubcommand()}`);
    await sub.execute(interaction);
  },
  async autocomplete(interaction) {
    await route(interaction)?.autocomplete?.(interaction);
  },
};
