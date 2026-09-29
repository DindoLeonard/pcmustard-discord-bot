import type { GameCharacter } from "./hero.js";

/** Provenance attached to every piece of fetched game data. */
export interface DataSource {
  source: string;
  fetchedAt: Date;
  patch?: string;
}

export interface Sourced<T> extends DataSource {
  data: T;
}

export interface GameAdapter {
  readonly game: string;
  readonly displayName: string;

  resolveCharacter(name: string): Promise<GameCharacter | null>;
  searchCharacters(prefix: string, limit?: number): Promise<GameCharacter[]>;
}
