import { PlayerNotFoundError } from "../../../shared/errors.js";
import type { DataSource } from "../../types/game.js";
import type { DotaDataProvider, DotaHero, PlayerMatch, PlayerProfile } from "../providers/dota.provider.js";
import type { HeroesService } from "./heroes.service.js";
import { adjustedWinRate, round } from "./scoring.service.js";

/** Steam ID64 = account ID + this offset. */
const STEAM64_OFFSET = 76561197960265728n;

/**
 * Accepts what people paste: a Friend ID ("158650393"), a Steam ID64, or an OpenDota / Dotabuff / STRATZ /
 * Steam profile link containing either. Returns the 32-bit account ID, or null if nothing usable was found.
 */
export function parseAccountRef(input: string): number | null {
  const text = input.trim();
  const fromUrl = /(?:opendota\.com\/players|dotabuff\.com\/players|stratz\.com\/players|steamcommunity\.com\/profiles)\/(\d+)/i.exec(text);
  const digits = fromUrl?.[1] ?? (/^\d{1,20}$/.test(text) ? text : null);
  if (!digits) return null;
  const n = BigInt(digits);
  const id = n > STEAM64_OFFSET ? n - STEAM64_OFFSET : n;
  return id > 0n && id < 2n ** 32n ? Number(id) : null;
}

const MEDALS = ["", "Herald", "Guardian", "Crusader", "Archon", "Legend", "Ancient", "Divine", "Immortal"];

/** 45 -> "Archon 5", 80 -> "Immortal". */
export function rankLabel(rankTier: number | null, leaderboardRank?: number | null): string {
  if (!rankTier) return "Unranked";
  const medal = MEDALS[Math.floor(rankTier / 10)] ?? "Unknown";
  const stars = rankTier % 10;
  if (medal === "Immortal") return leaderboardRank ? `Immortal (#${leaderboardRank})` : "Immortal";
  return stars ? `${medal} ${stars}` : medal;
}

export interface PlayerHeroSummary {
  hero: DotaHero;
  games: number;
  wins: number;
  winRate: number;
  lastPlayed: number;
}

export interface LikelyPick {
  hero: DotaHero;
  /** 0..1 relative likelihood (not a probability). */
  score: number;
  recentGames: number;
  allTimeGames: number;
  allTimeWinRate: number | null;
  reasons: string[];
}

export interface PlayerAnalysis {
  profile: PlayerProfile;
  rank: string;
  wins: number;
  losses: number;
  topHeroes: PlayerHeroSummary[];
  recent: (PlayerMatch & { hero?: DotaHero })[];
  likelyPicks: LikelyPick[];
  profileUrl: string;
  sources: DataSource[];
}

/** Weights for "what will they pick next": recent form matters more than all-time totals. */
export const LIKELY_WEIGHTS = { recent: 0.6, allTime: 0.4 };

/**
 * Pure: rank heroes by how likely the player is to pick them next. Recent share of their last matches is weighted
 * above all-time share; heroes not played in ~6 months get their all-time share discounted.
 */
export function likelyPicks(
  heroes: { heroId: number; games: number; wins: number; lastPlayed: number }[],
  recent: PlayerMatch[],
  byId: Map<number, DotaHero>,
  nowSec = Date.now() / 1000,
  limit = 5,
): LikelyPick[] {
  const total = heroes.reduce((n, h) => n + h.games, 0);
  const recentCounts = new Map<number, number>();
  for (const m of recent) recentCounts.set(m.heroId, (recentCounts.get(m.heroId) ?? 0) + 1);
  const ids = new Set([...heroes.map((h) => h.heroId), ...recentCounts.keys()]);

  const picks: LikelyPick[] = [];
  for (const id of ids) {
    const hero = byId.get(id);
    if (!hero) continue;
    const stat = heroes.find((h) => h.heroId === id);
    const recentGames = recentCounts.get(id) ?? 0;
    const allTimeGames = stat?.games ?? 0;
    const ageDays = stat?.lastPlayed ? (nowSec - stat.lastPlayed) / 86400 : Infinity;
    const staleness = ageDays <= 60 ? 1 : ageDays <= 180 ? 0.6 : 0.3;
    const recentShare = recent.length ? recentGames / recent.length : 0;
    const allTimeShare = total ? (allTimeGames / total) * staleness : 0;
    const score = recentShare * LIKELY_WEIGHTS.recent + allTimeShare * LIKELY_WEIGHTS.allTime;
    if (score <= 0) continue;

    const reasons: string[] = [];
    if (recentGames) reasons.push(`${recentGames} of last ${recent.length} matches`);
    if (allTimeGames) reasons.push(`${allTimeGames} games all-time, ${Math.round(((stat!.wins ?? 0) / allTimeGames) * 100)}% win`);
    if (allTimeGames && ageDays > 180) reasons.push("not played in 6+ months");
    picks.push({
      hero,
      score,
      recentGames,
      allTimeGames,
      allTimeWinRate: allTimeGames ? stat!.wins / allTimeGames : null,
      reasons,
    });
  }
  picks.sort((a, b) => b.score - a.score);
  const top = picks[0]?.score ?? 1;
  return picks.slice(0, limit).map((p) => ({ ...p, score: round(p.score / top, 2) }));
}

/** How strongly to ban a hero from this player: likely to be picked AND they win with it. */
export function banValue(p: LikelyPick): number {
  const wr = p.allTimeGames ? adjustedWinRate(Math.round((p.allTimeWinRate ?? 0.5) * p.allTimeGames), p.allTimeGames, 20) : 0.5;
  return p.score * (0.5 + wr);
}

export class PlayerService {
  constructor(
    private readonly provider: DotaDataProvider,
    private readonly heroes: HeroesService,
  ) {}

  async analyze(accountRef: string | number): Promise<PlayerAnalysis> {
    const accountId = typeof accountRef === "number" ? accountRef : parseAccountRef(accountRef);
    if (!accountId) throw new PlayerNotFoundError(String(accountRef));

    const profile = await this.provider.getPlayer(accountId);
    const [wl, heroStats, recent, all] = await Promise.all([
      this.provider.getPlayerWinLoss(accountId),
      this.provider.getPlayerHeroes(accountId),
      this.provider.getPlayerRecentMatches(accountId),
      this.heroes.list(),
    ]);
    if (!heroStats.data.length && !recent.data.length) throw new PlayerNotFoundError(String(accountId), "no_data");

    const byId = new Map(all.data.map((h) => [h.id, h]));
    const topHeroes = [...heroStats.data]
      .sort((a, b) => b.games - a.games)
      .slice(0, 8)
      .flatMap((h) => {
        const hero = byId.get(h.heroId);
        return hero ? [{ hero, games: h.games, wins: h.wins, winRate: h.wins / h.games, lastPlayed: h.lastPlayed }] : [];
      });

    return {
      profile: profile.data,
      rank: rankLabel(profile.data.rankTier, profile.data.leaderboardRank),
      wins: wl.data.wins,
      losses: wl.data.losses,
      topHeroes,
      recent: recent.data.map((m) => ({ ...m, hero: byId.get(m.heroId) })),
      likelyPicks: likelyPicks(heroStats.data, recent.data, byId),
      profileUrl: `https://www.opendota.com/players/${accountId}`,
      sources: [{ source: profile.source, fetchedAt: recent.fetchedAt }],
    };
  }
}
