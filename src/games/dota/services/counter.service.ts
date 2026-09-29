import { getKnowledge } from "../knowledge/heroTraits.js";
import { POSITION_LABEL, TRAIT_LABEL, type Position } from "../knowledge/traits.js";
import type { DotaDataProvider, DotaHero } from "../providers/dota.provider.js";
import type { CounterAnalysis, CounterCandidate, RecommendationReason } from "../types.js";
import type { HeroesService } from "./heroes.service.js";
import {
  exploitScore,
  matchupFromOpponentRecords,
  metaScore,
  metaWinRate,
  pct,
  roleFit,
  round,
  traitOverlap,
  weightedScore,
  winRateScore,
} from "./scoring.service.js";

export const COUNTER_WEIGHTS = { matchup: 0.45, traits: 0.3, roleFit: 0.15, meta: 0.1 };

export interface CounterOptions {
  position?: Position;
  bracket?: number;
  limit?: number;
}

export class CounterService {
  constructor(
    private readonly provider: DotaDataProvider,
    private readonly heroes: HeroesService,
  ) {}

  async analyze(heroQuery: string, options: CounterOptions = {}): Promise<CounterAnalysis> {
    const { hero: targetSourced } = await this.heroes.resolve(heroQuery);
    const target = targetSourced.data;
    const [all, matchups] = await Promise.all([this.heroes.list(), this.provider.getHeroMatchups(target.id)]);
    const candidates = scoreCounters(target, all.data, matchups.data, options);
    return {
      target,
      targetKnowledge: getKnowledge(target.localizedName),
      position: options.position,
      candidates: candidates.slice(0, options.limit ?? 10),
      sources: [
        { source: all.source, fetchedAt: all.fetchedAt, patch: all.patch },
        { source: matchups.source, fetchedAt: matchups.fetchedAt, patch: matchups.patch },
      ],
      generatedAt: new Date(),
    };
  }
}

/** Pure scoring: rank every hero as a counter to `target`. `targetMatchups` are the target's own records. */
export function scoreCounters(
  target: DotaHero,
  heroes: DotaHero[],
  targetMatchups: Parameters<typeof matchupFromOpponentRecords>[2],
  options: CounterOptions = {},
): CounterCandidate[] {
  const targetKnowledge = getKnowledge(target.localizedName);
  const out: CounterCandidate[] = [];

  for (const hero of heroes) {
    if (hero.id === target.id) continue;
    const knowledge = getKnowledge(hero.localizedName);
    const fit = options.position ? roleFit(knowledge, options.position) : undefined;
    if (fit === 0) continue;

    // Mirror the target's record: target's losses vs `hero` are `hero`'s wins.
    const matchup = matchupFromOpponentRecords(hero.id, target.id, targetMatchups);
    const exploits = traitOverlap(knowledge?.provides, targetKnowledge?.weakTo);
    const components: Record<string, number> = {
      matchup: winRateScore(matchup.adjustedWinRate),
      traits: exploitScore(knowledge?.provides, targetKnowledge?.weakTo),
      meta: metaScore(hero, options.bracket),
    };
    if (fit !== undefined) components.roleFit = fit;
    const score = weightedScore(components, COUNTER_WEIGHTS);

    const reasons: RecommendationReason[] = [];
    reasons.push({
      type: "counter",
      description:
        matchup.games > 0
          ? `${pct(matchup.winRate)} win rate vs ${target.localizedName} over ${matchup.games} games${matchup.lowSample ? " (small sample)" : ""}`
          : `No head-to-head games vs ${target.localizedName} in the data`,
      weight: round(components.matchup! * COUNTER_WEIGHTS.matchup, 3),
    });
    if (exploits.length) {
      reasons.push({
        type: "counter",
        description: `Provides ${exploits.map((t) => TRAIT_LABEL[t]).join(", ")}, which ${target.localizedName} is weak to`,
        weight: round(components.traits! * COUNTER_WEIGHTS.traits, 3),
      });
    }
    if (fit !== undefined) {
      reasons.push({
        type: "role_fit",
        description: `${fit === 1 ? "Main" : "Secondary"} position: ${POSITION_LABEL[options.position!]}`,
        weight: round(fit * COUNTER_WEIGHTS.roleFit, 3),
      });
    }
    const meta = metaWinRate(hero, options.bracket);
    reasons.push({
      type: "meta",
      description: `${pct(meta.winRate)} win rate in ${meta.scope}`,
      weight: round(components.meta! * COUNTER_WEIGHTS.meta, 3),
    });

    out.push({ hero, knowledge, score: round(score, 3), components: roundAll(components), reasons, matchup, exploits });
  }
  return out.sort((a, b) => b.score - a.score);
}

export function roundAll(c: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, round(v, 3)]));
}
