import { MessageFlags, type ChatInputCommandInteraction, type SlashCommandSubcommandBuilder } from "discord.js";
import { playerLinks } from "../../../assistant/index.js";
import { resolvePlayerRef } from "../../../assistant/playerRefs.js";
import { dota } from "../../../games/registry.js";
import { rankLabel } from "../../../games/dota/services/player.service.js";
import { UserInputError } from "../../../shared/errors.js";
import { renderPlayer } from "../../components/player.render.js";
import type { Subcommand } from "../types.js";

/** Best-effort display name for a Discord user ID (from cache; no extra API calls). */
export function discordName(interaction: ChatInputCommandInteraction, userId: string): string | undefined {
  const member = interaction.guild?.members.cache.get(userId);
  return member?.displayName ?? interaction.client.users.cache.get(userId)?.globalName ?? interaction.client.users.cache.get(userId)?.username;
}

export function buildPlayerSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return sub
    .setName("player")
    .setDescription("A player's rank, most played heroes, recent matches and likely picks")
    .addStringOption((o) => o.setName("account").setDescription("Friend ID or OpenDota/Dotabuff link (default: your linked account)").setRequired(false))
    .addUserOption((o) => o.setName("user").setDescription("A Discord user who has linked their account").setRequired(false));
}

export const player: Subcommand = {
  async execute(interaction) {
    const account = interaction.options.getString("account");
    const user = interaction.options.getUser("user");
    const ref = account ?? (user ? `<@${user.id}>` : "me");
    const resolved = resolvePlayerRef(ref, playerLinks, interaction.user.id, (id) => (user?.id === id ? user.displayName : discordName(interaction, id)));
    await interaction.deferReply();
    const analysis = await dota.players.analyze(resolved.accountId);
    await interaction.editReply(renderPlayer(analysis, { linkedTo: resolved.label && resolved.label !== "you" ? resolved.label : undefined }));
  },
};

export function buildLinkSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return sub
    .setName("link")
    .setDescription("Link your own Dota account (lets you use 'me', and lets friends @mention you)")
    .addStringOption((o) => o.setName("account").setDescription("Your Friend ID (Dota profile) or OpenDota/Dotabuff link").setRequired(true));
}

export const link: Subcommand = {
  async execute(interaction) {
    // Users can only link themselves: nobody's match history is tied to a Discord name without their say-so.
    const { accountId } = resolvePlayerRef(interaction.options.getString("account", true), playerLinks);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const profile = (await dota.provider.getPlayer(accountId)).data;
    playerLinks.set(interaction.user.id, accountId);
    await interaction.editReply({
      content: `Linked you to **${profile.name ?? accountId}** (${rankLabel(profile.rankTier, profile.leaderboardRank)}, Friend ID ${accountId}). Friends can now use \`/dota player user:@you\` and @mention you in \`/dota scout\`. Undo with \`/dota unlink\`.`,
    });
  },
};

export function buildUnlinkSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return sub.setName("unlink").setDescription("Remove the link between your Discord account and your Dota account");
}

export const unlink: Subcommand = {
  async execute(interaction) {
    const removed = playerLinks.remove(interaction.user.id);
    if (!removed) throw new UserInputError("You don't have a linked Dota account.");
    await interaction.reply({ content: "Unlinked. Your Dota account is no longer connected to your Discord account.", flags: MessageFlags.Ephemeral });
  },
};
