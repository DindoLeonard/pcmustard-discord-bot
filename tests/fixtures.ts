import type { Sourced } from "../src/games/types/game.js";
import type {
  DotaAbility,
  DotaDataProvider,
  DotaHero,
  DotaItem,
  HeroMatchup,
  ItemPopularity,
  PatchInfo,
  PlayerHeroStat,
  PlayerMatch,
  PlayerProfile,
} from "../src/games/dota/providers/dota.provider.js";
import { PlayerNotFoundError } from "../src/shared/errors.js";

export const NOW_SEC = Math.floor(Date.now() / 1000);
let matchId = 1;
export const match = (heroId: number, won: boolean): PlayerMatch => ({
  matchId: matchId++,
  heroId,
  startTime: NOW_SEC - matchId * 3600,
  won,
  kills: 5,
  deaths: 3,
  assists: 10,
  laneRole: null,
});

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

  /** accountId -> fake player; accounts not listed are "not found", `private` ones have no match data. */
  players = new Map<number, { name: string; rankTier: number; heroes: PlayerHeroStat[]; recent: PlayerMatch[] }>([
    [
      100,
      {
        name: "Alice",
        rankTier: 45,
        heroes: [
          { heroId: 87, games: 120, wins: 72, lastPlayed: NOW_SEC - 86400 },
          { heroId: 13, games: 40, wins: 18, lastPlayed: NOW_SEC - 400 * 86400 },
          { heroId: 22, games: 10, wins: 6, lastPlayed: NOW_SEC - 3 * 86400 },
        ],
        recent: [match(22, true), match(22, true), match(22, false), match(87, true)],
      },
    ],
    [200, { name: "Bob", rankTier: 80, heroes: [{ heroId: 74, games: 50, wins: 30, lastPlayed: NOW_SEC }], recent: [match(74, true)] }],
    [300, { name: "Private", rankTier: 0, heroes: [], recent: [] }],
  ]);

  async getPlayer(accountId: number): Promise<Sourced<PlayerProfile>> {
    const p = this.players.get(accountId);
    if (!p) throw new PlayerNotFoundError(String(accountId));
    return this.sourced({ accountId, name: p.name, rankTier: p.rankTier || null, leaderboardRank: p.rankTier === 80 ? 42 : null, plus: false });
  }

  async getPlayerWinLoss(accountId: number): Promise<Sourced<{ wins: number; losses: number }>> {
    const p = this.players.get(accountId)!;
    const games = p.heroes.reduce((n, h) => n + h.games, 0);
    const wins = p.heroes.reduce((n, h) => n + h.wins, 0);
    return this.sourced({ wins, losses: games - wins });
  }

  async getPlayerHeroes(accountId: number): Promise<Sourced<PlayerHeroStat[]>> {
    return this.sourced(this.players.get(accountId)?.heroes ?? []);
  }

  async getPlayerRecentMatches(accountId: number): Promise<Sourced<PlayerMatch[]>> {
    return this.sourced(this.players.get(accountId)?.recent ?? []);
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
