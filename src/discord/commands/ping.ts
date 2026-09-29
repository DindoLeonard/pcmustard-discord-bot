import { SlashCommandBuilder } from "discord.js";
import { VERSION } from "../../shared/version.js";
import type { Command } from "./types.js";

export const ping: Command = {
  data: new SlashCommandBuilder().setName("ping").setDescription("Check that the bot is alive"),
  async execute(interaction) {
    const latency = Date.now() - interaction.createdTimestamp;
    const ws = interaction.client.ws.ping;
    await interaction.reply({ content: `Pong! v${VERSION} · round-trip ${latency}ms${ws >= 0 ? `, gateway ${ws}ms` : ""}.` });
  },
};
