import type { Position } from "../games/dota/knowledge/traits.js";
import type { DotaHero } from "../games/dota/providers/dota.provider.js";
import { MAX_ALLIES, MAX_ENEMIES } from "../games/dota/services/draft.service.js";
import type { DraftInput } from "../games/dota/types.js";
import { UserInputError } from "../shared/errors.js";

export type DraftSide = "ally" | "enemy" | "ban";

export const MAX_BANS = 16;
const MAX_UNDO = 30;

export interface LiveDraft {
  key: string;
  /** The open slot the channel is picking for. */
  position?: Position;
  allies: string[];
  enemies: string[];
  bans: string[];
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  /** Last change, for the board footer ("Sam added Oracle to enemies"). */
  lastAction?: string;
  /** The board message, so the next update can replace it. */
  boardMessageId?: string;
  history: Pick<LiveDraft, "allies" | "enemies" | "bans" | "position">[];
}

export const NO_LIVE_DRAFT = "There's no live draft in this channel. Start one with `/dota live start`.";

/**
 * One live draft per channel, shared by everyone in it (like the conversation memory).
 * In-process only; a draft expires `ttlMs` after its last change.
 */
export class LiveDraftStore {
  private readonly drafts = new Map<string, LiveDraft>();

  constructor(
    private readonly resolveHero: (query: string) => Promise<DotaHero>,
    private readonly ttlMs = 2 * 60 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  get(key: string): LiveDraft | undefined {
    const d = this.drafts.get(key);
    if (d && this.now() - d.updatedAt > this.ttlMs) {
      this.drafts.delete(key);
      return undefined;
    }
    return d;
  }

  require(key: string): LiveDraft {
    const d = this.get(key);
    if (!d) throw new UserInputError(NO_LIVE_DRAFT);
    return d;
  }

  start(key: string, createdBy: string, position?: Position): LiveDraft {
    const t = this.now();
    const d: LiveDraft = { key, position, allies: [], enemies: [], bans: [], createdBy, createdAt: t, updatedAt: t, lastAction: `${createdBy} started the draft`, history: [] };
    this.drafts.set(key, d);
    return d;
  }

  end(key: string): LiveDraft | undefined {
    const d = this.get(key);
    this.drafts.delete(key);
    return d;
  }

  async add(key: string, side: DraftSide, heroQuery: string, by: string): Promise<{ draft: LiveDraft; hero: DotaHero }> {
    const d = this.require(key);
    const hero = await this.resolveHero(heroQuery);
    const name = hero.localizedName;
    const where = this.sideOf(d, name);
    if (where) throw new UserInputError(`${name} is already ${where === "ban" ? "banned" : where === "ally" ? "on your team" : "on the enemy team"}.`);
    const list = side === "ally" ? d.allies : side === "enemy" ? d.enemies : d.bans;
    const max = side === "ally" ? MAX_ALLIES : side === "enemy" ? MAX_ENEMIES : MAX_BANS;
    if (list.length >= max) {
      throw new UserInputError(
        side === "ally" ? `Your team already has ${MAX_ALLIES} other heroes (the 5th is your pick).` : side === "enemy" ? "The enemy team already has 5 heroes." : `That's ${MAX_BANS} bans already.`,
      );
    }
    this.snapshot(d);
    list.push(name);
    this.touch(d, `${by} ${side === "ban" ? "banned" : "added"} ${name}${side === "ban" ? "" : side === "ally" ? " to your team" : " to the enemy team"}`);
    return { draft: d, hero };
  }

  async remove(key: string, heroQuery: string, by: string): Promise<LiveDraft> {
    const d = this.require(key);
    const name = (await this.resolveHero(heroQuery)).localizedName;
    if (!this.sideOf(d, name)) throw new UserInputError(`${name} isn't in this draft.`);
    this.snapshot(d);
    d.allies = d.allies.filter((h) => h !== name);
    d.enemies = d.enemies.filter((h) => h !== name);
    d.bans = d.bans.filter((h) => h !== name);
    this.touch(d, `${by} removed ${name}`);
    return d;
  }

  setPosition(key: string, position: Position, by: string): LiveDraft {
    const d = this.require(key);
    this.snapshot(d);
    d.position = position;
    this.touch(d, `${by} set the open position to ${position}`);
    return d;
  }

  undo(key: string, by: string): LiveDraft {
    const d = this.require(key);
    const prev = d.history.pop();
    if (!prev) throw new UserInputError("Nothing to undo.");
    Object.assign(d, prev);
    this.touch(d, `${by} undid the last change`);
    return d;
  }

  /** Replace the lineup (used when chat questions update the live draft). */
  setLineup(key: string, allies: string[], enemies: string[], by: string, position?: Position): LiveDraft | undefined {
    const d = this.get(key);
    if (!d) return undefined;
    this.snapshot(d);
    d.allies = allies.slice(0, MAX_ALLIES);
    d.enemies = enemies.slice(0, MAX_ENEMIES);
    if (position) d.position = position;
    this.touch(d, `${by} updated the lineup from chat`);
    return d;
  }

  setBoard(key: string, messageId: string): void {
    const d = this.get(key);
    if (d) d.boardMessageId = messageId;
  }

  /** The draft as a /dota draft input, or a user-facing reason it can't be scored yet. */
  toInput(d: LiveDraft): DraftInput {
    if (!d.position) throw new UserInputError("Set the open position first: `/dota live position`.");
    if (!d.allies.length && !d.enemies.length) throw new UserInputError("Add at least one hero first: `/dota live ally` or `/dota live enemy`.");
    return { allies: d.allies, enemies: d.enemies, bans: d.bans, position: d.position };
  }

  private sideOf(d: LiveDraft, name: string): DraftSide | undefined {
    if (d.allies.includes(name)) return "ally";
    if (d.enemies.includes(name)) return "enemy";
    if (d.bans.includes(name)) return "ban";
    return undefined;
  }

  private snapshot(d: LiveDraft): void {
    d.history.push({ allies: [...d.allies], enemies: [...d.enemies], bans: [...d.bans], position: d.position });
    if (d.history.length > MAX_UNDO) d.history.shift();
  }

  private touch(d: LiveDraft, action: string): void {
    d.updatedAt = this.now();
    d.lastAction = action;
  }
}
