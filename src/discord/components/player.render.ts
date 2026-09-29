import { EmbedBuilder } from "discord.js";
import { POSITION_LABEL, type Position } from "../../games/dota/knowledge/traits.js";
import type { PlayerAnalysis } from "../../games/dota/services/player.service.js";
import type { ScoutAnalysis } from "../../games/dota/services/scout.service.js";
import { COLOR, bullets, field, fitEmbeds, formatDate, type ReplyPayload } from "./embeds.js";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const GUESS_NOTE = "Likely picks are a guess from recent and all-time match history, not a prediction.";

function daysAgo(unixSec: number): string {
  if (!unixSec) return "never";
  const d = Math.floor((Date.now() / 1000 - unixSec) / 86400);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d}d ago`;
}

export function renderPlayer(p: PlayerAnalysis, opts: { linkedTo?: string } = {}): ReplyPayload {
  const total = p.wins + p.losses;
  const embed = new EmbedBuilder()
    .setTitle(`${p.profile.name ?? `Account ${p.profile.accountId}`} · ${p.rank}`)
    .setURL(p.profileUrl)
    .setColor(COLOR.info);
  if (p.profile.avatarUrl) embed.setThumbnail(p.profile.avatarUrl);
  if (opts.linkedTo) embed.setDescription(`Linked to ${opts.linkedTo}`);

  embed.addFields(
    field("Record", total ? `${p.wins}W ${p.losses}L (${pct(p.wins / total)})` : "No games", true),
    field("Friend ID", String(p.profile.accountId), true),
  );
  if (p.likelyPicks.length) {
    embed.addFields(field("Likely picks", bullets(p.likelyPicks.map((l) => `**${l.hero.localizedName}** — ${l.reasons.join("; ")}`))));
  }
  if (p.topHeroes.length) {
    embed.addFields(
      field(
        "Most played",
        p.topHeroes
          .slice(0, 6)
          .map((h) => `${h.hero.localizedName} — ${h.games} games, ${pct(h.winRate)} win (${daysAgo(h.lastPlayed)})`)
          .join("\n"),
      ),
    );
  }
  if (p.recent.length) {
    const recent = p.recent.slice(0, 10).map((m) => `${m.won ? "W" : "L"} ${m.hero?.localizedName ?? "?"} ${m.kills}/${m.deaths}/${m.assists}`);
    embed.addFields(field(`Last ${recent.length} matches`, "```\n" + recent.join("\n") + "\n```"));
  }
  const src = p.sources[0];
  embed.setFooter({ text: `Stats: ${src?.source ?? "opendota"}${src ? ` · fetched ${formatDate(src.fetchedAt)}` : ""} · ${GUESS_NOTE}` });
  return { embeds: fitEmbeds([embed]), components: [] };
}

export function renderScout(s: ScoutAnalysis, position?: Position): ReplyPayload {
  const players = new EmbedBuilder().setTitle("Scouting report").setColor(COLOR.warn);
  for (const p of s.players) {
    if (!p.analysis) {
      players.addFields(field(p.label, `Couldn't scout: ${p.error ?? "no data"}`));
      continue;
    }
    const a = p.analysis;
    const likely = a.likelyPicks
      .slice(0, 3)
      .map((l) => `**${l.hero.localizedName}** (${l.recentGames ? `${l.recentGames}/${a.recent.length} recent` : "no recent games"}, ${l.allTimeGames} all-time)`)
      .join(", ");
    players.addFields(field(`${p.label}${p.label !== a.profile.name && a.profile.name ? ` (${a.profile.name})` : ""} · ${a.rank}`, likely || "No hero data"));
  }
  if (s.bans.length) {
    players.addFields(field("Suggested bans", bullets(s.bans.map((b) => `**${b.hero.localizedName}** — likely pick for ${b.players.join(", ")}`))));
  }
  players.setFooter({ text: GUESS_NOTE });

  const embeds = [players];
  if (position && s.picks.length) {
    const picks = new EmbedBuilder()
      .setTitle(`Picks for ${POSITION_LABEL[position]} vs their likely heroes`)
      .setColor(COLOR.good)
      .setDescription(`Scored against: ${s.likelyEnemies.map((h) => h.localizedName).join(", ")}`);
    s.picks.slice(0, 5).forEach((p, i) => {
      const c = p.candidate;
      const reasons = c.reasons.filter((r) => r.type === "counter" || r.type === "team_need").map((r) => r.description);
      const yours = p.yourGames ? `\nYour pool: ${p.yourGames} games, ${pct(p.yourWinRate ?? 0)} win` : "";
      picks.addFields(field(`${i + 1}. ${c.hero.localizedName} · score ${p.score.toFixed(2)}`, `${reasons.join("; ") || "Fits the position."}${yours}`));
    });
    if (s.me) picks.setFooter({ text: "Heroes from your own hero pool get a small comfort bonus." });
    embeds.push(picks);
  }
  return { embeds: fitEmbeds(embeds), components: [] };
}
