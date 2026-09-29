import { UnknownGameError } from "../shared/errors.js";
import { DotaAdapter } from "./dota/dota.adapter.js";
import type { GameAdapter } from "./types/game.js";

export const dota = new DotaAdapter();

export const gameRegistry = new Map<string, GameAdapter>([[dota.game, dota]]);

export function getAdapter(game: string): GameAdapter {
  const adapter = gameRegistry.get(game);
  if (!adapter) throw new UnknownGameError(game);
  return adapter;
}
