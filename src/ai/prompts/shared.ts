import type { HeroKnowledge } from "../../games/dota/knowledge/heroTraits.js";
import { TRAIT_LABEL } from "../../games/dota/knowledge/traits.js";
import type { DotaAbility } from "../../games/dota/providers/dota.provider.js";
import type { RecommendationReason } from "../../games/dota/types.js";

export const DOTA_ANALYST_SYSTEM = `You are a Dota 2 strategy analyst writing for a Discord bot.

Rules:
- Never invent statistics. Do not state win rates, pick rates, game counts or percentages unless they appear in CONTEXT, and quote them exactly.
- If CONTEXT marks data as a small sample or missing, say the numbers are only indicative.
- Only refer to abilities by the names listed in CONTEXT. Do not invent ability numbers (damage, durations) beyond cooldowns given in CONTEXT.
- The recommendations and their ranking were computed by a scoring engine; explain them, do not re-rank or add heroes that are not listed.
- Mechanics knowledge (how spells interact, timings, lane play, itemization) is allowed and expected; keep it accurate for the current patch and avoid claims you are unsure of.
- Be concise and concrete. Plain sentences, no markdown headings, no emojis. Each string should read well as a Discord bullet.`;

export function traitList(traits: readonly string[] | undefined): string {
  return traits?.length ? traits.map((t) => TRAIT_LABEL[t as keyof typeof TRAIT_LABEL] ?? t).join(", ") : "none recorded";
}

export function knowledgeBlock(name: string, k: HeroKnowledge | undefined): string {
  if (!k) return `${name}: no curated trait data`;
  return `${name}\n  positions: ${k.positions.join(", ")}\n  provides: ${traitList(k.provides)}\n  weak to: ${traitList(k.weakTo)}`;
}

export function abilityBlock(name: string, abilities: DotaAbility[]): string {
  if (!abilities.length) return `${name} abilities: unavailable`;
  const lines = abilities.map((a) => {
    const bits = [a.isInnate ? "innate" : undefined, a.damageType, a.cooldown ? `cooldown ${a.cooldown.join("/")}s` : undefined]
      .filter(Boolean)
      .join(", ");
    const desc = a.description ? ` - ${a.description.replace(/\s+/g, " ").slice(0, 220)}` : "";
    return `  - ${a.name}${bits ? ` (${bits})` : ""}${desc}`;
  });
  return `${name} abilities (from OpenDota):\n${lines.join("\n")}`;
}

export function reasonsBlock(reasons: RecommendationReason[]): string {
  return reasons.map((r) => `    - [${r.type}] ${r.description}`).join("\n");
}

export function componentsLine(components: Record<string, number>): string {
  return Object.entries(components)
    .map(([k, v]) => `${k} ${v.toFixed(2)}`)
    .join(", ");
}
