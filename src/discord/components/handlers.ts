import { MessageFlags, type ButtonInteraction, type StringSelectMenuInteraction } from "discord.js";
import { ai } from "../../ai/ai.service.js";
import { assistant, liveDrafts, playerLinks } from "../../assistant/index.js";
import { liveKey } from "../commands/dota/live.js";
import { dota } from "../../games/registry.js";
import { UserInputError } from "../../shared/errors.js";
import { renderCounter } from "./counter.render.js";
import { decodeDraft, idList, parseCustomId, positionArg } from "./customIds.js";
import { renderDraft, renderTeams, renderWhyNot } from "./draft.render.js";
import { renderLiveBoard, renderLiveEnded } from "./live.render.js";
import { renderMatchup } from "./matchup.render.js";
import { renderMatchReview, renderMeta } from "./meta.render.js";
import { renderPlayer, renderScout } from "./player.render.js";
import { renderHeroExplanation } from "./embeds.js";

type ComponentInteraction = ButtonInteraction | StringSelectMenuInteraction;
type Handler = (interaction: ComponentInteraction, args: string[]) => Promise<void>;

const clicker = (i: ComponentInteraction) => (i.member && "displayName" in i.member ? i.member.displayName : undefined) ?? i.user.globalName ?? i.user.username;

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
  "full:player": async (interaction, [accountId]) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await interaction.editReply(renderPlayer(await dota.players.analyze(Number(accountId))));
  },
  "full:scout": async (interaction, [pos, ids]) => {
    const enemies = idList(ids).map((id) => ({ accountId: Number(id) }));
    if (!enemies.length) throw new UserInputError("That button is out of date. Ask again.");
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const position = positionArg(pos);
    const analysis = await dota.scouts.analyze({ enemies, position, myAccountId: playerLinks.get(interaction.user.id)?.accountId });
    await interaction.editReply(renderScout(analysis, position));
  },
  "full:meta": async (interaction, [pos, bracket]) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const b = Number(bracket);
    await interaction.editReply(renderMeta(await dota.meta.analyze({ position: positionArg(pos), bracket: b > 0 ? b : undefined })));
  },
  "full:match": async (interaction, [matchId, accountId]) => {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const a = Number(accountId);
    const { review, summary } = await assistant.matchReview({ match: matchId, accountId: a > 0 ? a : undefined });
    await interaction.editReply(renderMatchReview(review, summary));
  },
  // Live draft board buttons act on the channel's draft; Undo/End update the board message in place.
  "live:suggest": async (interaction) => {
    const input = liveDrafts.toInput(liveDrafts.require(liveKey(interaction)));
    await interaction.deferReply();
    await interaction.editReply(renderDraft(await assistant.draft(input), ai.model));
  },
  "live:undo": async (interaction) => {
    const d = liveDrafts.undo(liveKey(interaction), clicker(interaction));
    liveDrafts.setBoard(d.key, interaction.message.id);
    await interaction.update(renderLiveBoard(d));
  },
  "live:end": async (interaction) => {
    const by = clicker(interaction);
    await interaction.update(renderLiveEnded(liveDrafts.end(liveKey(interaction)), by));
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
