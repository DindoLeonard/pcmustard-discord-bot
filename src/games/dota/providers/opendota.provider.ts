import { MatchNotFoundError, PlayerNotFoundError, ProviderUnavailableError } from "../../../shared/errors.js";
import { logger } from "../../../shared/logger.js";
import type { Sourced } from "../../types/game.js";
import type {
  Benchmark,
  BracketStat,
  DotaAbility,
  DotaDataProvider,
  DotaHero,
  DotaItem,
  HeroMatchup,
  ItemPopularity,
  MatchDetail,
  MatchPlayer,
  PatchInfo,
  PlayerHeroStat,
  PlayerMatch,
  PlayerProfile,
  PrimaryAttribute,
} from "./dota.provider.js";

const DEFAULT_BASE_URL = "https://api.opendota.com/api";
const CDN_BASE_URL = "https://cdn.cloudflare.steamstatic.com";
const HOUR = 60 * 60 * 1000;

/** Per-endpoint cache lifetimes. Stats move slowly; constants only change with patches. */
const DEFAULT_TTLS = {
  heroStats: HOUR,
  patch: 6 * HOUR,
  matchups: 6 * HOUR,
  itemPopularity: 6 * HOUR,
  constants: 24 * HOUR,
  /** Players change after every match; keep this short. */
  player: 30 * 60 * 1000,
  /** Matches don't change, but a parse can add data later. */
  match: 10 * 60 * 1000,
};

type FetchFn = typeof fetch;

export interface OpenDotaProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  /** Overrides every TTL (tests). */
  ttlMs?: number;
  fetchFn?: FetchFn;
  now?: () => number;
}

/** Raw /heroStats entry; only the fields we read. */
interface RawHeroStats {
  id: number;
  name: string;
  localized_name: string;
  primary_attr: string;
  attack_type: string;
  roles: string[];
  img?: string;
  icon?: string;
  pub_pick?: number;
  pub_win?: number;
  pro_pick?: number;
  pro_win?: number;
  pro_ban?: number;
  [key: string]: unknown;
}

interface RawPatch {
  name: string;
  date: string;
  id: number;
}

interface RawMatchup {
  hero_id: number;
  games_played: number;
  wins: number;
}

type RawItemPopularity = Record<"start_game_items" | "early_game_items" | "mid_game_items" | "late_game_items", Record<string, number>>;

interface RawItem {
  id: number;
  dname?: string;
  cost?: number | null;
}

interface RawPlayer {
  profile?: { personaname?: string | null; avatarfull?: string; avatarmedium?: string; plus?: boolean } | null;
  rank_tier?: number | null;
  leaderboard_rank?: number | null;
}

interface RawPlayerHero {
  hero_id: number | string;
  games: number;
  win: number;
  last_played?: number;
}

interface RawRecentMatch {
  match_id: number;
  player_slot: number;
  radiant_win: boolean;
  hero_id: number;
  start_time: number;
  kills: number;
  deaths: number;
  assists: number;
  lane_role?: number | null;
}

interface RawMatchPlayer {
  account_id?: number | null;
  personaname?: string | null;
  hero_id: number;
  player_slot: number;
  isRadiant?: boolean;
  kills: number;
  deaths: number;
  assists: number;
  gold_per_min: number;
  xp_per_min: number;
  last_hits: number;
  denies: number;
  hero_damage?: number;
  tower_damage?: number;
  hero_healing?: number;
  net_worth?: number;
  level?: number;
  item_0?: number;
  item_1?: number;
  item_2?: number;
  item_3?: number;
  item_4?: number;
  item_5?: number;
  item_neutral?: number;
  rank_tier?: number | null;
  benchmarks?: Record<string, { raw?: number; pct?: number }>;
  lane_role?: number;
  lane_efficiency_pct?: number;
  obs_placed?: number;
  sen_placed?: number;
  stuns?: number;
  teamfight_participation?: number;
}

interface RawMatch {
  radiant_win: boolean;
  duration: number;
  start_time: number;
  game_mode: number;
  lobby_type: number;
  radiant_score?: number;
  dire_score?: number;
  version?: number | null;
  od_data?: { has_parsed?: boolean };
  radiant_gold_adv?: number[] | null;
  players: RawMatchPlayer[];
}

function normalizeMatchPlayer(p: RawMatchPlayer): MatchPlayer {
  const benchmarks: Record<string, Benchmark> = {};
  for (const [k, v] of Object.entries(p.benchmarks ?? {})) {
    if (typeof v?.raw === "number" && typeof v?.pct === "number") benchmarks[k] = { raw: v.raw, pct: v.pct };
  }
  return {
    accountId: p.account_id ?? null,
    name: p.personaname ?? null,
    heroId: p.hero_id,
    isRadiant: p.isRadiant ?? p.player_slot < 128,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    gpm: p.gold_per_min,
    xpm: p.xp_per_min,
    lastHits: p.last_hits,
    denies: p.denies,
    heroDamage: p.hero_damage ?? 0,
    towerDamage: p.tower_damage ?? 0,
    heroHealing: p.hero_healing ?? 0,
    netWorth: p.net_worth ?? 0,
    level: p.level ?? 0,
    items: [p.item_0, p.item_1, p.item_2, p.item_3, p.item_4, p.item_5].map((i) => i ?? 0),
    neutralItem: p.item_neutral || null,
    rankTier: p.rank_tier ?? null,
    benchmarks,
    laneRole: p.lane_role,
    laneEfficiency: p.lane_efficiency_pct,
    obsPlaced: p.obs_placed,
    senPlaced: p.sen_placed,
    stuns: p.stuns,
    teamfightParticipation: p.teamfight_participation,
  };
}

interface RawAbility {
  dname?: string;
  desc?: string;
  dmg_type?: string;
  bkbpierce?: string;
  is_innate?: boolean;
  cd?: string | string[];
  mc?: string | string[] | false;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class OpenDotaProvider implements DotaDataProvider {
  readonly name = "opendota";

  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly ttls: typeof DEFAULT_TTLS;
  private readonly fetchFn: FetchFn;
  private readonly now: () => number;
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(options: OpenDotaProviderOptions = {}) {
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.apiKey = options.apiKey;
    const ttl = options.ttlMs;
    this.ttls = ttl === undefined ? DEFAULT_TTLS : { heroStats: ttl, patch: ttl, matchups: ttl, itemPopularity: ttl, constants: ttl, player: ttl, match: ttl };
    this.fetchFn = options.fetchFn ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async getHeroes(): Promise<Sourced<DotaHero[]>> {
    const [raw, patch] = await Promise.all([
      this.cached<Sourced<RawHeroStats[]>>("heroStats", this.ttls.heroStats, () => this.request("/heroStats")),
      this.getPatch().catch(() => undefined),
    ]);
    return this.withPatch(raw, raw.data.map(normalizeHero), patch?.data.name);
  }

  async getHero(heroId: number): Promise<Sourced<DotaHero> | null> {
    const heroes = await this.getHeroes();
    const hero = heroes.data.find((h) => h.id === heroId);
    return hero ? { ...heroes, data: hero } : null;
  }

  async getPatch(): Promise<Sourced<PatchInfo>> {
    const raw = await this.cached<Sourced<RawPatch[]>>("patch", this.ttls.patch, () => this.request("/constants/patch"));
    const latest = raw.data[raw.data.length - 1];
    if (!latest) throw new ProviderUnavailableError(this.name, new Error("empty patch list"));
    return {
      data: { name: latest.name, date: new Date(latest.date) },
      source: this.name,
      fetchedAt: raw.fetchedAt,
      patch: latest.name,
    };
  }

  async getHeroMatchups(heroId: number): Promise<Sourced<HeroMatchup[]>> {
    const raw = await this.cached<Sourced<RawMatchup[]>>(`matchups:${heroId}`, this.ttls.matchups, () =>
      this.request(`/heroes/${heroId}/matchups`),
    );
    const data = raw.data.map((m) => ({ opponentId: m.hero_id, games: m.games_played, wins: m.wins }));
    return this.withPatch(raw, data);
  }

  async getItemPopularity(heroId: number): Promise<Sourced<ItemPopularity>> {
    const raw = await this.cached<Sourced<RawItemPopularity>>(`itemPopularity:${heroId}`, this.ttls.itemPopularity, () =>
      this.request(`/heroes/${heroId}/itemPopularity`),
    );
    const phase = (r: Record<string, number> | undefined) =>
      Object.fromEntries(Object.entries(r ?? {}).map(([id, n]) => [Number(id), n]));
    return this.withPatch(raw, {
      start: phase(raw.data.start_game_items),
      early: phase(raw.data.early_game_items),
      mid: phase(raw.data.mid_game_items),
      late: phase(raw.data.late_game_items),
    });
  }

  async getItems(): Promise<Sourced<DotaItem[]>> {
    const raw = await this.cached<Sourced<Record<string, RawItem>>>("items", this.ttls.constants, () =>
      this.request("/constants/items"),
    );
    const data = Object.entries(raw.data)
      .filter(([key, v]) => v.dname && !key.startsWith("recipe_"))
      .map(([key, v]) => ({ id: v.id, key, name: v.dname!, cost: v.cost ?? 0 }));
    return this.withPatch(raw, data);
  }

  async getHeroAbilities(heroName: string): Promise<Sourced<DotaAbility[]>> {
    const [heroAbilities, abilities] = await Promise.all([
      this.cached<Sourced<Record<string, { abilities: string[] }>>>("heroAbilities", this.ttls.constants, () =>
        this.request("/constants/hero_abilities"),
      ),
      this.cached<Sourced<Record<string, RawAbility>>>("abilities", this.ttls.constants, () =>
        this.request("/constants/abilities"),
      ),
    ]);
    const keys = heroAbilities.data[heroName]?.abilities ?? [];
    const data = keys
      .map((key) => ({ key, raw: abilities.data[key] }))
      // Skip placeholders (generic_hidden, invoker_empty*) which have no display name.
      .filter((a): a is { key: string; raw: RawAbility } => Boolean(a.raw?.dname) && !a.key.startsWith("invoker_empty"))
      .map(({ key, raw }) => ({
        key,
        name: raw.dname!,
        description: raw.desc,
        damageType: raw.dmg_type,
        piercesSpellImmunity: raw.bkbpierce,
        isInnate: raw.is_innate === true,
        cooldown: toList(raw.cd),
        manaCost: raw.mc === false ? undefined : toList(raw.mc),
      }));
    return this.withPatch(abilities, data);
  }

  private withPatch<T>(raw: { fetchedAt: Date }, data: T, patch?: string): Sourced<T> {
    return { data, source: this.name, fetchedAt: raw.fetchedAt, patch };
  }

  private async cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const hit = this.cache.get(key);
    if (hit && hit.expiresAt > this.now()) {
      logger.debug("cache hit", { provider: this.name, key });
      return hit.value as T;
    }
    const pending = this.inflight.get(key);
    if (pending) return pending as Promise<T>;

    logger.debug("cache miss", { provider: this.name, key });
    const promise = load()
      .then((value) => {
        this.cache.set(key, { value, expiresAt: this.now() + ttlMs });
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  async getPlayer(accountId: number): Promise<Sourced<PlayerProfile>> {
    const raw = await this.cached<Sourced<RawPlayer | null>>(`player:${accountId}`, this.ttls.player, () =>
      this.request<RawPlayer>(`/players/${accountId}`, { notFoundAsNull: true }),
    );
    // Unknown IDs come back either as 404 or as an empty shell with no name.
    if (!raw.data?.profile || (!raw.data.profile.personaname && raw.data.rank_tier == null)) {
      throw new PlayerNotFoundError(String(accountId));
    }
    const p = raw.data.profile;
    return this.withPatch(raw, {
      accountId,
      name: p.personaname ?? null,
      avatarUrl: p.avatarfull ?? p.avatarmedium ?? undefined,
      rankTier: raw.data.rank_tier ?? null,
      leaderboardRank: raw.data.leaderboard_rank ?? null,
      plus: p.plus === true,
    });
  }

  async getPlayerWinLoss(accountId: number): Promise<Sourced<{ wins: number; losses: number }>> {
    const raw = await this.cached<Sourced<{ win: number; lose: number }>>(`playerWl:${accountId}`, this.ttls.player, () =>
      this.request(`/players/${accountId}/wl`),
    );
    return this.withPatch(raw, { wins: raw.data.win ?? 0, losses: raw.data.lose ?? 0 });
  }

  async getPlayerHeroes(accountId: number): Promise<Sourced<PlayerHeroStat[]>> {
    const raw = await this.cached<Sourced<RawPlayerHero[]>>(`playerHeroes:${accountId}`, this.ttls.player, () =>
      this.request(`/players/${accountId}/heroes`),
    );
    const data = raw.data
      .filter((h) => h.games > 0)
      .map((h) => ({ heroId: Number(h.hero_id), games: h.games, wins: h.win, lastPlayed: h.last_played ?? 0 }));
    return this.withPatch(raw, data);
  }

  async getPlayerRecentMatches(accountId: number): Promise<Sourced<PlayerMatch[]>> {
    const raw = await this.cached<Sourced<RawRecentMatch[]>>(`playerRecent:${accountId}`, this.ttls.player, () =>
      this.request(`/players/${accountId}/recentMatches`),
    );
    const data = raw.data.map((m) => ({
      matchId: m.match_id,
      heroId: m.hero_id,
      startTime: m.start_time,
      // player_slot < 128 = Radiant
      won: (m.player_slot < 128) === m.radiant_win,
      kills: m.kills,
      deaths: m.deaths,
      assists: m.assists,
      laneRole: m.lane_role ?? null,
    }));
    return this.withPatch(raw, data);
  }

  async getMatch(matchId: number): Promise<Sourced<MatchDetail>> {
    const raw = await this.cached<Sourced<RawMatch | null>>(`match:${matchId}`, this.ttls.match, () =>
      this.request<RawMatch>(`/matches/${matchId}`, { notFoundAsNull: true }),
    );
    if (!raw.data?.players?.length) throw new MatchNotFoundError(String(matchId));
    const m = raw.data;
    return this.withPatch(raw, {
      matchId,
      radiantWin: m.radiant_win,
      duration: m.duration,
      startTime: m.start_time,
      gameMode: m.game_mode,
      lobbyType: m.lobby_type,
      radiantScore: m.radiant_score ?? 0,
      direScore: m.dire_score ?? 0,
      parsed: m.od_data?.has_parsed === true || m.version != null,
      radiantGoldAdv: m.radiant_gold_adv ?? undefined,
      players: m.players.map(normalizeMatchPlayer),
    });
  }

  async requestParse(matchId: number): Promise<boolean> {
    try {
      const res = await this.fetchFn(new URL(`${this.baseUrl}/request/${matchId}${this.apiKey ? `?api_key=${this.apiKey}` : ""}`), { method: "POST" });
      logger.info("parse requested", { provider: this.name, matchId, status: res.status });
      return res.ok;
    } catch (err) {
      logger.warn("parse request failed", { provider: this.name, matchId, error: err });
      return false;
    }
  }

  private async request<T>(path: string, options: { notFoundAsNull: true }): Promise<Sourced<T | null>>;
  private async request<T>(path: string): Promise<Sourced<T>>;
  private async request<T>(path: string, options: { notFoundAsNull?: boolean } = {}): Promise<Sourced<T | null>> {
    const url = new URL(this.baseUrl + path);
    if (this.apiKey) url.searchParams.set("api_key", this.apiKey);

    const started = this.now();
    let res: Response;
    try {
      res = await this.fetchFn(url, { headers: { accept: "application/json" } });
    } catch (err) {
      logger.error("provider request failed", { provider: this.name, path, error: err });
      throw new ProviderUnavailableError(this.name, err);
    }
    logger.info("provider request", { provider: this.name, path, status: res.status, latencyMs: this.now() - started });
    if (res.status === 404 && options.notFoundAsNull) return { data: null, source: this.name, fetchedAt: new Date(this.now()) };
    if (!res.ok) throw new ProviderUnavailableError(this.name, new Error(`HTTP ${res.status} for ${path}`));

    return { data: (await res.json()) as T, source: this.name, fetchedAt: new Date(this.now()) };
  }
}

function toList(v: string | string[] | undefined): string[] | undefined {
  if (v === undefined || v === "" || v === "0") return undefined;
  return Array.isArray(v) ? v : [v];
}

function normalizeHero(raw: RawHeroStats): DotaHero {
  const brackets: BracketStat[] = [];
  for (let b = 1; b <= 8; b++) {
    const picks = Number(raw[`${b}_pick`] ?? 0);
    const wins = Number(raw[`${b}_win`] ?? 0);
    if (picks > 0) brackets.push({ bracket: b, picks, wins });
  }
  return {
    id: raw.id,
    name: raw.name,
    localizedName: raw.localized_name,
    primaryAttr: (["str", "agi", "int", "all"].includes(raw.primary_attr) ? raw.primary_attr : "all") as PrimaryAttribute,
    attackType: raw.attack_type === "Melee" ? "Melee" : "Ranged",
    roles: raw.roles ?? [],
    imageUrl: raw.img ? CDN_BASE_URL + raw.img : undefined,
    iconUrl: raw.icon ? CDN_BASE_URL + raw.icon : undefined,
    stats: {
      pubPicks: raw.pub_pick ?? 0,
      pubWins: raw.pub_win ?? 0,
      proPicks: raw.pro_pick ?? 0,
      proWins: raw.pro_win ?? 0,
      proBans: raw.pro_ban ?? 0,
      brackets,
    },
  };
}
