import { z } from "zod";
import type { HeroKnowledge } from "../../games/dota/knowledge/heroTraits.js";
import type { DotaAbility, DotaHero } from "../../games/dota/providers/dota.provider.js";
import { pct } from "../../games/dota/services/scoring.service.js";
import type { AIRequest } from "../types.js";
import { DOTA_ANALYST_SYSTEM, abilityBlock, knowledgeBlock } from "./shared.js";

// ---------- Hero playstyle ("Explain" button on /dota hero) ----------

export const heroExplanationSchema = z.object({
  playstyle: z.string().describe("2-3 sentences: how the hero wins games"),
  strengths: z.array(z.string()).describe("2-3 bullets"),
  weaknesses: z.array(z.string()).describe("2-3 bullets"),
  tips: z.array(z.string()).describe("2-3 practical tips, referencing ability names from CONTEXT"),
});

export type HeroExplanation = z.infer<typeof heroExplanationSchema>;

export function heroContext(hero: DotaHero, knowledge: HeroKnowledge | undefined, abilities: DotaAbility[], patch?: string): string {
  const pubWr = hero.stats.pubPicks > 0 ? hero.stats.pubWins / hero.stats.pubPicks : null;
  return [
    `CURRENT PATCH: ${patch ?? "unknown"}`,
    `HERO: ${hero.localizedName} (${hero.primaryAttr}, ${hero.attackType}); roles: ${hero.roles.join(", ")}`,
    `PUBLIC WIN RATE (OpenDota): ${pct(pubWr)} over ${hero.stats.pubPicks} picks`,
    knowledgeBlock(hero.localizedName, knowledge),
    abilityBlock(hero.localizedName, abilities),
  ].join("\n");
}

export function heroPrompt(hero: DotaHero, knowledge: HeroKnowledge | undefined, abilities: DotaAbility[], patch?: string): AIRequest<HeroExplanation> {
  const context = heroContext(hero, knowledge, abilities, patch);
  return {
    task: "hero.explain",
    schemaName: "hero_explanation",
    schema: heroExplanationSchema,
    system: DOTA_ANALYST_SYSTEM,
    user: `CONTEXT\n${context}\n\nTASK\nExplain how to play ${hero.localizedName} for someone who hasn't played it much.`,
    maxOutputTokens: 900,
  };
}

// ---------- Hero name recovery (AI typo help) ----------

export function heroGuessSchema(names: [string, ...string[]]) {
  return z.object({
    matches: z.array(z.enum(names)).describe("0-3 heroes the user most likely meant, best first; empty if none fit"),
  });
}

export function heroGuessPrompt(query: string, names: [string, ...string[]]): AIRequest<{ matches: string[] }> {
  return {
    task: "hero.guess",
    schemaName: "hero_guess",
    schema: heroGuessSchema(names),
    system:
      "You map a Dota 2 player's description, nickname, misspelling or abbreviation of a hero to official hero names. Only answer with names from the allowed list.",
    user: `The user typed: "${query.slice(0, 100)}"\nWhich Dota 2 hero(es) did they most likely mean?`,
    maxOutputTokens: 400,
  };
}
