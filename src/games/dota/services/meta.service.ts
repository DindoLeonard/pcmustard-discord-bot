import type { DataSource } from "../../types/game.js";
import { getKnowledge } from "../knowledge/heroTraits.js";
import type { Position } from "../knowledge/traits.js";
import type { DotaHero } from "../providers/dota.provider.js";
import type { HeroesService } from "./heroes.service.js";
import { adjustedWinRate, roleFit, round } from "./scoring.service.js";

/** Win rates are shrunk toward 50% with this many pseudo-games, so rarely picked heroes don't top the list. */
export const META_PRIOR_GAMES = 300;
/** A hero must appear in at least this share of matches to count as "strong in the meta". */
export const META_MIN_PICK_RATE = 0.01;

export interface MetaHero {
  hero: DotaHero;
  picks: number;
  wins: number;
  winRate: number;
  adjustedWinRate: number;
  /** Share of matches the hero appears in (10 heroes per match). */
  pickRate: number;
  proPicks: number;
  proBans: number;
  /** 1 = main position, 0.8/0.6 = secondary, undefined when no position filter. */
  positionFit?: number;
}

export interface MetaAnalysis {
  position?: Position;
  bracket?: number;
  /** "all public games" or "bracket N". */
  scope: string;
  matches: number;
  strongest: MetaHero[];
  popular: MetaHero[];
  pro: MetaHero[];
  sources: DataSource[];
}

export interface MetaOptions {
  position?: Position;
  bracket?: number;
  limit?: number;
}

/** Pure: rank heroes for the current patch from OpenDota hero stats. */
export function computeMeta(heroes: DotaHero[], options: MetaOptions = {}): Omit<MetaAnalysis, "sources"> {
  const { position, bracket, limit = 10 } = options;
  const statsFor = (h: DotaHero) => {
    if (!bracket) return { picks: h.stats.pubPicks, wins: h.stats.pubWins };
    const b = h.stats.brackets.find((x) => x.bracket === bracket);
    return { picks: b?.picks ?? 0, wins: b?.wins ?? 0 };
  };
  const totalPicks = heroes.reduce((n, h) => n + statsFor(h).picks, 0);
  const matches = Math.round(totalPicks / 10);

  const rows: MetaHero[] = [];
  for (const hero of heroes) {
    const { picks, wins } = statsFor(hero);
    const fit = position ? roleFit(getKnowledge(hero.localizedName), position) : undefined;
    if (fit === 0) continue;
    rows.push({
      hero,
      picks,
      wins,
      winRate: picks ? wins / picks : 0,
      adjustedWinRate: adjustedWinRate(wins, picks, META_PRIOR_GAMES),
      pickRate: matches ? picks / matches : 0,
      proPicks: hero.stats.proPicks,
      proBans: hero.stats.proBans,
      positionFit: fit,
    });
  }

  const strongest = rows
    .filter((r) => r.pickRate >= META_MIN_PICK_RATE)
    .sort((a, b) => b.adjustedWinRate - a.adjustedWinRate)
    .slice(0, limit);
  const popular = [...rows].sort((a, b) => b.pickRate - a.pickRate).slice(0, limit);
  const pro = [...rows]
    .filter((r) => r.proPicks + r.proBans > 0)
    .sort((a, b) => b.proPicks + b.proBans - (a.proPicks + a.proBans))
    .slice(0, Math.min(limit, 5));

  return {
    position,
    bracket,
    scope: bracket ? `bracket ${bracket}` : "all public games",
    matches,
    strongest: strongest.map(roundRow),
    popular: popular.map(roundRow),
    pro: pro.map(roundRow),
  };
}

function roundRow(r: MetaHero): MetaHero {
  return { ...r, winRate: round(r.winRate, 4), adjustedWinRate: round(r.adjustedWinRate, 4), pickRate: round(r.pickRate, 4) };
}

export class MetaService {
  constructor(private readonly heroes: HeroesService) {}

  async analyze(options: MetaOptions = {}): Promise<MetaAnalysis> {
    const all = await this.heroes.list();
    return { ...computeMeta(all.data, options), sources: [{ source: all.source, fetchedAt: all.fetchedAt, patch: all.patch }] };
  }
}
