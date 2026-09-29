import { InvalidDraftError } from "../../../shared/errors.js";
import { getKnowledge } from "../knowledge/heroTraits.js";
import { POSITION_LABEL, TRAIT_LABEL } from "../knowledge/traits.js";
import type { DotaDataProvider, DotaHero, HeroMatchup } from "../providers/dota.provider.js";
import type { DraftAnalysis, DraftCandidate, DraftInput, ProfileDimension, RecommendationReason, TeamAnalysis, TeamsAnalysis } from "../types.js";
import { roundAll } from "./counter.service.js";
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
import { DIMENSION_LABEL, aggregateWeakTo, analyzeTeam, traitContribution } from "./team.service.js";

/** matchup + counterTraits measure "vs enemies"; teamNeed is "fixes our gaps"; see CLAUDE.md. */
export const DRAFT_WEIGHTS = { matchup: 0.3, counterTraits: 0.15, teamNeed: 0.25, roleFit: 0.2, meta: 0.1 };

export const MAX_ALLIES = 4;
export const MAX_ENEMIES = 5;

export class DraftService {
  constructor(
    private readonly provider: DotaDataProvider,
    private readonly heroes: HeroesService,
  ) {}

  async analyze(input: DraftInput, limit = 10): Promise<DraftAnalysis> {
    const [allies, enemies] = await Promise.all([this.resolveAll(input.allies), this.resolveAll(input.enemies)]);
    validateDraft(allies, enemies);

    const [all, enemyMatchups] = await Promise.all([
      this.heroes.list(),
      Promise.all(enemies.map((e) => this.provider.getHeroMatchups(e.id))),
    ]);
    const matchupsByEnemy = new Map(enemies.map((e, i) => [e.id, enemyMatchups[i]!.data]));
    const analysis = scoreDraft(input, allies, enemies, all.data, matchupsByEnemy);
    return {
      ...analysis,
      candidates: analysis.candidates.slice(0, limit),
      sources: [
        { source: all.source, fetchedAt: all.fetchedAt, patch: all.patch },
        ...enemyMatchups.slice(0, 1).map((m) => ({ source: m.source, fetchedAt: m.fetchedAt, patch: m.patch })),
      ],
    };
  }

  /** Lineup analysis without pick candidates: "what are we missing?", "how should we adjust?". */
  async analyzeTeams(input: Pick<DraftInput, "allies" | "enemies">): Promise<TeamsAnalysis> {
    const [allies, enemies] = await Promise.all([this.resolveAll(input.allies), this.resolveAll(input.enemies)]);
    validateDraft(allies, enemies);
    const all = await this.heroes.list();
    return {
      allies: analyzeTeam(allies, enemies),
      enemies: analyzeTeam(enemies, allies),
      enemyVulnerabilities: aggregateWeakTo(enemies),
      allyVulnerabilities: aggregateWeakTo(allies),
      sources: [{ source: all.source, fetchedAt: all.fetchedAt, patch: all.patch }],
      generatedAt: new Date(),
    };
  }

  private async resolveAll(queries: string[]): Promise<DotaHero[]> {
    return Promise.all(queries.filter((q) => q.trim()).map(async (q) => (await this.heroes.resolve(q)).hero.data));
  }
}

export function validateDraft(allies: DotaHero[], enemies: DotaHero[]): void {
  if (allies.length > MAX_ALLIES) throw new InvalidDraftError(`You can list at most ${MAX_ALLIES} allies (you are the 5th pick).`);
  if (enemies.length > MAX_ENEMIES) throw new InvalidDraftError(`You can list at most ${MAX_ENEMIES} enemies.`);
  if (allies.length + enemies.length === 0) throw new InvalidDraftError("Add at least one allied or enemy hero.");
  const dupes = (list: DotaHero[]) => list.filter((h, i) => list.findIndex((x) => x.id === h.id) !== i);
  const within = [...dupes(allies), ...dupes(enemies)];
  if (within.length) throw new InvalidDraftError(`${within[0]!.localizedName} is listed twice.`);
  const both = allies.find((a) => enemies.some((e) => e.id === a.id));
  if (both) throw new InvalidDraftError(`The same hero cannot appear on both teams (${both.localizedName}).`);
}

/** Pure scoring: rank every legal hero for the open position. */
export function scoreDraft(
  input: DraftInput,
  allies: DotaHero[],
  enemies: DotaHero[],
  pool: DotaHero[],
  enemyMatchups: Map<number, HeroMatchup[]>,
): Omit<DraftAnalysis, "sources"> {
  const allyTeam = analyzeTeam(allies, enemies);
  const enemyTeam = analyzeTeam(enemies, allies);
  const taken = new Set([...allies, ...enemies].map((h) => h.id));
  const candidates: DraftCandidate[] = [];

  for (const hero of pool) {
    if (taken.has(hero.id)) continue;
    const knowledge = getKnowledge(hero.localizedName);
    const fit = roleFit(knowledge, input.position);
    if (fit === 0) continue;

    const matchups = enemies.map((e) => matchupFromOpponentRecords(hero.id, e.id, enemyMatchups.get(e.id) ?? []));
    const exploits = enemies
      .map((e) => ({ enemy: e.localizedName, traits: traitOverlap(knowledge?.provides, getKnowledge(e.localizedName)?.weakTo) }))
      .filter((x) => x.traits.length > 0);
    const need = teamNeedScore(allyTeam, knowledge?.provides ?? []);

    const components: Record<string, number> = {
      teamNeed: need.score,
      roleFit: fit,
      meta: metaScore(hero, input.bracket),
    };
    if (enemies.length) {
      components.matchup = avg(matchups.map((m) => winRateScore(m.adjustedWinRate)));
      components.counterTraits = avg(enemies.map((e) => exploitScore(knowledge?.provides, getKnowledge(e.localizedName)?.weakTo)));
    }
    const score = weightedScore(components, DRAFT_WEIGHTS);

    const reasons: RecommendationReason[] = [];
    if (enemies.length) {
      const best = [...matchups].sort((a, b) => b.adjustedWinRate - a.adjustedWinRate)[0]!;
      const bestEnemy = enemies.find((e) => e.id === best.opponentId)!;
      reasons.push({
        type: "counter",
        description:
          best.games > 0
            ? `Best matchup: ${pct(best.winRate)} vs ${bestEnemy.localizedName} over ${best.games} games${best.lowSample ? " (small sample)" : ""}`
            : "No head-to-head data vs the enemy lineup",
        weight: round(components.matchup! * DRAFT_WEIGHTS.matchup, 3),
      });
      if (exploits.length) {
        reasons.push({
          type: "counter",
          description: exploits.map((x) => `${x.traits.map((t) => TRAIT_LABEL[t]).join("/")} vs ${x.enemy}`).join("; "),
          weight: round(components.counterTraits! * DRAFT_WEIGHTS.counterTraits, 3),
        });
      }
    }
    if (need.fills.length) {
      reasons.push({
        type: "team_need",
        description: `Adds ${need.fills.map((d) => DIMENSION_LABEL[d].toLowerCase()).join(", ")}, which your team lacks`,
        weight: round(need.score * DRAFT_WEIGHTS.teamNeed, 3),
      });
    }
    reasons.push({
      type: "role_fit",
      description: `${fit === 1 ? "Main" : "Secondary"} position: ${POSITION_LABEL[input.position]}`,
      weight: round(fit * DRAFT_WEIGHTS.roleFit, 3),
    });
    const meta = metaWinRate(hero, input.bracket);
    reasons.push({ type: "meta", description: `${pct(meta.winRate)} win rate in ${meta.scope}`, weight: round(components.meta! * DRAFT_WEIGHTS.meta, 3) });

    candidates.push({
      hero,
      knowledge,
      score: round(score, 3),
      components: roundAll(components),
      reasons,
      matchups,
      fills: need.fills,
      exploits,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return {
    position: input.position,
    bracket: input.bracket,
    allies: allyTeam,
    enemies: enemyTeam,
    enemyVulnerabilities: aggregateWeakTo(enemies),
    candidates,
    generatedAt: new Date(),
  };
}

/** How much of the team's weighted gap this hero's traits would close (0..1). */
export function teamNeedScore(team: TeamAnalysis, provides: Parameters<typeof traitContribution>[0]): { score: number; fills: ProfileDimension[] } {
  if (!team.weaknesses.length) return { score: 0.5, fills: [] };
  const contribution = traitContribution(provides);
  let closed = 0;
  let total = 0;
  const fills: ProfileDimension[] = [];
  for (const need of team.weaknesses) {
    const gap = 1 - need.value;
    const add = Math.min(gap, contribution[need.dimension] / 2);
    total += gap * need.importance;
    closed += add * need.importance;
    if (add > 0) fills.push(need.dimension);
  }
  return { score: total > 0 ? Math.min(1, (closed / total) * 2.5) : 0, fills };
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
