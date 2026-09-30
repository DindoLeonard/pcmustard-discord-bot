import type { SlashCommandSubcommandBuilder } from "discord.js";
import { assistant, playerLinks } from "../../../assistant/index.js";
import { resolvePlayerRef } from "../../../assistant/playerRefs.js";
import { renderMatchReview } from "../../components/meta.render.js";
import type { Subcommand } from "../types.js";
import { discordName } from "./player.js";

export function buildMatchSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return sub
    .setName("match")
    .setDescription("Review a match: how you (or a player) did, compared to others on the same hero")
    .addStringOption((o) => o.setName("match").setDescription("Match ID or OpenDota/Dotabuff link (default: the player's last match)").setRequired(false))
    .addStringOption((o) => o.setName("account").setDescription("Whose game to review: Friend ID or profile link (default: you)").setRequired(false))
    .addUserOption((o) => o.setName("user").setDescription("A Discord user who has linked their account").setRequired(false));
}

export const match: Subcommand = {
  async execute(interaction) {
    const matchRef = interaction.options.getString("match") ?? undefined;
    const account = interaction.options.getString("account");
    const user = interaction.options.getUser("user");
    // Whose performance: explicit account/user, else the asker if linked (optional when a match ID is given).
    const ref = account ?? (user ? `<@${user.id}>` : "me");
    let accountId: number | undefined;
    try {
      accountId = resolvePlayerRef(ref, playerLinks, interaction.user.id, (id) => (user?.id === id ? user.displayName : discordName(interaction, id))).accountId;
    } catch (err) {
      if (!matchRef || account || user) throw err; // only "me" is optional, and only with a match ID
    }
    await interaction.deferReply();
    const { review, summary } = await assistant.matchReview({ match: matchRef, accountId });
    await interaction.editReply(renderMatchReview(review, summary));
  },
};
