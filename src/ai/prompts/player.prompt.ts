import { POSITION_LABEL, type Position } from "../../games/dota/knowledge/traits.js";
import type { PlayerAnalysis } from "../../games/dota/services/player.service.js";
import type { ScoutAnalysis } from "../../games/dota/services/scout.service.js";
import type { MatchReview } from "../../games/dota/services/match.service.js";
import type { MetaAnalysis } from "../../games/dota/services/meta.service.js";

const pct = (n: number) => `${Math.round(n * 100)}%`;

/** Grounding for "what does this player play?" (all numbers from OpenDota). */
export function playerContext(p: PlayerAnalysis, label?: string): string {
  const total = p.wins + p.losses;
  return [
    "QUESTION TYPE: about this player (what they play, like, main or pick; their rank). Answer with THEIR heroes and stats below, not with counters to them, unless the user explicitly asks how to beat them.",
    `PLAYER (OpenDota): ${p.profile.name ?? "unknown name"}${label ? ` (${label})` : ""}, Friend ID ${p.profile.accountId}`,
    `RANK: ${p.rank}`,
    `RECORD: ${p.wins}W ${p.losses}L${total ? ` (${pct(p.wins / total)})` : ""}`,
    `MOST PLAYED: ${p.topHeroes.map((h) => `${h.hero.localizedName} ${h.games} games ${pct(h.winRate)} win`).join("; ") || "n/a"}`,
    `LAST ${Math.min(10, p.recent.length)} MATCHES (newest first): ${p.recent
      .slice(0, 10)
      .map((m) => `${m.hero?.localizedName ?? "?"} ${m.won ? "W" : "L"} ${m.kills}/${m.deaths}/${m.assists}`)
      .join("; ") || "n/a"}`,
    `LIKELY NEXT PICKS (bot's estimate from recent + all-time play, not a prediction):`,
    ...p.likelyPicks.map((l, i) => `  ${i + 1}. ${l.hero.localizedName}: ${l.reasons.join("; ")}`),
  ].join("\n");
}

/** Grounding for "what's strong right now?" (OpenDota public hero stats for the current patch). */
export function metaContext(m: MetaAnalysis): string {
  const scope = [m.position ? POSITION_LABEL[m.position] : "all positions", m.bracket ? `rank bracket ${m.bracket}` : "all ranks"].join(", ");
  const row = (r: MetaAnalysis["strongest"][number]) =>
    `${r.hero.localizedName} ${(r.winRate * 100).toFixed(1)}% win, picked in ${(r.pickRate * 100).toFixed(1)}% of games${r.positionFit !== undefined && r.positionFit < 1 ? ", secondary position" : ""}`;
  return [
    `QUESTION TYPE: current meta for ${scope}. Recommend from STRONGEST first; win rates are sample-size adjusted in the ranking.`,
    `SAMPLE: ${m.matches} public matches (OpenDota)`,
    `STRONGEST (ranked): ${m.strongest.map(row).join("; ") || "n/a"}`,
    `MOST PICKED: ${m.popular.slice(0, 8).map((r) => `${r.hero.localizedName} ${(r.pickRate * 100).toFixed(1)}%`).join("; ") || "n/a"}`,
    `MOST CONTESTED IN PRO GAMES: ${m.pro.map((r) => `${r.hero.localizedName} ${r.proPicks} picks/${r.proBans} bans`).join("; ") || "n/a"}`,
  ].join("\n");
}

/** Grounding for a match review ("how did I do last game?"). */
export function matchContext(r: MatchReview): string {
  const m = r.match;
  const f = r.focus;
  const lines = [
    "QUESTION TYPE: review of one match. Talk about how the reviewed player did and what to improve, using only the numbers below.",
    `MATCH ${m.matchId} (OpenDota): ${r.mode}, ${r.duration}, ${m.radiantWin ? "Radiant" : "Dire"} won ${m.radiantScore}:${m.direScore}${m.parsed ? "" : " (replay not parsed: no laning/ward data)"}`,
  ];
  if (!f) {
    lines.push("REVIEWED PLAYER: none identified. Give a match overview; do not assume the asker played in this match or which side they were on.");
  }
  if (f) {
    const p = f.player;
    lines.push(
      `REVIEWED PLAYER: ${p.name ?? "unknown"} on ${f.hero?.localizedName ?? "?"} (${p.isRadiant ? "Radiant" : "Dire"}), ${f.won ? "WON" : "LOST"}`,
      `  KDA ${p.kills}/${p.deaths}/${p.assists} (team average deaths ${f.teamAvgDeaths}); kill participation ${f.killParticipation !== null ? pct(f.killParticipation) : "n/a"}; hero damage share ${f.damageShare !== null ? pct(f.damageShare) : "n/a"}`,
      `  GPM ${p.gpm}, XPM ${p.xpm}, LH/DN ${p.lastHits}/${p.denies}, net worth ${p.netWorth} (#${f.netWorthRank} on team), level ${p.level}`,
      `  Items: ${f.items.join(", ") || "none"}${f.neutralItem ? `; neutral ${f.neutralItem}` : ""}`,
      `  Percentiles vs other ${f.hero?.localizedName ?? "same-hero"} players: ${f.benchmarks.map((b) => `${b.label} ${pct(b.pct)}`).join(", ") || "n/a"}`,
      `  Went well: ${f.strengths.join("; ") || "nothing stood out"}`,
      `  To improve: ${f.concerns.join("; ") || "nothing stood out"}`,
    );
  }
  const team = (t: MatchReview["radiant"], label: string) =>
    `${label}${t.won ? " (won)" : ""}: ${t.players.map((p) => `${p.hero?.localizedName ?? "?"} ${p.kills}/${p.deaths}/${p.assists} ${p.gpm}gpm`).join("; ")}`;
  lines.push(team(r.radiant, "RADIANT"), team(r.dire, "DIRE"));
  return lines.join("\n");
}

/** Grounding for "scout these enemies". */
export function scoutContext(s: ScoutAnalysis, position?: Position): string {
  const lines = ["SCOUTED ENEMY PLAYERS (OpenDota):"];
  for (const p of s.players) {
    if (!p.analysis) {
      lines.push(`- ${p.label}: could not be scouted (${p.error ?? "no data"})`);
      continue;
    }
    const a = p.analysis;
    lines.push(`- ${p.label} (${a.rank}): likely ${a.likelyPicks.slice(0, 3).map((l) => `${l.hero.localizedName} [${l.reasons.join("; ")}]`).join(", ")}`);
  }
  lines.push(`SUGGESTED BANS (likely and strong for them): ${s.bans.map((b) => `${b.hero.localizedName} (for ${b.players.join(", ")})`).join("; ") || "none"}`);
  if (position && s.picks.length) {
    lines.push(`PICKS FOR ${POSITION_LABEL[position]} vs their likely heroes (${s.likelyEnemies.map((h) => h.localizedName).join(", ")}), ranked:`);
    s.picks.slice(0, 5).forEach((p, i) => {
      const why = p.candidate.reasons.filter((r) => r.type === "counter").map((r) => r.description).join("; ");
      lines.push(`  ${i + 1}. ${p.candidate.hero.localizedName} score ${p.score.toFixed(2)}${why ? ` - ${why}` : ""}${p.yourGames ? ` - in the asker's pool: ${p.yourGames} games ${pct(p.yourWinRate ?? 0)} win` : ""}`);
    });
  }
  lines.push("Note: likely picks are estimates from match history; say so.");
  return lines.join("\n");
}
