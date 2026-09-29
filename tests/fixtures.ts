import type { Sourced } from "../src/games/types/game.js";
import type {
  DotaAbility,
  DotaDataProvider,
  DotaHero,
  DotaItem,
  HeroMatchup,
  ItemPopularity,
  PatchInfo,
} from "../src/games/dota/providers/dota.provider.js";

function hero(id: number, localizedName: string, roles: string[] = ["Carry"]): DotaHero {
  return {
    id,
    name: `npc_dota_hero_${localizedName.toLowerCase().replace(/\W+/g, "_")}`,
    localizedName,
    primaryAttr: "int",
    attackType: "Ranged",
    roles,
    stats: { pubPicks: 100, pubWins: 50, proPicks: 0, proWins: 0, proBans: 0, brackets: [] },
  };
}

export const HEROES: DotaHero[] = [
  hero(1, "Anti-Mage"),
  hero(13, "Puck", ["Initiator", "Disabler", "Escape", "Nuker"]),
  hero(17, "Storm Spirit"),
  hero(21, "Windranger"),
  hero(54, "Lifestealer"),
  hero(59, "Huskar"),
  hero(74, "Invoker"),
  hero(53, "Nature's Prophet"),
  hero(107, "Earth Spirit"),
  hero(106, "Ember Spirit"),
  hero(22, "Zeus"),
  hero(87, "Disruptor"),
];

export class FakeDotaProvider implements DotaDataProvider {
  readonly name = "fake";
  calls = 0;

  constructor(private readonly heroes: DotaHero[] = HEROES) {}

  async getHeroes(): Promise<Sourced<DotaHero[]>> {
    this.calls++;
    return { data: this.heroes, source: this.name, fetchedAt: new Date(0), patch: "7.41" };
  }

  async getHero(heroId: number): Promise<Sourced<DotaHero> | null> {
    const h = this.heroes.find((x) => x.id === heroId);
    return h ? { data: h, source: this.name, fetchedAt: new Date(0) } : null;
  }

  async getPatch(): Promise<Sourced<PatchInfo>> {
    return { data: { name: "7.41", date: new Date(0) }, source: this.name, fetchedAt: new Date(0) };
  }

  /** heroId -> matchups from that hero's perspective */
  matchups = new Map<number, HeroMatchup[]>();

  async getHeroMatchups(heroId: number): Promise<Sourced<HeroMatchup[]>> {
    return this.sourced(this.matchups.get(heroId) ?? []);
  }

  async getItemPopularity(_heroId: number): Promise<Sourced<ItemPopularity>> {
    return this.sourced({ start: { 16: 200, 44: 80 }, early: { 1: 50 }, mid: {}, late: {} });
  }

  async getItems(): Promise<Sourced<DotaItem[]>> {
    return this.sourced(ITEMS);
  }

  async getHeroAbilities(_heroName: string): Promise<Sourced<DotaAbility[]>> {
    return this.sourced([{ key: "test_spell", name: "Test Spell", isInnate: false, cooldown: ["10"] }]);
  }

  private sourced<T>(data: T): Sourced<T> {
    return { data, source: this.name, fetchedAt: new Date(0), patch: "7.41" };
  }
}

export const ITEMS: DotaItem[] = [
  { id: 1, key: "blink", name: "Blink Dagger", cost: 2250 },
  { id: 16, key: "branches", name: "Iron Branch", cost: 50 },
  { id: 44, key: "tango", name: "Tango", cost: 90 },
  { id: 116, key: "black_king_bar", name: "Black King Bar", cost: 4050 },
  { id: 36, key: "magic_wand", name: "Magic Wand", cost: 450 },
];

export const heroByName = (name: string): DotaHero => {
  const h = HEROES.find((x) => x.localizedName === name);
  if (!h) throw new Error(`fixture hero ${name} missing`);
  return h;
};
