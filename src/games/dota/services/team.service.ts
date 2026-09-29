import { getKnowledge } from "../knowledge/heroTraits.js";
import type { HeroTrait } from "../knowledge/traits.js";
import type { DotaHero } from "../providers/dota.provider.js";
import { PROFILE_DIMENSIONS, type ProfileDimension, type TeamAnalysis, type TeamNeed, type TeamProfile } from "../types.js";

/** How each trait feeds each profile dimension. */
const DIMENSION_SOURCES: Record<ProfileDimension, Partial<Record<HeroTrait, number>>> = {
  initiation: { initiation: 1 },
  disable: { instant_disable: 1, disable: 0.6, silence: 0.6 },
  catch: { catch: 1, instant_disable: 0.3 },
  antiMobility: { anti_mobility: 1, silence: 0.6, instant_disable: 0.5 },
  physicalDamage: { physical_damage: 1 },
  magicalDamage: { magical_damage: 1 },
  burst: { burst: 1 },
  sustain: { sustain: 1, heal: 1 },
  save: { save: 1 },
  waveClear: { wave_clear: 1, teamfight: 0.3 },
  towerPush: { tower_push: 1, summons: 0.4, illusions: 0.4 },
  mobility: { mobility: 1 },
  frontline: { frontline: 1 },
  dispel: { dispel: 1 },
  detection: { detection: 1 },
  antiHeal: { anti_heal: 1 },
  teamfight: { teamfight: 1 },
  lateGame: { late_game: 1 },
};

/** Contribution needed to saturate a dimension (a full team wants ~2 sources of most things). */
const DIMENSION_TARGET: Partial<Record<ProfileDimension, number>> = {
  save: 1,
  dispel: 1,
  detection: 1,
  antiHeal: 1,
  lateGame: 1.5,
};

/** Baseline importance of a gap; enemy composition raises some of these. */
const BASE_IMPORTANCE: Partial<Record<ProfileDimension, number>> = {
  initiation: 1,
  disable: 1,
  catch: 0.6,
  waveClear: 0.8,
  frontline: 0.7,
  save: 0.7,
  teamfight: 0.7,
  physicalDamage: 0.5,
  magicalDamage: 0.5,
  towerPush: 0.5,
  lateGame: 0.4,
  dispel: 0.3,
};

export const DIMENSION_LABEL: Record<ProfileDimension, string> = {
  initiation: "Initiation",
  disable: "Disable",
  catch: "Catch",
  antiMobility: "Anti-mobility",
  physicalDamage: "Physical damage",
  magicalDamage: "Magical damage",
  burst: "Burst",
  sustain: "Sustain",
  save: "Save",
  waveClear: "Wave clear",
  towerPush: "Tower push",
  mobility: "Mobility",
  frontline: "Frontline",
  dispel: "Dispel",
  detection: "Detection",
  antiHeal: "Anti-heal",
  teamfight: "Teamfight",
  lateGame: "Late game",
};

/** Contribution of a single set of traits to each dimension (unnormalized). */
export function traitContribution(traits: HeroTrait[]): Record<ProfileDimension, number> {
  const out = Object.fromEntries(PROFILE_DIMENSIONS.map((d) => [d, 0])) as Record<ProfileDimension, number>;
  for (const d of PROFILE_DIMENSIONS) {
    for (const [trait, w] of Object.entries(DIMENSION_SOURCES[d])) {
      if (traits.includes(trait as HeroTrait)) out[d] += w!;
    }
  }
  return out;
}

export function buildProfile(heroes: DotaHero[]): TeamProfile {
  const sums = Object.fromEntries(PROFILE_DIMENSIONS.map((d) => [d, 0])) as Record<ProfileDimension, number>;
  for (const hero of heroes) {
    const contribution = traitContribution(getKnowledge(hero.localizedName)?.provides ?? []);
    for (const d of PROFILE_DIMENSIONS) sums[d] += contribution[d];
  }
  return Object.fromEntries(
    PROFILE_DIMENSIONS.map((d) => [d, Math.min(1, sums[d] / (DIMENSION_TARGET[d] ?? 2))]),
  ) as TeamProfile;
}

function countProviding(heroes: DotaHero[], traits: HeroTrait[]): string[] {
  return heroes
    .filter((h) => getKnowledge(h.localizedName)?.provides.some((t) => traits.includes(t)))
    .map((h) => h.localizedName);
}

/** Importance of each dimension for this team, given what the enemy brings. */
export function needImportance(enemies: DotaHero[]): Map<ProfileDimension, { importance: number; because?: string }> {
  const out = new Map<ProfileDimension, { importance: number; because?: string }>();
  for (const [d, w] of Object.entries(BASE_IMPORTANCE)) out.set(d as ProfileDimension, { importance: w! });

  const raise = (d: ProfileDimension, traits: HeroTrait[], threshold: number, importance: number, what: string) => {
    const heroes = countProviding(enemies, traits);
    if (heroes.length >= threshold) {
      const current = out.get(d)?.importance ?? 0;
      out.set(d, { importance: Math.max(current, importance), because: `enemy ${what}: ${heroes.join(", ")}` });
    }
  };
  raise("antiMobility", ["mobility"], 1, 1.1, "mobility");
  raise("detection", ["invisibility"], 1, 1.1, "invisibility");
  raise("waveClear", ["illusions", "summons"], 1, 1.1, "illusions/summons");
  raise("antiHeal", ["sustain", "heal"], 2, 0.8, "sustain/healing");
  raise("dispel", ["save"], 1, 0.7, "saves");
  raise("frontline", ["burst"], 2, 0.9, "burst");
  raise("save", ["catch", "burst"], 2, 0.9, "catch/burst");
  return out;
}

export function analyzeTeam(heroes: DotaHero[], opponents: DotaHero[] = []): TeamAnalysis {
  const profile = buildProfile(heroes);
  const importance = needImportance(opponents);
  const weaknesses: TeamNeed[] = [...importance.entries()]
    .filter(([d]) => profile[d] < 0.5)
    .map(([dimension, { importance: imp, because }]) => ({ dimension, value: profile[dimension], importance: imp, because }))
    .sort((a, b) => b.importance * (1 - b.value) - a.importance * (1 - a.value));
  const strengths = PROFILE_DIMENSIONS.filter((d) => profile[d] >= 0.75).sort((a, b) => profile[b] - profile[a]);
  return { heroes, profile, strengths, weaknesses };
}

/** Aggregate what the given heroes are weak to, most common first. */
export function aggregateWeakTo(heroes: DotaHero[]): { trait: HeroTrait; count: number }[] {
  const counts = new Map<HeroTrait, number>();
  for (const h of heroes) {
    for (const t of getKnowledge(h.localizedName)?.weakTo ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return [...counts.entries()].map(([trait, count]) => ({ trait, count })).sort((a, b) => b.count - a.count);
}
