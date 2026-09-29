import { isPosition, type Position } from "../../games/dota/knowledge/traits.js";
import type { DraftInput } from "../../games/dota/types.js";

/**
 * Component custom IDs carry all the state they need (Discord allows 100 chars), so buttons and
 * menus keep working after a restart without a session store. Heroes are encoded by numeric id.
 *
 *   hero:explain:<heroId>
 *   hero:counters:<heroId>
 *   draft:whynot:<pos>:<bracket|0>:<allyIds, dot-separated>:<enemyIds>
 */
export const customId = {
  heroExplain: (heroId: number) => `hero:explain:${heroId}`,
  heroCounters: (heroId: number) => `hero:counters:${heroId}`,
  draftWhyNot: (position: Position, bracket: number | undefined, allyIds: number[], enemyIds: number[]) =>
    `draft:whynot:${position}:${bracket ?? 0}:${allyIds.join(".")}:${enemyIds.join(".")}`,
  // "Show full analysis" under a chat reply:
  //   full:counter:<heroId>:<pos|0>          full:matchup:<heroId>:<enemyId>:<pos|0>
  //   full:draft:<pos>:0:<allies>:<enemies>   full:teams:<allies>:<enemies>
  //   full:whynot:<pos>:0:<allies>:<enemies>:<heroId>
  fullCounter: (heroId: number, position?: Position) => `full:counter:${heroId}:${position ?? 0}`,
  fullMatchup: (heroId: number, enemyId: number, position?: Position) => `full:matchup:${heroId}:${enemyId}:${position ?? 0}`,
  fullDraft: (position: Position, allyIds: number[], enemyIds: number[]) => `full:draft:${position}:0:${allyIds.join(".")}:${enemyIds.join(".")}`,
  fullTeams: (allyIds: number[], enemyIds: number[]) => `full:teams:${allyIds.join(".")}:${enemyIds.join(".")}`,
  fullWhyNot: (position: Position, allyIds: number[], enemyIds: number[], heroId: number) =>
    `full:whynot:${position}:0:${allyIds.join(".")}:${enemyIds.join(".")}:${heroId}`,
  //   full:player:<accountId>   full:scout:<pos|0>:<accountIds>   (5 x 10-digit IDs + separators < 100 chars)
  fullPlayer: (accountId: number) => `full:player:${accountId}`,
  fullScout: (position: Position | undefined, accountIds: number[]) => `full:scout:${position ?? 0}:${accountIds.join(".")}`,
};

export const idList = (s: string | undefined) => (s ?? "").split(".").filter((x) => /^\d+$/.test(x));

export function positionArg(s: string | undefined): Position | undefined {
  const n = Number(s);
  return isPosition(n) ? n : undefined;
}

export interface ParsedCustomId {
  scope: string;
  action: string;
  args: string[];
}

export function parseCustomId(id: string): ParsedCustomId {
  const [scope = "", action = "", ...args] = id.split(":");
  return { scope, action, args };
}

export function decodeDraft(args: string[]): DraftInput | null {
  const [pos, bracket, allies = "", enemies = ""] = args;
  const position = Number(pos);
  if (!isPosition(position)) return null;
  const ids = (s: string) => s.split(".").filter((x) => /^\d+$/.test(x));
  const b = Number(bracket);
  return { position, bracket: b > 0 ? b : undefined, allies: ids(allies), enemies: ids(enemies) };
}
