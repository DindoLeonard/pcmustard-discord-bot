import { EmbedBuilder } from "discord.js";
import type { CounterExplanation } from "../../ai/prompts/counter.prompt.js";
import { COUNTER_EXPLAIN_COUNT, type Explained } from "../../assistant/dota.assistant.js";
import { KNOWLEDGE_VERSION } from "../../games/dota/knowledge/heroTraits.js";
import { TRAIT_LABEL } from "../../games/dota/knowledge/traits.js";
import { pct } from "../../games/dota/services/scoring.service.js";
import type { CounterAnalysis, CounterCandidate } from "../../games/dota/types.js";
import { COLOR, bullets, clip, field, fitEmbeds, positionSuffix, provenanceFooter, type ReplyPayload } from "./embeds.js";

function statLine(c: CounterCandidate, target: string): string {
  const m = c.matchup;
  if (m.games === 0) return `No head-to-head data vs ${target}`;
  return `\`${pct(m.winRate)} vs ${target} · ${m.games} games${m.lowSample ? " · small sample" : ""}\``;
}

export function renderCounter(result: Explained<CounterAnalysis, CounterExplanation>, aiModel: string | null): ReplyPayload {
  const { analysis, explanation } = result;
  const target = analysis.target.localizedName;
  const embed = new EmbedBuilder().setTitle(`Countering ${target}${positionSuffix(analysis.position)}`).setColor(COLOR.info);
  if (analysis.target.iconUrl) embed.setThumbnail(analysis.target.imageUrl ?? analysis.target.iconUrl);

  const weak = analysis.targetKnowledge?.weakTo.map((t) => TRAIT_LABEL[t]).join(", ");
  if (weak) embed.setDescription(`${target} is weak to: **${weak}**`);

  if (!analysis.candidates.length) {
    embed.addFields(field("No candidates", "No heroes matched that position."));
  }

  const why = new Map(explanation?.picks.map((p) => [p.hero, p.why]) ?? []);
  analysis.candidates.slice(0, COUNTER_EXPLAIN_COUNT).forEach((c, i) => {
    const reason = why.get(c.hero.localizedName) ?? c.reasons.filter((r) => r.type !== "meta").map((r) => r.description).join("; ");
    embed.addFields(field(`${i + 1}. ${c.hero.localizedName} · score ${c.score.toFixed(2)}`, `${clip(reason, 800)}\n${statLine(c, target)}`));
  });

  if (explanation?.strategy.length) embed.addFields(field("General strategy", bullets(explanation.strategy)));
  if (explanation?.items.length) embed.addFields(field("Useful items", bullets(explanation.items.map((i) => `**${i.name}** — ${i.why}`))));

  const rest = analysis.candidates.slice(COUNTER_EXPLAIN_COUNT, 10);
  if (rest.length) embed.addFields(field("Also consider", rest.map((c) => `${c.hero.localizedName} (${c.score.toFixed(2)})`).join(", ")));

  embed.setFooter({
    text: provenanceFooter({
      sources: analysis.sources,
      patch: result.patch,
      extra: `hero traits: curated ${KNOWLEDGE_VERSION}`,
      aiModel: explanation ? aiModel : null,
      aiNote: result.aiNote,
    }),
  });
  return { embeds: fitEmbeds([embed]), components: [] };
}
