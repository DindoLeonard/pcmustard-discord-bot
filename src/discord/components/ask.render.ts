import { ActionRowBuilder, ButtonBuilder, ButtonStyle, type MessageActionRowComponentBuilder } from "discord.js";
import type { AskResult } from "../../assistant/ask.service.js";
import type { Grounded } from "../../assistant/dota.assistant.js";
import type { WebSource } from "../../ai/types.js";
import { renderCounter } from "./counter.render.js";
import { customId } from "./customIds.js";
import { renderDraft, renderTeams, renderWhyNot } from "./draft.render.js";
import { renderHero, type ReplyPayload } from "./embeds.js";
import { renderMatchup } from "./matchup.render.js";
import { renderPlayer, renderScout } from "./player.render.js";

const ids = (heroes: { id: number }[]) => heroes.map((h) => h.id);

/** Button target for the detailed breakdown behind a chat reply, or null when there is none (general advice). */
export function fullAnalysisId(g: Grounded): string | null {
  switch (g.kind) {
    case "counter":
      return customId.fullCounter(g.analysis.target.id, g.analysis.position);
    case "matchup":
      return customId.fullMatchup(g.analysis.hero.id, g.analysis.enemy.id, g.analysis.position);
    case "draft":
      return customId.fullDraft(g.analysis.position, ids(g.analysis.allies.heroes), ids(g.analysis.enemies.heroes));
    case "teams":
      return customId.fullTeams(ids(g.analysis.allies.heroes), ids(g.analysis.enemies.heroes));
    case "whynot": {
      const d = g.result.analysis;
      return customId.fullWhyNot(d.position, ids(d.allies.heroes), ids(d.enemies.heroes), g.result.alternative.hero.id);
    }
    case "hero":
      return customId.heroExplain(g.hero.data.id);
    case "player":
      return customId.fullPlayer(g.analysis.profile.accountId);
    case "scout": {
      const scouted = g.analysis.players.filter((p) => p.accountId > 0).map((p) => p.accountId);
      return scouted.length ? customId.fullScout(g.position, scouted) : null;
    }
    case "general":
      return null;
  }
}

const DISCORD_MESSAGE_LIMIT = 2000;

/**
 * Append "-# Sources: [title](<url>) · …" (small grey text). The <url> form stops Discord from
 * unfurling a big preview card for every link. Sources are dropped from the end if the message would overflow.
 */
export function withSources(reply: string, sources: WebSource[] | undefined): string {
  if (!sources?.length) return reply;
  const link = (s: WebSource) => `[${s.title.replace(/[[\]]/g, "").slice(0, 60).trim() || new URL(s.url).hostname}](<${s.url}>)`;
  for (let n = sources.length; n > 0; n--) {
    const text = `${reply}\n-# Sources: ${sources.slice(0, n).map(link).join(" · ")}`;
    if (text.length <= DISCORD_MESSAGE_LIMIT) return text;
  }
  return reply;
}

const FALLBACK_NOTE = "Couldn't write a reply right now - here's the data instead.";

/** Data-only embeds for when the chat reply fails. */
function renderGrounded(g: Grounded): ReplyPayload {
  const base = { explanation: null, aiNote: FALLBACK_NOTE, patch: g.patch };
  switch (g.kind) {
    case "counter":
      return renderCounter({ ...base, analysis: g.analysis }, null);
    case "matchup":
      return renderMatchup({ ...base, analysis: g.analysis }, null);
    case "draft":
      return renderDraft({ ...base, analysis: g.analysis }, null);
    case "teams":
      return renderTeams({ ...base, analysis: g.analysis });
    case "whynot":
      return renderWhyNot({ ...base, ...g.result }, null);
    case "hero":
      return renderHero(g.hero, true);
    case "player":
      return renderPlayer(g.analysis, { linkedTo: g.label && g.label !== "you" ? g.label : undefined });
    case "scout":
      return renderScout(g.analysis, g.position);
    case "general":
      return { content: "I couldn't answer that right now. Try again in a moment.", embeds: [], components: [] };
  }
}

/** Chat replies read like a message from a friend; the detailed embeds sit behind a button. */
export function renderAsk(result: AskResult): ReplyPayload {
  switch (result.kind) {
    case "chat": {
      const target = fullAnalysisId(result.grounded);
      const components: ReplyPayload["components"] = target
        ? [
            new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
              new ButtonBuilder().setCustomId(target).setLabel("Show full analysis").setStyle(ButtonStyle.Secondary),
            ),
          ]
        : [];
      return { content: withSources(result.reply, result.sources), embeds: [], components };
    }
    case "fallback":
      return renderGrounded(result.grounded);
    case "message":
      return { content: result.message, embeds: [], components: [] };
  }
}
