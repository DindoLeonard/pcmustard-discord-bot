import type { SlashCommandSubcommandBuilder } from "discord.js";
import { playerLinks } from "../../../assistant/index.js";
import { resolvePlayerRef, type ResolvedPlayer } from "../../../assistant/playerRefs.js";
import { UserInputError } from "../../../shared/errors.js";
import { dota } from "../../../games/registry.js";
import { MAX_SCOUTED } from "../../../games/dota/services/scout.service.js";
import { renderScout } from "../../components/player.render.js";
import type { Subcommand } from "../types.js";
import { getPosition, getRank, positionOption, rankOption } from "./options.js";
import { discordName } from "./player.js";

const enemyOptions = Array.from({ length: MAX_SCOUTED }, (_, i) => `enemy${i + 1}`);

/** Resolve each ref independently: an unlinked @mention or typo is reported in the scout, not fatal. */
export function resolveAll(refs: string[], requesterId: string, nameOf: (id: string) => string | undefined) {
  const enemies: ResolvedPlayer[] = [];
  const unresolved: { label: string; error: string }[] = [];
  for (const ref of refs) {
    try {
      enemies.push(resolvePlayerRef(ref, playerLinks, requesterId, nameOf));
    } catch (err) {
      if (!(err instanceof UserInputError)) throw err;
      const mention = /^<@!?(\d+)>$/.exec(ref.trim());
      unresolved.push({ label: mention ? `@${nameOf(mention[1]!) ?? mention[1]}` : ref.trim().slice(0, 40), error: err.message });
    }
  }
  return { enemies, unresolved };
}

export function buildScoutSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  sub.setName("scout").setDescription("Scout enemy players: their likely picks, suggested bans, and picks against them");
  enemyOptions.forEach((name, i) =>
    sub.addStringOption((o) =>
      o
        .setName(name)
        .setDescription(`Enemy player ${i + 1}: Friend ID, OpenDota/Dotabuff link, or @mention of a linked user`)
        .setRequired(i === 0),
    ),
  );
  return sub.addIntegerOption(positionOption(false, "Also suggest picks for this position against their likely heroes")).addIntegerOption(rankOption);
}

export const scout: Subcommand = {
  async execute(interaction) {
    const refs = enemyOptions.map((n) => interaction.options.getString(n)).filter((v): v is string => Boolean(v));
    const { enemies, unresolved } = resolveAll(refs, interaction.user.id, (id) => discordName(interaction, id));
    await interaction.deferReply();
    const position = getPosition(interaction);
    const analysis = await dota.scouts.analyze({
      enemies,
      unresolved,
      position,
      bracket: getRank(interaction),
      myAccountId: playerLinks.get(interaction.user.id)?.accountId,
    });
    await interaction.editReply(renderScout(analysis, position));
  },
};
