/**
 * Shared trait vocabulary. A hero `provides` traits and is `weakTo` traits, so
 * "Storm Spirit is weak to silence" can be matched against "Silencer provides silence".
 */
export const HERO_TRAITS = [
  "initiation",
  "instant_disable",
  "disable",
  "silence",
  "catch",
  "anti_mobility",
  "burst",
  "physical_damage",
  "magical_damage",
  "sustain",
  "heal",
  "save",
  "dispel",
  "mana_burn",
  "break",
  "frontline",
  "wave_clear",
  "tower_push",
  "teamfight",
  "mobility",
  "illusions",
  "summons",
  "invisibility",
  "detection",
  "anti_heal",
  "spell_immunity",
  "armor_reduction",
  "late_game",
  "lane_harass",
] as const;

export type HeroTrait = (typeof HERO_TRAITS)[number];

export const TRAIT_LABEL: Record<HeroTrait, string> = {
  initiation: "initiation",
  instant_disable: "instant disable",
  disable: "disable",
  silence: "silence",
  catch: "catch",
  anti_mobility: "anti-mobility",
  burst: "burst",
  physical_damage: "physical damage",
  magical_damage: "magical damage",
  sustain: "sustain",
  heal: "healing",
  save: "save",
  dispel: "dispel",
  mana_burn: "mana burn",
  break: "break",
  frontline: "frontline",
  wave_clear: "wave clear",
  tower_push: "tower push",
  teamfight: "teamfight",
  mobility: "mobility",
  illusions: "illusions",
  summons: "summons",
  invisibility: "invisibility",
  detection: "detection",
  anti_heal: "anti-heal",
  spell_immunity: "spell immunity",
  armor_reduction: "armor reduction",
  late_game: "late-game scaling",
  lane_harass: "lane harass",
};

/** 1 = carry, 2 = mid, 3 = offlane, 4 = soft support, 5 = hard support */
export type Position = 1 | 2 | 3 | 4 | 5;

export const POSITION_LABEL: Record<Position, string> = {
  1: "Carry (pos 1)",
  2: "Mid (pos 2)",
  3: "Offlane (pos 3)",
  4: "Soft support (pos 4)",
  5: "Hard support (pos 5)",
};

export const POSITIONS: Position[] = [1, 2, 3, 4, 5];

export function isPosition(n: number): n is Position {
  return POSITIONS.includes(n as Position);
}
