import { parseAccountRef } from "../games/dota/services/player.service.js";
import { UserInputError } from "../shared/errors.js";
import type { PlayerLinkStore } from "../storage/playerLinks.js";

export interface ResolvedPlayer {
  accountId: number;
  /** Display label, e.g. "@Leo" for a linked Discord user. */
  label?: string;
}

const MENTION = /^<@!?(\d+)>$/;
const ME = /^(me|myself|ako|nako|akoa|ko)$/i;

/**
 * Turn what a user typed into an account ID:
 * - "me" (also Bisaya "ako"/"nako"): the requester's own linked account
 * - "<@123>": a Discord user who linked their account with /dota link
 * - a Friend ID, Steam ID64, or OpenDota/Dotabuff/STRATZ/Steam profile link
 */
export function resolvePlayerRef(
  ref: string,
  links: PlayerLinkStore,
  requesterId?: string,
  nameOf?: (discordUserId: string) => string | undefined,
): ResolvedPlayer {
  const text = ref.trim();
  if (ME.test(text)) {
    const link = requesterId ? links.get(requesterId) : undefined;
    if (!link) throw new UserInputError("You haven't linked your Dota account yet. Use `/dota link account:<your Friend ID>` first.");
    return { accountId: link.accountId, label: "you" };
  }
  const mention = MENTION.exec(text);
  if (mention) {
    const userId = mention[1]!;
    const link = links.get(userId);
    const name = nameOf?.(userId);
    if (!link) throw new UserInputError(`${name ? `@${name}` : "That user"} hasn't linked a Dota account. They can do it with \`/dota link\`.`);
    return { accountId: link.accountId, label: name ? `@${name}` : undefined };
  }
  const accountId = parseAccountRef(text);
  if (!accountId) {
    throw new UserInputError(`"${text.slice(0, 40)}" doesn't look like a Dota account. Use the Friend ID from their Dota profile, or an OpenDota/Dotabuff link.`);
  }
  return { accountId };
}
