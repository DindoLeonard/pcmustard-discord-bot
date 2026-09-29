import { z } from "zod";
import { POSITION_LABEL } from "../../games/dota/knowledge/traits.js";
import type { DotaAbility } from "../../games/dota/providers/dota.provider.js";
import type { CounterAnalysis } from "../../games/dota/types.js";
import type { AIRequest } from "../types.js";
import { DOTA_ANALYST_SYSTEM, abilityBlock, componentsLine, knowledgeBlock, reasonsBlock, traitList } from "./shared.js";

export const counterExplanationSchema = z.object({
  picks: z
    .array(z.object({ hero: z.string(), why: z.string().describe("1-2 sentences on the mechanics behind the counter") }))
    .describe("One entry per candidate, same order as CONTEXT"),
  strategy: z.array(z.string()).describe("2-4 general ways to play against the target"),
  items: z.array(z.object({ name: z.string().describe("Exact Dota 2 item name"), why: z.string() })).describe("2-4 items that are good against the target"),
});

export type CounterExplanation = z.infer<typeof counterExplanationSchema>;

export interface CounterPromptInput {
  analysis: CounterAnalysis;
  explainCount: number;
  patch?: string;
  targetAbilities: DotaAbility[];
  /** heroId -> ability names, for candidates being explained */
  candidateAbilities: Map<number, string[]>;
}

export function counterContext({ analysis, explainCount, patch, targetAbilities, candidateAbilities }: CounterPromptInput): string {
  const picks = analysis.candidates.slice(0, explainCount);
  const target = analysis.target.localizedName;
  return [
    `CURRENT PATCH: ${patch ?? "unknown"}`,
    `TARGET HERO`,
    knowledgeBlock(target, analysis.targetKnowledge),
    abilityBlock(target, targetAbilities),
    `POSITION REQUESTED: ${analysis.position ? POSITION_LABEL[analysis.position] : "any"}`,
    ``,
    `RANKED COUNTER CANDIDATES (computed by the scoring engine; statistics from OpenDota):`,
    ...picks.map((c, i) =>
      [
        `${i + 1}. ${c.hero.localizedName} - score ${c.score.toFixed(2)} (${componentsLine(c.components)})`,
        `    provides: ${traitList(c.knowledge?.provides)}`,
        `    abilities: ${candidateAbilities.get(c.hero.id)?.join(", ") || "unavailable"}`,
        reasonsBlock(c.reasons),
      ].join("\n"),
    ),
  ].join("\n");
}

export function counterPrompt(input: CounterPromptInput): AIRequest<CounterExplanation> {
  const target = input.analysis.target.localizedName;
  const context = counterContext(input);
  return {
    task: "counter.explain",
    schemaName: "counter_explanation",
    schema: counterExplanationSchema,
    system: DOTA_ANALYST_SYSTEM,
    user: `CONTEXT\n${context}\n\nTASK\nFor each candidate, explain in 1-2 sentences why it counters ${target}, naming specific abilities on both sides (only names from CONTEXT). Then give general strategy against ${target} and 2-4 useful items (exact item names). Do not repeat the statistics verbatim in every line; mention a number only when it strengthens the point.`,
    maxOutputTokens: 1600,
  };
}
