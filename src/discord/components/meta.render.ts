import { EmbedBuilder } from "discord.js";
import { POSITION_LABEL } from "../../games/dota/knowledge/traits.js";
import type { MetaAnalysis, MetaHero } from "../../games/dota/services/meta.service.js";
import type { MatchReview } from "../../games/dota/services/match.service.js";
import { rankLabel } from "../../games/dota/services/player.service.js";
import { COLOR, bracketLabel, bullets, field, fitEmbeds, provenanceFooter, type ReplyPayload } from "./embeds.js";

const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;

function metaLine(r: MetaHero, i: number): string {
  const secondary = r.positionFit !== undefined && r.positionFit < 1 ? " *(secondary)*" : "";
  return `${i + 1}. **${r.hero.localizedName}** — ${pct(r.winRate)} win, in ${pct(r.pickRate)} of games${secondary}`;
}

export function renderMeta(m: MetaAnalysis): ReplyPayload {
  const scope = [m.position ? POSITION_LABEL[m.position] : "All positions", m.bracket ? bracketLabel(m.bracket) : "all ranks"].join(" · ");
  const embed = new EmbedBuilder()
    .setTitle(`Current meta — ${scope}`)
    .setColor(COLOR.info)
    .setDescription(`Based on ${m.matches.toLocaleString("en-US")} public matches. Win rates are adjusted for sample size, and "strongest" only counts heroes in at least 1% of games.`)
    .addFields(
      field("Strongest", m.strongest.map(metaLine).join("\n") || "Not enough data"),
      field("Most picked", m.popular.slice(0, 8).map((r, i) => `${i + 1}. ${r.hero.localizedName} (${pct(r.pickRate)})`).join("\n") || "n/a", true),
    );
  if (m.pro.length) {
    embed.addFields(field("Most contested in pro games", m.pro.map((r) => `${r.hero.localizedName} — ${r.proPicks} picks, ${r.proBans} bans`).join("\n"), true));
  }
  embed.setFooter({ text: provenanceFooter({ sources: m.sources, patch: m.sources[0]?.patch }) });
  return { embeds: [embed], components: [] };
}

export function renderMatchReview(r: MatchReview, aiSummary?: string): ReplyPayload {
  const m = r.match;
  const f = r.focus;
  const title = f
    ? `${f.won ? "Win" : "Loss"} as ${f.hero?.localizedName ?? "?"} — ${f.player.kills}/${f.player.deaths}/${f.player.assists}`
    : `${m.radiantWin ? "Radiant" : "Dire"} victory — ${m.radiantScore}:${m.direScore}`;
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setURL(`https://www.opendota.com/matches/${m.matchId}`)
    .setColor(f ? (f.won ? COLOR.good : COLOR.warn) : COLOR.info);
  if (f?.hero?.imageUrl) embed.setThumbnail(f.hero.imageUrl);
  if (aiSummary) embed.setDescription(aiSummary);

  embed.addFields(field("Match", `${r.mode} · ${r.duration} · score ${m.radiantScore}:${m.direScore} · ID ${m.matchId}`));
  if (f) {
    const p = f.player;
    embed.addFields(
      field("Economy", `GPM ${p.gpm} · XPM ${p.xpm} · LH/DN ${p.lastHits}/${p.denies} · net worth ${p.netWorth.toLocaleString("en-US")} (#${f.netWorthRank} on team)`),
      field(
        "Impact",
        [
          `Hero damage ${p.heroDamage.toLocaleString("en-US")}${f.damageShare !== null ? ` (${pct(f.damageShare, 0)} of team)` : ""}`,
          f.killParticipation !== null ? `kill participation ${pct(f.killParticipation, 0)}` : undefined,
          p.towerDamage ? `tower damage ${p.towerDamage.toLocaleString("en-US")}` : undefined,
          p.heroHealing ? `healing ${p.heroHealing.toLocaleString("en-US")}` : undefined,
        ]
          .filter(Boolean)
          .join(" · "),
      ),
    );
    if (f.strengths.length) embed.addFields(field("Went well", bullets(f.strengths)));
    if (f.concerns.length) embed.addFields(field("To improve", bullets(f.concerns)));
    embed.addFields(field("Items", [f.items.join(", ") || "none", f.neutralItem ? `neutral: ${f.neutralItem}` : undefined].filter(Boolean).join(" · ")));
  }

  const teamLine = (t: MatchReview["radiant"]) =>
    t.players
      .map((p) => `${p.hero?.localizedName ?? "?"} ${p.kills}/${p.deaths}/${p.assists}${p.name ? ` · ${p.name.slice(0, 16)}` : ""}${p.rankTier ? ` (${rankLabel(p.rankTier)})` : ""}`)
      .join("\n");
  embed.addFields(field(`Radiant${r.radiant.won ? " ✓" : ""}`, teamLine(r.radiant), true), field(`Dire${r.dire.won ? " ✓" : ""}`, teamLine(r.dire), true));

  const parseNote = m.parsed
    ? undefined
    : r.parseRequested
      ? "Replay not parsed yet: I asked OpenDota to parse it, so run this again in a few minutes for laning and ward data."
      : "Replay not parsed: laning and ward data unavailable.";
  embed.setFooter({ text: provenanceFooter({ sources: r.sources, extra: "percentiles compare against other players of the same hero", aiNote: parseNote }) });
  return { embeds: fitEmbeds([embed]), components: [] };
}
