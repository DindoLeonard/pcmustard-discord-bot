import type { Position } from "../games/dota/knowledge/traits.js";

/** Structured state a follow-up can build on ("what about vs Lion?", "they also picked Oracle"). */
export interface TurnContext {
  kind: "counter" | "matchup" | "draft" | "teams" | "hero" | "general" | "message";
  hero?: string;
  enemy?: string;
  position?: Position;
  allies?: string[];
  enemies?: string[];
}

export interface Turn {
  /** Display name of whoever asked. */
  author: string;
  question: string;
  /** One-line summary of what the bot answered (never the full embed). */
  answer: string;
  context: TurnContext;
  at: number;
}

export interface MemoryOptions {
  maxTurns?: number;
  ttlMs?: number;
  now?: () => number;
}

const MAX_QUESTION_CHARS = 300;
const MAX_ANSWER_CHARS = 400;

/**
 * Short-term conversation memory, shared by everyone in a channel. In-process only: it's cleared on restart.
 * A channel's history expires `ttlMs` after its last turn.
 */
export class ConversationMemory {
  private readonly maxTurns: number;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly channels = new Map<string, Turn[]>();

  constructor(options: MemoryOptions = {}) {
    this.maxTurns = options.maxTurns ?? 6;
    this.ttlMs = options.ttlMs ?? 30 * 60 * 1000;
    this.now = options.now ?? Date.now;
  }

  static key(guildId: string | null | undefined, channelId: string): string {
    return `${guildId ?? "dm"}:${channelId}`;
  }

  /** Turns for a channel, oldest first. Expired history is dropped. */
  get(key: string): Turn[] {
    const turns = this.channels.get(key);
    if (!turns?.length) return [];
    const last = turns[turns.length - 1]!;
    if (this.now() - last.at > this.ttlMs) {
      this.channels.delete(key);
      return [];
    }
    return [...turns];
  }

  add(key: string, turn: Omit<Turn, "at">): void {
    if (this.maxTurns <= 0) return; // memory disabled (and slice(-0) would keep everything)
    const turns = this.get(key);
    turns.push({
      ...turn,
      question: clip(turn.question, MAX_QUESTION_CHARS),
      answer: clip(turn.answer, MAX_ANSWER_CHARS),
      at: this.now(),
    });
    this.channels.set(key, turns.slice(-this.maxTurns));
    this.sweep();
  }

  clear(key: string): number {
    const n = this.get(key).length;
    this.channels.delete(key);
    return n;
  }

  /** Drop expired channels so idle servers don't accumulate memory. */
  private sweep(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [key, turns] of this.channels) {
      if ((turns[turns.length - 1]?.at ?? 0) < cutoff) this.channels.delete(key);
    }
  }
}

function clip(s: string, max: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** Render history for a prompt, oldest first, with the structured context the parser can reuse. */
export function historyBlock(turns: Turn[]): string {
  if (!turns.length) return "";
  const lines = turns.map((t, i) => {
    const c = t.context;
    const state = [
      c.hero ? `hero=${c.hero}` : undefined,
      c.enemy ? `enemy=${c.enemy}` : undefined,
      c.position ? `position=${c.position}` : undefined,
      c.allies?.length ? `allies=[${c.allies.join(", ")}]` : undefined,
      c.enemies?.length ? `enemies=[${c.enemies.join(", ")}]` : undefined,
    ]
      .filter(Boolean)
      .join(" ");
    return `${i + 1}. ${t.author} asked: "${t.question}"\n   bot answered (${c.kind}${state ? `; ${state}` : ""}): ${t.answer}`;
  });
  return `CONVERSATION SO FAR IN THIS CHANNEL (oldest first; several people may be talking):\n${lines.join("\n")}`;
}
