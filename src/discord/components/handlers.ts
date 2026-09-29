import { MessageFlags, type ButtonInteraction, type StringSelectMenuInteraction } from "discord.js";
import { ai } from "../../ai/ai.service.js";
import { assistant } from "../../assistant/index.js";
import { UserInputError } from "../../shared/errors.js";
import { renderCounter } from "./counter.render.js";
import { decodeDraft, idList, parseCustomId, positionArg } from "./customIds.js";
import { renderDraft, renderTeams, renderWhyNot } from "./draft.render.js";
import { renderMatchup } from "./matchup.render.js";
import { renderHeroExplanation } from "./embeds.js";

type ComponentInteraction = ButtonInteraction | StringSelectMenuInteraction;
type Handler = (interaction: ComponentInteraction, args: string[]) => Promise<void>;

/**
 * Follow-ups triggered from buttons/menus reply ephemerally to whoever clicked,
 * so one person's curiosity doesn't flood the channel.
 */
const handlers: Record<string, Handler> = {
  "hero:explain": async (interaction, [heroId]) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(renderHeroExplanation(await assistant.heroExplain(heroId!), ai.model));
  },
  "hero:counters": async (interaction, [heroId]) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(renderCounter(await assistant.counter(heroId!), ai.model));
  },
  // "Show full analysis" under a chat reply: the same embeds the slash commands produce.
  "full:counter": async (interaction, [heroId, pos]) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(renderCounter(await assistant.counter(heroId!, { position: positionArg(pos) }), ai.model));
  },
  "full:matchup": async (interaction, [heroId, enemyId, pos]) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(renderMatchup(await assistant.matchup(heroId!, enemyId!, { position: positionArg(pos) }), ai.model));
  },
  "full:draft": async (interaction, args) => {
    const input = decodeDraft(args);
    if (!input) throw new UserInputError("That button is out of date. Ask again.");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(renderDraft(await assistant.draft(input), ai.model));
  },
  "full:teams": async (interaction, [allies, enemies]) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(renderTeams(await assistant.teams({ allies: idList(allies), enemies: idList(enemies) })));
  },
  "full:whynot": async (interaction, args) => {
    const input = decodeDraft(args.slice(0, 4));
    const heroId = Number(args[4]);
    if (!input || !Number.isInteger(heroId)) throw new UserInputError("That button is out of date. Ask again.");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(renderWhyNot(await assistant.whyNot(input, heroId), ai.model));
  },
  "draft:whynot": async (interaction, args) => {
    if (!interaction.isStringSelectMenu()) return;
    const input = decodeDraft(args);
    const heroId = Number(interaction.values[0]);
    if (!input || !Number.isInteger(heroId)) throw new UserInputError("That menu is out of date. Run /dota draft again.");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(renderWhyNot(await assistant.whyNot(input, heroId), ai.model));
  },
};

export function findComponentHandler(customId: string): { handler: Handler; args: string[]; key: string } | null {
  const { scope, action, args } = parseCustomId(customId);
  const key = `${scope}:${action}`;
  // hasOwn: a crafted customId like "constructor:x" must not reach Object.prototype.
  return Object.hasOwn(handlers, key) ? { handler: handlers[key]!, args, key } : null;
}
