import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type MessageActionRowComponentBuilder } from "discord.js";
import type { HeroExplanation } from "../../ai/prompts/general.prompt.js";
import type { Explained } from "../../assistant/dota.assistant.js";
import { getKnowledge } from "../../games/dota/knowledge/heroTraits.js";
import { POSITION_LABEL, TRAIT_LABEL } from "../../games/dota/knowledge/traits.js";
import type { DotaHero } from "../../games/dota/providers/dota.provider.js";
import type { DataSource, Sourced } from "../../games/types/game.js";
import { customId } from "./customIds.js";

export interface ReplyPayload {
  content?: string;
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<MessageActionRowComponentBuilder>[];
}

export const COLOR = { info: 0x5865f2, good: 0x2ecc71, warn: 0xe67e22 };

// Discord limits: field value 1024, description 4096, 25 fields, 6000 chars per message across embeds.
export const clip = (s: string, max = 1024) => (s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`);
export const bullets = (items: string[], max = 1024) => clip(items.map((i) => `• ${i}`).join("\n"), max);

export function field(name: string, value: string | undefined, inline = false) {
  return { name: clip(name, 256), value: value && value.trim() ? clip(value) : "n/a", inline };
}

function embedLength(e: EmbedBuilder): number {
  const d = e.data;
  return (
    (d.title?.length ?? 0) +
    (d.description?.length ?? 0) +
    (d.footer?.text.length ?? 0) +
    (d.fields ?? []).reduce((n, f) => n + f.name.length + f.value.length, 0)
  );
}

/** Trim trailing fields until the combined embeds fit Discord's 6000-character message cap. */
export function fitEmbeds(embeds: EmbedBuilder[], budget = 5800): EmbedBuilder[] {
  while (embeds.reduce((n, e) => n + embedLength(e), 0) > budget) {
    const last = [...embeds].reverse().find((e) => (e.data.fields?.length ?? 0) > 0);
    if (!last) break;
    last.spliceFields(-1, 1);
  }
  return embeds;
}

export function formatDate(d: Date): string {
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

/** Footer that separates data provenance from AI involvement (CLAUDE.md data accuracy rules). */
export function provenanceFooter(opts: { sources?: DataSource[]; patch?: string; aiModel?: string | null; aiNote?: string; extra?: string }): string {
  const src = opts.sources?.[0];
  const parts = [
    src ? `Stats: ${src.source} · fetched ${formatDate(src.fetchedAt)}` : undefined,
    opts.patch ? `patch ${opts.patch}` : undefined,
    opts.extra,
    opts.aiModel ? `Explanations: AI (${opts.aiModel}), grounded in the stats above` : undefined,
    opts.aiNote,
  ].filter(Boolean);
  return clip(parts.join(" · "), 2048);
}

export function pctStr(wins: number, picks: number): string {
  return picks > 0 ? `${((wins / picks) * 100).toFixed(1)}%` : "n/a";
}

export function positionSuffix(p?: keyof typeof POSITION_LABEL): string {
  return p ? ` — ${POSITION_LABEL[p]}` : "";
}

// ---------------- /dota hero ----------------

const ATTRIBUTE_LABEL: Record<DotaHero["primaryAttr"], string> = { str: "Strength", agi: "Agility", int: "Intelligence", all: "Universal" };
const ATTRIBUTE_COLOR: Record<DotaHero["primaryAttr"], number> = { str: 0xc0392b, agi: 0x27ae60, int: 0x2e86de, all: 0x8e44ad };
const BRACKET_LABEL = ["", "Herald", "Guardian", "Crusader", "Archon", "Legend", "Ancient", "Divine", "Immortal"];
export const bracketLabel = (b: number) => BRACKET_LABEL[b] ?? `bracket ${b}`;

function sourceFooter(src: DataSource): string {
  const patch = src.patch ? ` · patch ${src.patch}` : "";
  return `Source: ${src.source}${patch} · fetched ${src.fetchedAt.toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

export function renderHeroEmbed({ data: hero, ...src }: Sourced<DotaHero>): EmbedBuilder {
  const { stats } = hero;
  const bracketLines = stats.brackets
    .map((b) => `${bracketLabel(b.bracket)}: ${pctStr(b.wins, b.picks)} (${b.picks.toLocaleString("en-US")})`)
    .join("\n");
  const knowledge = getKnowledge(hero.localizedName);

  const embed = new EmbedBuilder()
    .setTitle(hero.localizedName)
    .setColor(ATTRIBUTE_COLOR[hero.primaryAttr])
    .addFields(
      { name: "Attribute", value: ATTRIBUTE_LABEL[hero.primaryAttr], inline: true },
      { name: "Attack", value: hero.attackType, inline: true },
      { name: "Roles", value: hero.roles.join(", ") || "n/a", inline: true },
      {
        name: "Public matches",
        value: `Win rate ${pctStr(stats.pubWins, stats.pubPicks)} over ${stats.pubPicks.toLocaleString("en-US")} picks`,
      },
      {
        name: "Pro matches",
        value: `${stats.proPicks} picks · ${stats.proBans} bans · win rate ${pctStr(stats.proWins, stats.proPicks)}`,
      },
    )
    .setFooter({ text: sourceFooter(src) });

  if (bracketLines) embed.addFields({ name: "Win rate by bracket (picks)", value: bracketLines });
  if (knowledge) {
    embed.addFields(
      { name: "Usual positions", value: knowledge.positions.map((p) => POSITION_LABEL[p]).join(", "), inline: false },
      { name: "Weak to", value: knowledge.weakTo.map((t) => TRAIT_LABEL[t]).join(", "), inline: false },
    );
  }
  if (hero.imageUrl) embed.setThumbnail(hero.imageUrl);
  return embed;
}

export function renderHero(hero: Sourced<DotaHero>, withExplainButton: boolean): ReplyPayload {
  const components: ReplyPayload["components"] = [];
  if (withExplainButton) {
    components.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(customId.heroExplain(hero.data.id))
          .setLabel("Explain playstyle")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(customId.heroCounters(hero.data.id))
          .setLabel(`What counters ${hero.data.localizedName}?`)
          .setStyle(ButtonStyle.Secondary),
      ),
    );
  }
  return { embeds: [renderHeroEmbed(hero)], components };
}

export function renderHeroExplanation(result: Explained<DotaHero, HeroExplanation>, aiModel: string | null): ReplyPayload {
  const hero = result.analysis;
  const e = result.explanation;
  const embed = new EmbedBuilder().setTitle(`How to play ${hero.localizedName}`).setColor(COLOR.info);
  if (hero.iconUrl) embed.setThumbnail(hero.imageUrl ?? hero.iconUrl);
  if (e) {
    embed
      .setDescription(clip(e.playstyle, 4096))
      .addFields(field("Strengths", bullets(e.strengths)), field("Weaknesses", bullets(e.weaknesses)), field("Tips", bullets(e.tips)));
  } else {
    const k = getKnowledge(hero.localizedName);
    embed.setDescription(
      k
        ? `Provides: ${k.provides.map((t) => TRAIT_LABEL[t]).join(", ")}\nWeak to: ${k.weakTo.map((t) => TRAIT_LABEL[t]).join(", ")}`
        : "No playstyle data available.",
    );
  }
  embed.setFooter({ text: provenanceFooter({ patch: result.patch, aiModel: e ? aiModel : null, aiNote: result.aiNote }) });
  return { embeds: [embed], components: [] };
}

// ---------------- errors ----------------

export function renderHeroNotFound(query: string, suggestions: string[], aiSuggestionCount = 0): string {
  const lines = [`I couldn't find the hero "${query}".`];
  if (suggestions.length) {
    lines.push("", "Did you mean:", ...suggestions.map((s, i) => `- ${s}${i < aiSuggestionCount ? " (AI guess)" : ""}`));
  }
  return lines.join("\n");
}

export const PROVIDER_UNAVAILABLE_MESSAGE =
  "Current matchup statistics are temporarily unavailable. Please try again in a moment.";

export const UNEXPECTED_ERROR_MESSAGE = "Something went wrong while handling that command.";
