import { UserInputError } from "../../../shared/errors.js";
import type { Position } from "../knowledge/traits.js";
import type { DotaHero } from "../providers/dota.provider.js";
import type { DraftAnalysis, DraftCandidate } from "../types.js";
import type { DraftService } from "./draft.service.js";
import { banValue, type PlayerAnalysis, type PlayerService } from "./player.service.js";
import { adjustedWinRate, clamp01, round } from "./scoring.service.js";

export const MAX_SCOUTED = 5;

export interface ScoutInput {
  /** Resolved account IDs of the enemy players, with an optional display label (e.g. the Discord name). */
  enemies: { accountId: number; label?: string }[];
  /** Inputs that couldn't be turned into an account (unlinked @mention, bad ID): reported, not fatal. */
  unresolved?: { label: string; error: string }[];
  /** Enemy heroes already picked, if any. */
  pickedEnemies?: string[];
  allies?: string[];
  /** When set, also recommend picks for this slot against their likely heroes. */
  position?: Position;
  bracket?: number;
  /** The requester's own account, to favour heroes they play well. */
  myAccountId?: number;
}

export interface ScoutedPlayer {
  accountId: number;
  label: string;
  analysis?: PlayerAnalysis;
  /** User-facing reason the player couldn't be scouted (private profile, unknown ID). */
  error?: string;
}

export interface BanSuggestion {
  hero: DotaHero;
  value: number;
  players: string[];
}

export interface ScoutPick {
  candidate: DraftCandidate;
  /** Candidate score plus the comfort bonus from the requester's hero pool. */
  score: number;
  yourGames?: number;
  yourWinRate?: number;
}

export interface ScoutAnalysis {
  players: ScoutedPlayer[];
  bans: BanSuggestion[];
  /** Heroes used as the "enemy lineup" for pick scoring: picked heroes, then each player's most likely pick. */
  likelyEnemies: DotaHero[];
  draft?: DraftAnalysis;
  picks: ScoutPick[];
  me?: PlayerAnalysis;
  generatedAt: Date;
}

/**
 * Up to +0.10 for a hero the requester plays a lot AND wins with: experience (saturating at 30 games) times
 * performance (0 at a 40% win rate, half at 50%, full at 60%+, win rate shrunk toward 50% for small samples).
 */
export function comfortBonus(games: number, wins: number): number {
  if (games <= 0) return 0;
  const performance = clamp01(0.5 + (adjustedWinRate(wins, games, 20) - 0.5) * 5);
  return 0.1 * Math.min(1, games / 30) * performance;
}

export class ScoutService {
  constructor(
    private readonly players: PlayerService,
    private readonly drafts: DraftService,
  ) {}

  async analyze(input: ScoutInput): Promise<ScoutAnalysis> {
    const unresolved = input.unresolved ?? [];
    if (!input.enemies.length) {
      throw new UserInputError(unresolved[0]?.error ?? "Give me at least one enemy player (Friend ID, profile link, or @mention of a linked user).");
    }
    if (input.enemies.length + unresolved.length > MAX_SCOUTED) throw new UserInputError(`I can scout at most ${MAX_SCOUTED} players.`);

    // One private profile shouldn't sink the whole scout.
    const [players, me] = await Promise.all([
      Promise.all(
        input.enemies.map(async ({ accountId, label }): Promise<ScoutedPlayer> => {
          try {
            const analysis = await this.players.analyze(accountId);
            return { accountId, label: label ?? analysis.profile.name ?? String(accountId), analysis };
          } catch (err) {
            if (err instanceof UserInputError) return { accountId, label: label ?? String(accountId), error: err.message };
            throw err;
          }
        }),
      ),
      input.myAccountId ? this.players.analyze(input.myAccountId).catch(() => undefined) : Promise.resolve(undefined),
    ]);

    players.push(...unresolved.map((u) => ({ accountId: 0, label: u.label, error: u.error })));
    const bans = suggestBans(players);
    const likelyEnemies = await this.likelyLineup(players, input.pickedEnemies ?? []);

    let draft: DraftAnalysis | undefined;
    let picks: ScoutPick[] = [];
    if (input.position && likelyEnemies.length) {
      draft = await this.drafts.analyze(
        { allies: input.allies ?? [], enemies: likelyEnemies.map((h) => String(h.id)), position: input.position, bracket: input.bracket },
        15,
      );
      picks = rankWithComfort(draft.candidates, me);
    }
    return { players, bans, likelyEnemies, draft, picks, me, generatedAt: new Date() };
  }

  private async likelyLineup(players: ScoutedPlayer[], picked: string[]): Promise<DotaHero[]> {
    const out: DotaHero[] = [];
    if (picked.length) {
      const resolved = await this.drafts.analyzeTeams({ allies: [], enemies: picked });
      out.push(...resolved.enemies.heroes);
    }
    for (const p of players) {
      const next = p.analysis?.likelyPicks.find((l) => !out.some((h) => h.id === l.hero.id));
      if (next && out.length < 5) out.push(next.hero);
    }
    return out;
  }
}

/** Heroes that are both likely and strong for these players, summed across players. */
export function suggestBans(players: ScoutedPlayer[], limit = 5): BanSuggestion[] {
  const byHero = new Map<number, BanSuggestion>();
  for (const p of players) {
    for (const pick of p.analysis?.likelyPicks ?? []) {
      const entry = byHero.get(pick.hero.id) ?? { hero: pick.hero, value: 0, players: [] };
      entry.value += banValue(pick);
      entry.players.push(p.label);
      byHero.set(pick.hero.id, entry);
    }
  }
  return [...byHero.values()]
    .sort((a, b) => b.value - a.value)
    .slice(0, limit)
    .map((b) => ({ ...b, value: round(b.value, 2) }));
}

export function rankWithComfort(candidates: DraftCandidate[], me: PlayerAnalysis | undefined): ScoutPick[] {
  const pool = new Map(me?.topHeroes.map((h) => [h.hero.id, h]) ?? []);
  return candidates
    .map((candidate) => {
      const mine = pool.get(candidate.hero.id);
      const bonus = mine ? comfortBonus(mine.games, mine.wins) : 0;
      return { candidate, score: round(candidate.score + bonus, 3), yourGames: mine?.games, yourWinRate: mine?.winRate };
    })
    .sort((a, b) => b.score - a.score);
}
