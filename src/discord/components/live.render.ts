import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type MessageActionRowComponentBuilder } from "discord.js";
import { MAX_BANS, type LiveDraft } from "../../assistant/liveDraft.js";
import { POSITION_LABEL } from "../../games/dota/knowledge/traits.js";
import { MAX_ALLIES, MAX_ENEMIES } from "../../games/dota/services/draft.service.js";
import { COLOR, field, type ReplyPayload } from "./embeds.js";

const slots = (heroes: string[], max: number) => Array.from({ length: max }, (_, i) => `${i + 1}. ${heroes[i] ?? "—"}`).join("\n");

export const LIVE_IDS = { suggest: "live:suggest", undo: "live:undo", end: "live:end" };

/** The shared draft board: updated after every change, with Suggest / Undo / End buttons. */
export function renderLiveBoard(d: LiveDraft): ReplyPayload {
  const embed = new EmbedBuilder()
    .setTitle(`Live draft — ${d.position ? `picking ${POSITION_LABEL[d.position]}` : "open position not set"}`)
    .setColor(COLOR.info)
    .addFields(
      field(`Your team (${d.allies.length}/${MAX_ALLIES} + you)`, slots(d.allies, MAX_ALLIES), true),
      field(`Enemy team (${d.enemies.length}/${MAX_ENEMIES})`, slots(d.enemies, MAX_ENEMIES), true),
      field(`Bans (${d.bans.length}/${MAX_BANS})`, d.bans.join(", ") || "—"),
    )
    .setFooter({ text: `${d.lastAction ?? ""} · add heroes with /dota live ally|enemy|ban · expires 2h after the last change` });
  const row = new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
    new ButtonBuilder().setCustomId(LIVE_IDS.suggest).setLabel("Suggest a pick").setStyle(ButtonStyle.Primary).setDisabled(!d.position || (!d.allies.length && !d.enemies.length)),
    new ButtonBuilder().setCustomId(LIVE_IDS.undo).setLabel("Undo").setStyle(ButtonStyle.Secondary).setDisabled(!d.history.length),
    new ButtonBuilder().setCustomId(LIVE_IDS.end).setLabel("End draft").setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row] };
}

export function renderLiveEnded(d: LiveDraft | undefined, by: string): ReplyPayload {
  const embed = new EmbedBuilder()
    .setTitle("Live draft ended")
    .setColor(COLOR.warn)
    .setDescription(d ? `Your team: ${d.allies.join(", ") || "—"}\nEnemy team: ${d.enemies.join(", ") || "—"}\nBans: ${d.bans.join(", ") || "—"}` : "No draft was running.")
    .setFooter({ text: `Ended by ${by}` });
  return { embeds: [embed], components: [] };
}
