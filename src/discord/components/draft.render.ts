import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, type MessageActionRowComponentBuilder } from "discord.js";
import type { DraftExplanation, WhyNotExplanation } from "../../ai/prompts/draft.prompt.js";
import { DRAFT_EXPLAIN_COUNT, type Explained } from "../../assistant/dota.assistant.js";
import { KNOWLEDGE_VERSION } from "../../games/dota/knowledge/heroTraits.js";
import { POSITION_LABEL, TRAIT_LABEL } from "../../games/dota/knowledge/traits.js";
import { pct } from "../../games/dota/services/scoring.service.js";
import { DIMENSION_LABEL } from "../../games/dota/services/team.service.js";
import type { DraftAnalysis, DraftCandidate, ProfileDimension, TeamProfile, TeamsAnalysis } from "../../games/dota/types.js";
import { COLOR, bracketLabel, bullets, clip, field, fitEmbeds, provenanceFooter, type ReplyPayload } from "./embeds.js";
import { customId } from "./customIds.js";

const PROFILE_ROWS: ProfileDimension[] = [
  "initiation",
  "disable",
  "catch",
  "save",
  "frontline",
  "waveClear",
  "towerPush",
  "physicalDamage",
  "magicalDamage",
  "teamfight",
];

function profileBlock(profile: TeamProfile): string {
  const rows = PROFILE_ROWS.map((d) => {
    const v = Math.round(profile[d] * 10);
    return `${DIMENSION_LABEL[d].padEnd(15)} ${"█".repeat(v)}${"░".repeat(10 - v)} ${v}/10`;
  });
  return "```\n" + rows.join("\n") + "\n```";
}

function names(heroes: { localizedName: string }[]): string {
  return heroes.length ? heroes.map((h) => h.localizedName).join("\n") : "—";
}

function dataLine(c: DraftCandidate): string {
  const withData = c.matchups.filter((m) => m.games > 0);
  const best = [...withData].sort((a, b) => b.adjustedWinRate - a.adjustedWinRate)[0];
  const parts = [`score ${c.score.toFixed(2)}`];
  if (c.fills.length) parts.push(`fills ${c.fills.map((d) => DIMENSION_LABEL[d].toLowerCase()).join(", ")}`);
  if (best) parts.push(`best matchup ${pct(best.winRate)} (${best.games} games${best.lowSample ? ", small" : ""})`);
  return `\`${parts.join(" · ")}\``;
}

/** Allies/enemies, profile bars, needs and vulnerabilities: shared by /dota draft and team analysis. */
function teamEmbed(title: string, t: Pick<TeamsAnalysis, "allies" | "enemies" | "enemyVulnerabilities">): EmbedBuilder {
  const team = new EmbedBuilder().setTitle(title).setColor(COLOR.info);
  team.addFields(field("Allies", names(t.allies.heroes), true), field("Enemies", names(t.enemies.heroes), true));
  if (t.allies.heroes.length) team.addFields(field("Your team profile", profileBlock(t.allies.profile)));
  team.addFields(
    field("Your strengths", t.allies.strengths.map((s) => DIMENSION_LABEL[s]).join(", ") || "none yet"),
    field(
      "Your team needs",
      t.allies.weaknesses.length
        ? bullets(t.allies.weaknesses.slice(0, 6).map((w) => `${DIMENSION_LABEL[w.dimension]}${w.because ? ` — ${w.because}` : ""}`))
        : "No major gaps detected",
    ),
  );
  if (t.enemies.heroes.length) {
    team.addFields(
      field("Enemy strengths", t.enemies.strengths.map((s) => DIMENSION_LABEL[s]).join(", ") || "none notable"),
      field("Enemy lineup is weak to", t.enemyVulnerabilities.slice(0, 6).map((v) => `${TRAIT_LABEL[v.trait]} (${v.count})`).join(", ") || "n/a"),
    );
  }
  return team;
}

export function renderTeams(result: Explained<TeamsAnalysis, never>): ReplyPayload {
  const t = result.analysis;
  const embed = teamEmbed("Team analysis", t);
  if (t.allyVulnerabilities.length) {
    embed.addFields(field("Your lineup is weak to", t.allyVulnerabilities.slice(0, 6).map((v) => `${TRAIT_LABEL[v.trait]} (${v.count})`).join(", ")));
  }
  embed.setFooter({ text: provenanceFooter({ sources: t.sources, patch: result.patch, extra: `hero traits: curated ${KNOWLEDGE_VERSION}`, aiNote: result.aiNote }) });
  return { embeds: fitEmbeds([embed]), components: [] };
}

export function renderDraft(result: Explained<DraftAnalysis, DraftExplanation>, aiModel: string | null): ReplyPayload {
  const { analysis: d, explanation: e } = result;
  const title = `Draft analysis — ${POSITION_LABEL[d.position]}${d.bracket ? ` · ${bracketLabel(d.bracket)}` : ""}`;
  const team = teamEmbed(title, d);
  if (e) team.setDescription(clip(e.summary, 4096));

  const picks = new EmbedBuilder().setTitle("Recommended picks").setColor(COLOR.good);
  if (!d.candidates.length) picks.setDescription("No heroes left that play this position.");
  const why = new Map(e?.picks.map((p) => [p.hero, p]) ?? []);
  d.candidates.slice(0, DRAFT_EXPLAIN_COUNT).forEach((c, i) => {
    const ai = why.get(c.hero.localizedName);
    const text = ai
      ? `${ai.why}\n*Tradeoff:* ${ai.tradeoff}`
      : c.reasons.filter((r) => r.type !== "meta" && r.type !== "role_fit").map((r) => r.description).join("; ") || "Fits the position.";
    picks.addFields(field(`${i + 1}. ${c.hero.localizedName}`, `${clip(text, 800)}\n${dataLine(c)}`));
  });
  const rest = d.candidates.slice(DRAFT_EXPLAIN_COUNT, 10);
  if (rest.length) picks.addFields(field("Also consider", rest.map((c) => `${c.hero.localizedName} (${c.score.toFixed(2)})`).join(", ")));
  if (e?.gamePlan.length) picks.addFields(field("Game plan", bullets(e.gamePlan)));
  picks.setFooter({
    text: provenanceFooter({
      sources: d.sources,
      patch: result.patch,
      extra: `hero traits: curated ${KNOWLEDGE_VERSION}`,
      aiModel: e ? aiModel : null,
      aiNote: result.aiNote,
    }),
  });

  const components: ReplyPayload["components"] = [];
  const alternatives = d.candidates.slice(1, 10);
  if (alternatives.length) {
    const menu = new StringSelectMenuBuilder()
      .setCustomId(customId.draftWhyNot(d.position, d.bracket, d.allies.heroes.map((h) => h.id), d.enemies.heroes.map((h) => h.id)))
      .setPlaceholder(`Why not…? Compare with ${d.candidates[0]!.hero.localizedName}`)
      .addOptions(
        alternatives.map((c, i) => ({
          label: `${c.hero.localizedName}`,
          description: `Ranked #${i + 2} · score ${c.score.toFixed(2)}`,
          value: String(c.hero.id),
        })),
      );
    components.push(new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(menu));
  }

  return { embeds: fitEmbeds([team, picks]), components };
}

export function renderWhyNot(
  result: { alternative: DraftCandidate; rank: number; top: DraftCandidate } & Explained<DraftAnalysis, WhyNotExplanation>,
  aiModel: string | null,
): ReplyPayload {
  const { alternative: alt, top, rank, explanation: e } = result;
  const embed = new EmbedBuilder().setTitle(`Why not ${alt.hero.localizedName}? (ranked #${rank})`).setColor(COLOR.warn);
  if (alt.hero.iconUrl) embed.setThumbnail(alt.hero.imageUrl ?? alt.hero.iconUrl);
  if (e) embed.setDescription(clip(e.verdict, 4096));

  const keys = Object.keys({ ...top.components, ...alt.components });
  const rows = keys.map((k) => `${k.padEnd(14)} ${(alt.components[k] ?? 0).toFixed(2).padStart(5)}  ${(top.components[k] ?? 0).toFixed(2).padStart(5)}`);
  const header = `${"".padEnd(14)} ${alt.hero.localizedName.slice(0, 5).padStart(5)}  ${top.hero.localizedName.slice(0, 5).padStart(5)}`;
  const total = `${"total".padEnd(14)} ${alt.score.toFixed(2).padStart(5)}  ${top.score.toFixed(2).padStart(5)}`;
  embed.addFields(field(`Scores: ${alt.hero.localizedName} vs ${top.hero.localizedName}`, "```\n" + [header, ...rows, total].join("\n") + "\n```"));

  if (e) {
    embed.addFields(field(`Compared with ${top.hero.localizedName}`, bullets(e.comparison)), field("When it's the better pick", e.whenToPick));
  } else {
    embed.addFields(field("Reasons", bullets(alt.reasons.map((r) => r.description))));
  }
  embed.setFooter({ text: provenanceFooter({ sources: result.analysis.sources, patch: result.patch, aiModel: e ? aiModel : null, aiNote: result.aiNote }) });
  return { embeds: fitEmbeds([embed]), components: [] };
}
