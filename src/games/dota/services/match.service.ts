import { MatchNotFoundError, UserInputError } from "../../../shared/errors.js";
import type { DataSource } from "../../types/game.js";
import type { DotaDataProvider, DotaHero, MatchDetail, MatchPlayer } from "../providers/dota.provider.js";
import type { HeroesService } from "./heroes.service.js";
import type { ItemsService } from "./items.service.js";
import { round } from "./scoring.service.js";

/** Accepts a match ID or an OpenDota / Dotabuff / STRATZ match link. */
export function parseMatchRef(input: string): number | null {
  const text = input.trim();
  const fromUrl = /(?:opendota\.com|dotabuff\.com|stratz\.com)\/matches\/(\d+)/i.exec(text)?.[1];
  const digits = fromUrl ?? (/^\d{6,12}$/.test(text) ? text : null);
  return digits ? Number(digits) : null;
}

const GAME_MODES: Record<number, string> = {
  1: "All Pick",
  2: "Captains Mode",
  3: "Random Draft",
  4: "Single Draft",
  5: "All Random",
  16: "Captains Draft",
  18: "Ability Draft",
  22: "All Pick",
  23: "Turbo",
};
const LOBBIES: Record<number, string> = { 0: "Normal", 1: "Practice", 2: "Tournament", 5: "Team match", 7: "Ranked" };

export function modeLabel(gameMode: number, lobbyType: number): string {
  const mode = GAME_MODES[gameMode] ?? `Mode ${gameMode}`;
  const lobby = LOBBIES[lobbyType];
  return lobby && lobby !== "Normal" ? `${lobby} ${mode}` : mode;
}

export function durationLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

const BENCHMARK_LABEL: Record<string, string> = {
  gold_per_min: "GPM",
  xp_per_min: "XPM",
  kills_per_min: "Kills per minute",
  last_hits_per_min: "Last hits per minute",
  hero_damage_per_min: "Hero damage per minute",
  hero_healing_per_min: "Healing per minute",
  tower_damage: "Tower damage",
  stuns_per_min: "Stuns per minute",
  lhten: "Last hits at 10 minutes",
};

export interface BenchmarkLine {
  key: string;
  label: string;
  raw: number;
  /** 0..1: share of players on this hero with a lower value. */
  pct: number;
}

export interface FocusReview {
  player: MatchPlayer;
  hero?: DotaHero;
  won: boolean;
  items: string[];
  neutralItem?: string;
  /** (kills + assists) / team kills */
  killParticipation: number | null;
  /** share of the team's hero damage */
  damageShare: number | null;
  /** 1 = richest on their team */
  netWorthRank: number;
  teamAvgDeaths: number;
  benchmarks: BenchmarkLine[];
  strengths: string[];
  concerns: string[];
}

export interface TeamLine {
  won: boolean;
  kills: number;
  players: (MatchPlayer & { hero?: DotaHero })[];
}

export interface MatchReview {
  match: MatchDetail;
  mode: string;
  duration: string;
  radiant: TeamLine;
  dire: TeamLine;
  focus?: FocusReview;
  /** We asked OpenDota to parse the replay (more detail later). */
  parseRequested: boolean;
  sources: DataSource[];
}

const pctText = (p: number) => `${Math.round(p * 100)}%`;

/** Pure: build the review for one match, optionally focused on one player. */
export function buildReview(
  match: MatchDetail,
  heroes: Map<number, DotaHero>,
  itemName: (id: number) => string | undefined,
  focusAccountId?: number,
  focusName?: string,
): Omit<MatchReview, "parseRequested" | "sources"> {
  const withHero = (p: MatchPlayer) => ({ ...p, hero: heroes.get(p.heroId) });
  const team = (radiant: boolean): TeamLine => {
    const players = match.players.filter((p) => p.isRadiant === radiant).map(withHero);
    return { won: match.radiantWin === radiant, kills: players.reduce((n, p) => n + p.kills, 0), players };
  };
  const radiant = team(true);
  const dire = team(false);

  let focus: FocusReview | undefined;
  const byName = focusName?.trim().toLowerCase();
  const player =
    (focusAccountId ? match.players.find((p) => p.accountId === focusAccountId) : undefined) ??
    (byName ? match.players.find((p) => p.name?.trim().toLowerCase() === byName) : undefined);
  if (player) {
    const mine = player.isRadiant ? radiant : dire;
    const teamDamage = mine.players.reduce((n, p) => n + p.heroDamage, 0);
    const teamAvgDeaths = mine.players.reduce((n, p) => n + p.deaths, 0) / mine.players.length;
    const hero = heroes.get(player.heroId);
    const heroName = hero?.localizedName ?? "this hero";

    const benchmarks: BenchmarkLine[] = Object.entries(player.benchmarks)
      // Healing/stuns benchmarks are meaningless for heroes that have none.
      .filter(([k, b]) => BENCHMARK_LABEL[k] && !((k === "hero_healing_per_min" || k === "stuns_per_min") && b.raw === 0))
      .map(([key, b]) => ({ key, label: BENCHMARK_LABEL[key]!, raw: round(b.raw, 2), pct: round(b.pct, 3) }))
      .sort((a, b) => b.pct - a.pct);

    const strengths: string[] = [];
    const concerns: string[] = [];
    for (const b of benchmarks) {
      if (b.pct >= 0.75) strengths.push(`${b.label} ${fmt(b.raw)}: better than ${pctText(b.pct)} of ${heroName} players`);
      else if (b.pct <= 0.3) concerns.push(`${b.label} ${fmt(b.raw)}: lower than ${pctText(1 - b.pct)} of ${heroName} players`);
    }
    const kp = mine.kills ? (player.kills + player.assists) / mine.kills : null;
    if (kp !== null && kp >= 0.7) strengths.push(`Involved in ${pctText(kp)} of your team's kills`);
    if (kp !== null && kp <= 0.35 && mine.kills >= 10) concerns.push(`Only involved in ${pctText(kp)} of your team's kills`);
    if (player.deaths >= 8 && player.deaths >= teamAvgDeaths * 1.5) {
      concerns.push(`${player.deaths} deaths (team average ${teamAvgDeaths.toFixed(1)})`);
    }
    if (player.laneEfficiency !== undefined) {
      if (player.laneEfficiency >= 80) strengths.push(`Lane efficiency ${Math.round(player.laneEfficiency)}%`);
      else if (player.laneEfficiency <= 50) concerns.push(`Lane efficiency only ${Math.round(player.laneEfficiency)}%`);
    }

    const netWorthRank = [...mine.players].sort((a, b) => b.netWorth - a.netWorth).findIndex((p) => p.accountId === player.accountId && p.heroId === player.heroId) + 1;
    focus = {
      player,
      hero,
      won: player.isRadiant === match.radiantWin,
      items: player.items.filter((i) => i > 0).map((i) => itemName(i) ?? `item ${i}`),
      neutralItem: player.neutralItem ? itemName(player.neutralItem) : undefined,
      killParticipation: kp === null ? null : round(kp, 3),
      damageShare: teamDamage ? round(player.heroDamage / teamDamage, 3) : null,
      netWorthRank,
      teamAvgDeaths: round(teamAvgDeaths, 1),
      benchmarks,
      strengths,
      concerns,
    };
  }

  return { match, mode: modeLabel(match.gameMode, match.lobbyType), duration: durationLabel(match.duration), radiant, dire, focus };
}

function fmt(n: number): string {
  return n >= 100 ? String(Math.round(n)) : n.toFixed(2);
}

export interface ReviewInput {
  /** A match ID or link. If absent, the player's most recent match is used. */
  match?: string;
  /** Whose performance to review (their account ID). */
  accountId?: number;
  /** Or their in-game name, matched case-insensitively against the match's players. */
  playerName?: string;
}

export class MatchService {
  constructor(
    private readonly provider: DotaDataProvider,
    private readonly heroes: HeroesService,
    private readonly items: ItemsService,
  ) {}

  async review(input: ReviewInput): Promise<MatchReview> {
    let matchId: number | null;
    if (input.match) {
      matchId = parseMatchRef(input.match);
      if (!matchId) throw new MatchNotFoundError(input.match);
    } else if (input.accountId) {
      const recent = await this.provider.getPlayerRecentMatches(input.accountId);
      matchId = recent.data[0]?.matchId ?? null;
      if (!matchId) throw new UserInputError("I couldn't find any recent public matches for that player.");
    } else {
      throw new UserInputError("Give me a match ID, or link your account with `/dota link` so I can find your last game.");
    }

    const [match, heroes, items] = await Promise.all([this.provider.getMatch(matchId), this.heroes.list(), this.items.allItems()]);
    const byId = new Map(heroes.data.map((h) => [h.id, h]));
    const itemById = new Map(items.map((i) => [i.id, i.name]));
    const review = buildReview(match.data, byId, (id) => itemById.get(id), input.accountId, input.playerName);

    // Unparsed replays lack laning/wards/timeline data; ask OpenDota to parse so a re-run shows more.
    const parseRequested = !match.data.parsed && (await this.provider.requestParse(matchId));
    return { ...review, parseRequested, sources: [{ source: match.source, fetchedAt: match.fetchedAt, patch: heroes.patch }] };
  }
}
