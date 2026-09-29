import type { HeroKnowledge } from "../knowledge/heroTraits.js";
import type { HeroTrait, Position } from "../knowledge/traits.js";
import type { DotaHero, HeroMatchup } from "../providers/dota.provider.js";
import type { MatchupStat } from "../types.js";

/** Pseudo-games at 50% added to every matchup, so a 7-2 record doesn't outrank 300-250. */
export const PRIOR_GAMES = 50;
export const LOW_SAMPLE_GAMES = 30;

export const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function round(n: number, digits = 2): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function adjustedWinRate(wins: number, games: number, prior = PRIOR_GAMES): number {
  return (wins + prior * 0.5) / (games + prior);
}

/** Map a win rate to 0..1 where 50% = 0.5 and ±spread saturates. */
export function winRateScore(winRate: number, spread = 0.1): number {
  return clamp01(0.5 + (winRate - 0.5) / (2 * spread));
}

/**
 * `records` are the opponent's matchups (opponent perspective). Returns `heroId`'s record
 * against that opponent, i.e. the mirror of the opponent's entry for `heroId`.
 */
export function matchupFromOpponentRecords(heroId: number, opponentId: number, records: HeroMatchup[]): MatchupStat {
  const entry = records.find((r) => r.opponentId === heroId);
  const games = entry?.games ?? 0;
  const wins = entry ? entry.games - entry.wins : 0;
  return buildMatchupStat(heroId, opponentId, wins, games);
}

/** `records` are `heroId`'s own matchups. */
export function matchupFromOwnRecords(heroId: number, opponentId: number, records: HeroMatchup[]): MatchupStat {
  const entry = records.find((r) => r.opponentId === opponentId);
  return buildMatchupStat(heroId, opponentId, entry?.wins ?? 0, entry?.games ?? 0);
}

function buildMatchupStat(heroId: number, opponentId: number, wins: number, games: number): MatchupStat {
  return {
    heroId,
    opponentId,
    games,
    wins,
    winRate: games > 0 ? wins / games : null,
    adjustedWinRate: adjustedWinRate(wins, games),
    lowSample: games < LOW_SAMPLE_GAMES,
  };
}

/** 1.0 for the hero's main position, less for secondary ones, 0 if they don't play it. */
export function roleFit(knowledge: HeroKnowledge | undefined, position: Position): number {
  const index = knowledge?.positions.indexOf(position) ?? -1;
  if (index < 0) return 0;
  return [1, 0.8, 0.6][index] ?? 0.5;
}

export function traitOverlap(provides: HeroTrait[] | undefined, weakTo: HeroTrait[] | undefined): HeroTrait[] {
  if (!provides || !weakTo) return [];
  return weakTo.filter((t) => provides.includes(t));
}

/** Share of the target's weaknesses the candidate provides (0..1). */
export function exploitScore(provides: HeroTrait[] | undefined, weakTo: HeroTrait[] | undefined): number {
  if (!weakTo?.length) return 0;
  return traitOverlap(provides, weakTo).length / weakTo.length;
}

/** Win rate for the meta component: bracket win rate if requested and sampled, else all public games. */
export function metaWinRate(hero: DotaHero, bracket?: number): { winRate: number; picks: number; scope: string } {
  const b = bracket ? hero.stats.brackets.find((x) => x.bracket === bracket) : undefined;
  if (b && b.picks > 0) return { winRate: b.wins / b.picks, picks: b.picks, scope: `bracket ${bracket}` };
  const picks = hero.stats.pubPicks;
  return { winRate: picks > 0 ? hero.stats.pubWins / picks : 0.5, picks, scope: "all public games" };
}

export function metaScore(hero: DotaHero, bracket?: number): number {
  return winRateScore(metaWinRate(hero, bracket).winRate, 0.05);
}

/** Weighted sum normalized by the weights actually in play (components may be absent). */
export function weightedScore(components: Record<string, number>, weights: Record<string, number>): number {
  let total = 0;
  let weightSum = 0;
  for (const [k, w] of Object.entries(weights)) {
    if (components[k] === undefined) continue;
    total += components[k]! * w;
    weightSum += w;
  }
  return weightSum > 0 ? total / weightSum : 0;
}

export function pct(n: number | null, digits = 1): string {
  return n === null ? "n/a" : `${(n * 100).toFixed(digits)}%`;
}
