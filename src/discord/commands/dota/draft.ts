import type { SlashCommandSubcommandBuilder } from "discord.js";
import { ai } from "../../../ai/ai.service.js";
import { assistant } from "../../../assistant/index.js";
import { MAX_ALLIES, MAX_ENEMIES } from "../../../games/dota/services/draft.service.js";
import { renderDraft } from "../../components/draft.render.js";
import type { Subcommand } from "../types.js";
import { heroAutocomplete } from "./autocomplete.js";
import { getPosition, getRank, heroOption, positionOption, rankOption } from "./options.js";

const allyOptions = Array.from({ length: MAX_ALLIES }, (_, i) => `ally${i + 1}`);
const enemyOptions = Array.from({ length: MAX_ENEMIES }, (_, i) => `enemy${i + 1}`);

export function buildDraftSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  sub
    .setName("draft")
    .setDescription("Analyze both lineups and recommend a pick for your position")
    .addIntegerOption(positionOption(true, "The position you still need to pick"));
  allyOptions.forEach((name, i) => sub.addStringOption(heroOption(name, `Allied hero ${i + 1}`, false)));
  enemyOptions.forEach((name, i) => sub.addStringOption(heroOption(name, `Enemy hero ${i + 1}`, false)));
  return sub.addIntegerOption(rankOption);
}

export const draft: Subcommand = {
  async execute(interaction) {
    await interaction.deferReply();
    const read = (names: string[]) => names.map((n) => interaction.options.getString(n)).filter((v): v is string => Boolean(v));
    const result = await assistant.draft({
      position: getPosition(interaction)!,
      allies: read(allyOptions),
      enemies: read(enemyOptions),
      bracket: getRank(interaction),
    });
    await interaction.editReply(renderDraft(result, ai.model));
  },
  autocomplete: heroAutocomplete,
};
