import { z } from "zod";
import { POSITION_LABEL } from "../../games/dota/knowledge/traits.js";
import { pct } from "../../games/dota/services/scoring.service.js";
import type { MatchupAnalysis } from "../../games/dota/types.js";
import type { AIRequest } from "../types.js";
import { DOTA_ANALYST_SYSTEM, abilityBlock, knowledgeBlock, traitList } from "./shared.js";

export const LANE_DIFFICULTIES = ["favored", "even", "difficult", "very_difficult"] as const;

export const matchupExplanationSchema = z.object({
  laneDifficulty: z.enum(LANE_DIFFICULTIES).describe("From the player's point of view"),
  summary: z.string().describe("2 sentences: who wins the lane and why"),
  keyThreats: z.array(z.string()).describe("2-4 enemy abilities/timings to respect, using ability names from CONTEXT"),
  powerSpikes: z.object({
    yours: z.array(z.string()).describe("1-3 timings/levels/items when the player is strong"),
    theirs: z.array(z.string()).describe("1-3 timings when the enemy is strong"),
  }),
  laneApproach: z.array(z.string()).describe("3-5 concrete laning instructions"),
  mistakesToAvoid: z.array(z.string()).describe("2-4 common mistakes"),
  matchupShift: z.string().describe("When and why the matchup swings toward either hero"),
  items: z.array(z.object({ name: z.string().describe("Exact Dota 2 item name"), why: z.string() })).describe("2-4 early/mid items for this matchup"),
});

export type MatchupExplanation = z.infer<typeof matchupExplanationSchema>;

export function matchupContext(a: MatchupAnalysis, patch?: string): string {
  const me = a.hero.localizedName;
  const them = a.enemy.localizedName;
  const stat = a.stat;
  const statLine =
    stat.games > 0
      ? `${me} vs ${them}: ${pct(stat.winRate)} win rate for ${me} over ${stat.games} games${stat.lowSample ? " (SMALL SAMPLE - indicative only)" : ""}`
      : `${me} vs ${them}: no head-to-head games in the data`;
  return [
    `CURRENT PATCH: ${patch ?? "unknown"}`,
    `PLAYER HERO / POSITION: ${me}, ${a.position ? POSITION_LABEL[a.position] : "position not given"}`,
    `ENEMY HERO: ${them}`,
    ``,
    `HEAD-TO-HEAD (OpenDota): ${statLine}`,
    ``,
    knowledgeBlock(me, a.heroKnowledge),
    knowledgeBlock(them, a.enemyKnowledge),
    `${me} provides things ${them} is weak to: ${traitList(a.heroExploits)}`,
    `${them} provides things ${me} is weak to: ${traitList(a.enemyExploits)}`,
    ``,
    abilityBlock(me, a.heroAbilities),
    abilityBlock(them, a.enemyAbilities),
    ``,
    `POPULAR ${me.toUpperCase()} ITEMS (OpenDota, matches purchased):`,
    `  start: ${a.popularItems.start.map((i) => `${i.name} (${i.matches})`).join(", ") || "n/a"}`,
    `  early: ${a.popularItems.early.map((i) => `${i.name} (${i.matches})`).join(", ") || "n/a"}`,
  ].join("\n");
}

export function matchupPrompt(a: MatchupAnalysis, patch?: string): AIRequest<MatchupExplanation> {
  const me = a.hero.localizedName;
  const them = a.enemy.localizedName;
  const context = matchupContext(a, patch);
  return {
    task: "matchup.explain",
    schemaName: "matchup_explanation",
    schema: matchupExplanationSchema,
    system: DOTA_ANALYST_SYSTEM,
    user: `CONTEXT\n${context}\n\nTASK\nWrite a lane guide for ${me} against ${them}. Explain the mechanics behind the matchup rather than restating the win rate. Reference abilities by their CONTEXT names. Items should fit this matchup specifically, not a generic build.`,
    maxOutputTokens: 1800,
  };
}
