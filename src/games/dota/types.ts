import type { DataSource } from "../types/game.js";
import type { HeroKnowledge } from "./knowledge/heroTraits.js";
import type { HeroTrait, Position } from "./knowledge/traits.js";
import type { DotaAbility, DotaHero } from "./providers/dota.provider.js";

export type ReasonType = "counter" | "synergy" | "role_fit" | "team_need" | "meta";

export interface RecommendationReason {
  type: ReasonType;
  description: string;
  /** Contribution of this reason to the final score (weight * component score). */
  weight: number;
}

/** Head-to-head record, from the perspective of `hero` against `opponent`. */
export interface MatchupStat {
  heroId: number;
  opponentId: number;
  games: number;
  wins: number;
  /** Raw win rate, null when there are no games. */
  winRate: number | null;
  /** Win rate shrunk toward 50% by a prior, so tiny samples don't dominate. */
  adjustedWinRate: number;
  lowSample: boolean;
}

export interface ScoreBreakdown {
  [component: string]: number;
}

export interface CandidateBase {
  hero: DotaHero;
  knowledge?: HeroKnowledge;
  score: number;
  components: ScoreBreakdown;
  reasons: RecommendationReason[];
}

export interface CounterCandidate extends CandidateBase {
  matchup: MatchupStat;
  /** Target weaknesses this candidate provides. */
  exploits: HeroTrait[];
}

export interface CounterAnalysis {
  target: DotaHero;
  targetKnowledge?: HeroKnowledge;
  position?: Position;
  candidates: CounterCandidate[];
  sources: DataSource[];
  generatedAt: Date;
}

export interface MatchupAnalysis {
  hero: DotaHero;
  enemy: DotaHero;
  position?: Position;
  heroKnowledge?: HeroKnowledge;
  enemyKnowledge?: HeroKnowledge;
  stat: MatchupStat;
  /** Enemy weaknesses that `hero` provides, and vice versa. */
  heroExploits: HeroTrait[];
  enemyExploits: HeroTrait[];
  heroAbilities: DotaAbility[];
  enemyAbilities: DotaAbility[];
  popularItems: { start: PopularItem[]; early: PopularItem[] };
  sources: DataSource[];
  generatedAt: Date;
}

export interface PopularItem {
  id: number;
  name: string;
  /** Number of matches (in OpenDota's sample) the item was bought in this phase. */
  matches: number;
}

export const PROFILE_DIMENSIONS = [
  "initiation",
  "disable",
  "catch",
  "antiMobility",
  "physicalDamage",
  "magicalDamage",
  "burst",
  "sustain",
  "save",
  "waveClear",
  "towerPush",
  "mobility",
  "frontline",
  "dispel",
  "detection",
  "antiHeal",
  "teamfight",
  "lateGame",
] as const;

export type ProfileDimension = (typeof PROFILE_DIMENSIONS)[number];

/** Each dimension normalized to 0..1. */
export type TeamProfile = Record<ProfileDimension, number>;

export interface TeamNeed {
  dimension: ProfileDimension;
  value: number;
  importance: number;
  /** Why it matters, e.g. "enemy has 3 mobile heroes". */
  because?: string;
}

export interface TeamAnalysis {
  heroes: DotaHero[];
  profile: TeamProfile;
  strengths: ProfileDimension[];
  weaknesses: TeamNeed[];
}

export interface DraftCandidate extends CandidateBase {
  matchups: MatchupStat[];
  fills: ProfileDimension[];
  exploits: { enemy: string; traits: HeroTrait[] }[];
}

export interface DraftInput {
  allies: string[];
  enemies: string[];
  position: Position;
  /** 1 = Herald ... 8 = Immortal; uses bracket win rates for the meta score when set. */
  bracket?: number;
}

export interface TeamsAnalysis {
  allies: TeamAnalysis;
  enemies: TeamAnalysis;
  enemyVulnerabilities: { trait: HeroTrait; count: number }[];
  /** What the allied lineup is weak to (what the enemy could exploit). */
  allyVulnerabilities: { trait: HeroTrait; count: number }[];
  sources: DataSource[];
  generatedAt: Date;
}

export interface DraftAnalysis {
  position: Position;
  bracket?: number;
  allies: TeamAnalysis;
  enemies: TeamAnalysis;
  /** Enemy weaknesses aggregated across the enemy lineup (trait -> number of enemies weak to it). */
  enemyVulnerabilities: { trait: HeroTrait; count: number }[];
  candidates: DraftCandidate[];
  sources: DataSource[];
  generatedAt: Date;
}
