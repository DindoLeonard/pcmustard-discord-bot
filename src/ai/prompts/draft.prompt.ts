import { z } from "zod";
import { POSITION_LABEL, TRAIT_LABEL } from "../../games/dota/knowledge/traits.js";
import { DIMENSION_LABEL } from "../../games/dota/services/team.service.js";
import type { DraftAnalysis, DraftCandidate, TeamAnalysis } from "../../games/dota/types.js";
import type { AIRequest } from "../types.js";
import { DOTA_ANALYST_SYSTEM, componentsLine, reasonsBlock } from "./shared.js";

export const draftExplanationSchema = z.object({
  summary: z.string().describe("2-3 sentences: what the allied draft does well and what it is missing"),
  picks: z
    .array(
      z.object({
        hero: z.string(),
        why: z.string().describe("1-2 sentences on why it fits this draft"),
        tradeoff: z.string().describe("1 sentence: the main weakness or risk of this pick"),
      }),
    )
    .describe("One entry per candidate, same order as CONTEXT"),
  gamePlan: z.array(z.string()).describe("2-3 bullets on how the completed lineup should play"),
});

export type DraftExplanation = z.infer<typeof draftExplanationSchema>;

export const whyNotSchema = z.object({
  verdict: z.string().describe("1-2 sentences: is the alternative a reasonable pick, and why it ranked lower"),
  comparison: z.array(z.string()).describe("2-4 bullets comparing the alternative to the top pick in this draft"),
  whenToPick: z.string().describe("1 sentence: situations where the alternative would be the better pick"),
});

export type WhyNotExplanation = z.infer<typeof whyNotSchema>;

export function teamBlock(label: string, team: TeamAnalysis): string {
  if (!team.heroes.length) return `${label}: (none picked yet)`;
  const profile = Object.entries(team.profile)
    .filter(([, v]) => v > 0)
    .map(([d, v]) => `${DIMENSION_LABEL[d as keyof typeof DIMENSION_LABEL]} ${Math.round(v * 10)}/10`)
    .join(", ");
  const gaps = team.weaknesses.map((w) => `${DIMENSION_LABEL[w.dimension]}${w.because ? ` (${w.because})` : ""}`).join("; ");
  return [
    `${label}: ${team.heroes.map((h) => h.localizedName).join(", ")}`,
    `  profile: ${profile || "no notable traits"}`,
    `  strengths: ${team.strengths.map((s) => DIMENSION_LABEL[s]).join(", ") || "none"}`,
    `  weaknesses: ${gaps || "none detected"}`,
  ].join("\n");
}

export function candidateBlock(c: DraftCandidate, i: number): string {
  return [
    `${i + 1}. ${c.hero.localizedName} - score ${c.score.toFixed(2)} (${componentsLine(c.components)})`,
    `    provides: ${c.knowledge?.provides.map((t) => TRAIT_LABEL[t]).join(", ") ?? "unknown"}`,
    reasonsBlock(c.reasons),
  ].join("\n");
}

export function draftContext(d: DraftAnalysis, patch?: string): string {
  return [
    `CURRENT PATCH: ${patch ?? "unknown"}`,
    `OPEN POSITION: ${POSITION_LABEL[d.position]}`,
    teamBlock("ALLIES", d.allies),
    teamBlock("ENEMIES", d.enemies),
    `ENEMY LINEUP IS WEAK TO: ${d.enemyVulnerabilities.map((v) => `${TRAIT_LABEL[v.trait]} (${v.count})`).join(", ") || "n/a"}`,
    `SCORING WEIGHTS: matchup 0.30, counterTraits 0.15, teamNeed 0.25, roleFit 0.20, meta 0.10`,
  ].join("\n");
}

export function draftPrompt(d: DraftAnalysis, explainCount: number, patch?: string): AIRequest<DraftExplanation> {
  const context = [
    draftContext(d, patch),
    ``,
    `RANKED CANDIDATES (scoring engine; statistics from OpenDota):`,
    ...d.candidates.slice(0, explainCount).map(candidateBlock),
  ].join("\n");
  return {
    task: "draft.explain",
    schemaName: "draft_explanation",
    schema: draftExplanationSchema,
    system: DOTA_ANALYST_SYSTEM,
    user: `CONTEXT\n${context}\n\nTASK\nExplain why each candidate fits this draft (team needs it fixes, enemies it handles), and its main tradeoff. Do not claim any pick is objectively the only correct one.`,
    maxOutputTokens: 1600,
  };
}

export function whyNotPrompt(d: DraftAnalysis, alternative: DraftCandidate, rank: number, patch?: string): AIRequest<WhyNotExplanation> {
  const top = d.candidates[0]!;
  const context = [
    draftContext(d, patch),
    ``,
    `TOP PICK:`,
    candidateBlock(top, 0),
    ``,
    `ALTERNATIVE THE USER ASKED ABOUT (ranked #${rank}):`,
    candidateBlock(alternative, rank - 1),
  ].join("\n");
  return {
    task: "draft.whynot",
    schemaName: "why_not",
    schema: whyNotSchema,
    system: DOTA_ANALYST_SYSTEM,
    user: `CONTEXT\n${context}\n\nTASK\nThe user asked "why not ${alternative.hero.localizedName}?". Compare it to ${top.hero.localizedName} for this draft using the scores and reasons above, and say when ${alternative.hero.localizedName} would be the better choice.`,
    maxOutputTokens: 900,
  };
}
