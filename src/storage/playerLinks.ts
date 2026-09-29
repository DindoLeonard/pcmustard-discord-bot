import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "../shared/logger.js";

export interface PlayerLink {
  accountId: number;
  linkedAt: string;
}

/**
 * Discord user ID -> Dota account ID, saved to a small JSON file so links survive restarts.
 * Users can only link themselves (enforced by the commands), so nobody is looked up by @mention without opting in.
 */
export class PlayerLinkStore {
  private links = new Map<string, PlayerLink>();

  /** `path` null = in-memory only (tests). */
  constructor(private readonly path: string | null) {
    if (path) this.load();
  }

  get(discordUserId: string): PlayerLink | undefined {
    return this.links.get(discordUserId);
  }

  set(discordUserId: string, accountId: number): void {
    this.links.set(discordUserId, { accountId, linkedAt: new Date().toISOString() });
    this.save();
  }

  remove(discordUserId: string): boolean {
    const had = this.links.delete(discordUserId);
    if (had) this.save();
    return had;
  }

  private load(): void {
    try {
      const raw = JSON.parse(readFileSync(this.path!, "utf8")) as Record<string, PlayerLink>;
      this.links = new Map(Object.entries(raw));
      logger.info("player links loaded", { count: this.links.size });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") logger.warn("player links unreadable, starting empty", { error: err });
    }
  }

  /** Write to a temp file then rename, so a crash mid-write can't corrupt the links. */
  private save(): void {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.links), null, 2));
    renameSync(tmp, this.path);
  }
}
