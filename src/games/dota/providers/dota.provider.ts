import type { Sourced } from "../../types/game.js";

export type PrimaryAttribute = "str" | "agi" | "int" | "all";

export interface BracketStat {
  /** 1 = Herald ... 8 = Immortal */
  bracket: number;
  picks: number;
  wins: number;
}

export interface DotaHero {
  id: number;
  /** Internal name, e.g. npc_dota_hero_puck */
  name: string;
  localizedName: string;
  primaryAttr: PrimaryAttribute;
  attackType: "Melee" | "Ranged";
  roles: string[];
  imageUrl?: string;
  iconUrl?: string;
  stats: {
    pubPicks: number;
    pubWins: number;
    proPicks: number;
    proWins: number;
    proBans: number;
    brackets: BracketStat[];
  };
}

/** Results of `heroId` against one opponent, from `heroId`'s perspective. */
export interface HeroMatchup {
  opponentId: number;
  games: number;
  wins: number;
}

export interface PatchInfo {
  name: string;
  date: Date;
}

export interface DotaItem {
  id: number;
  key: string;
  name: string;
  cost: number;
}

export type ItemPhase = "start" | "early" | "mid" | "late";

/** item id -> number of matches it was bought in that phase */
export type ItemPopularity = Record<ItemPhase, Record<number, number>>;

export interface DotaAbility {
  key: string;
  name: string;
  description?: string;
  damageType?: string;
  /** Raw OpenDota value, e.g. "Yes", "No", "Allies Yes Enemies No" */
  piercesSpellImmunity?: string;
  isInnate: boolean;
  /** Cooldown per level in seconds, as published by OpenDota (e.g. ["20","18","16","14"]). */
  cooldown?: string[];
  manaCost?: string[];
}

export interface PlayerProfile {
  accountId: number;
  name: string | null;
  avatarUrl?: string;
  /** OpenDota rank_tier: tens digit = medal (1 Herald … 8 Immortal), ones digit = stars. */
  rankTier: number | null;
  leaderboardRank: number | null;
  plus: boolean;
}

export interface PlayerHeroStat {
  heroId: number;
  games: number;
  wins: number;
  /** Unix seconds; 0 if never. */
  lastPlayed: number;
}

export interface PlayerMatch {
  matchId: number;
  heroId: number;
  startTime: number;
  won: boolean;
  kills: number;
  deaths: number;
  assists: number;
  /** 1 safe, 2 mid, 3 off, 4 jungle (OpenDota lane_role); null when unparsed. */
  laneRole: number | null;
}

export interface DotaDataProvider {
  readonly name: string;
  getHeroes(): Promise<Sourced<DotaHero[]>>;
  getHero(heroId: number): Promise<Sourced<DotaHero> | null>;
  getPatch(): Promise<Sourced<PatchInfo>>;
  getHeroMatchups(heroId: number): Promise<Sourced<HeroMatchup[]>>;
  getItemPopularity(heroId: number): Promise<Sourced<ItemPopularity>>;
  getItems(): Promise<Sourced<DotaItem[]>>;
  /** Abilities keyed by hero internal name (npc_dota_hero_*). */
  getHeroAbilities(heroName: string): Promise<Sourced<DotaAbility[]>>;
  /** Throws PlayerNotFoundError for unknown accounts. */
  getPlayer(accountId: number): Promise<Sourced<PlayerProfile>>;
  getPlayerWinLoss(accountId: number): Promise<Sourced<{ wins: number; losses: number }>>;
  getPlayerHeroes(accountId: number): Promise<Sourced<PlayerHeroStat[]>>;
  getPlayerRecentMatches(accountId: number): Promise<Sourced<PlayerMatch[]>>;
}
