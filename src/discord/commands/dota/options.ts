import type { ChatInputCommandInteraction, SlashCommandIntegerOption, SlashCommandStringOption } from "discord.js";
import { POSITION_LABEL, POSITIONS, isPosition, type Position } from "../../../games/dota/knowledge/traits.js";

const RANKS = ["Herald", "Guardian", "Crusader", "Archon", "Legend", "Ancient", "Divine", "Immortal"];

export const heroOption = (name: string, description: string, required: boolean) => (o: SlashCommandStringOption) =>
  o.setName(name).setDescription(description).setRequired(required).setAutocomplete(true);

export const positionOption = (required: boolean, description = "Position you are playing") => (o: SlashCommandIntegerOption) =>
  o
    .setName("position")
    .setDescription(description)
    .setRequired(required)
    .addChoices(...POSITIONS.map((p) => ({ name: POSITION_LABEL[p], value: p })));

export const rankOption = (o: SlashCommandIntegerOption) =>
  o
    .setName("rank")
    .setDescription("Your rank bracket (uses that bracket's win rates for the meta score)")
    .setRequired(false)
    .addChoices(...RANKS.map((name, i) => ({ name, value: i + 1 })));

export function getPosition(interaction: ChatInputCommandInteraction): Position | undefined {
  const p = interaction.options.getInteger("position");
  return p !== null && isPosition(p) ? p : undefined;
}

export function getRank(interaction: ChatInputCommandInteraction): number | undefined {
  return interaction.options.getInteger("rank") ?? undefined;
}
