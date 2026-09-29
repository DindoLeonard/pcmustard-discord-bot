import { POSITION_LABEL, type Position } from "../../games/dota/knowledge/traits.js";
import type { PlayerAnalysis } from "../../games/dota/services/player.service.js";
import type { ScoutAnalysis } from "../../games/dota/services/scout.service.js";

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
