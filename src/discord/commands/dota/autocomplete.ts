import type { AutocompleteInteraction } from "discord.js";
import { dota } from "../../../games/registry.js";

/** Shared hero autocomplete: the choice value is the hero id, so resolve() matches exactly. */
export async function heroAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused();
  const heroes = await dota.heroes.search(focused, 25);
  await interaction.respond(heroes.map((h) => ({ name: h.localizedName, value: String(h.id) })));
}
