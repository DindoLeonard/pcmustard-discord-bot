import { EmbedBuilder } from "discord.js";
import type { MatchupExplanation } from "../../ai/prompts/matchup.prompt.js";
import type { Explained } from "../../assistant/dota.assistant.js";
import { TRAIT_LABEL } from "../../games/dota/knowledge/traits.js";
import { pct } from "../../games/dota/services/scoring.service.js";
import type { MatchupAnalysis } from "../../games/dota/types.js";
import { COLOR, bullets, field, fitEmbeds, positionSuffix, provenanceFooter, type ReplyPayload } from "./embeds.js";

const DIFFICULTY: Record<MatchupExplanation["laneDifficulty"], { label: string; color: number }> = {
  favored: { label: "Favored", color: 0x2ecc71 },
  even: { label: "Even", color: 0xf1c40f },
  difficult: { label: "Difficult", color: 0xe67e22 },
  very_difficult: { label: "Very difficult", color: 0xe74c3c },
};

export function renderMatchup(result: Explained<MatchupAnalysis, MatchupExplanation>, aiModel: string | null): ReplyPayload {
  const { analysis: a, explanation: e } = result;
  const me = a.hero.localizedName;
  const them = a.enemy.localizedName;
  const diff = e ? DIFFICULTY[e.laneDifficulty] : undefined;

  const embed = new EmbedBuilder().setTitle(`${me} vs ${them}${positionSuffix(a.position)}`).setColor(diff?.color ?? COLOR.info);
  if (a.hero.iconUrl) embed.setThumbnail(a.hero.imageUrl ?? a.hero.iconUrl);
  if (e) embed.setDescription(e.summary);

  const s = a.stat;
  const h2h = s.games > 0 ? `${pct(s.winRate)} for ${me} over ${s.games} games${s.lowSample ? " (small sample)" : ""}` : "No games in the data";
  embed.addFields(field("Head-to-head (OpenDota)", h2h, true));
  if (diff) embed.addFields(field("Lane difficulty (AI assessment)", diff.label, true));

  const edges = [
    a.heroExploits.length ? `${me} brings ${a.heroExploits.map((t) => TRAIT_LABEL[t]).join(", ")} (${them} is weak to it)` : undefined,
    a.enemyExploits.length ? `${them} brings ${a.enemyExploits.map((t) => TRAIT_LABEL[t]).join(", ")} (${me} is weak to it)` : undefined,
  ].filter((x): x is string => Boolean(x));
  if (edges.length) embed.addFields(field("Trait edges", bullets(edges)));

  if (e) {
    embed.addFields(
      field("Key threats", bullets(e.keyThreats)),
      field(`${me} power spikes`, bullets(e.powerSpikes.yours), true),
      field(`${them} power spikes`, bullets(e.powerSpikes.theirs), true),
      field("How to lane", bullets(e.laneApproach)),
      field("Mistakes to avoid", bullets(e.mistakesToAvoid)),
      field("When the matchup shifts", e.matchupShift),
    );
  }

  const cooldowns = a.enemyAbilities.filter((x) => x.cooldown && !x.isInnate).map((x) => `${x.name}: ${x.cooldown!.join("/")}s`);
  if (cooldowns.length) embed.addFields(field(`${them} cooldowns (OpenDota)`, bullets(cooldowns)));

  const start = a.popularItems.start.map((i) => i.name).join(", ");
  const early = a.popularItems.early.map((i) => i.name).join(", ");
  if (start || early) embed.addFields(field(`Popular ${me} items (OpenDota)`, `Start: ${start || "n/a"}\nEarly: ${early || "n/a"}`));
  if (e?.items.length) embed.addFields(field("Items for this matchup", bullets(e.items.map((i) => `**${i.name}** — ${i.why}`))));

  embed.setFooter({ text: provenanceFooter({ sources: a.sources, patch: result.patch, aiModel: e ? aiModel : null, aiNote: result.aiNote }) });
  return { embeds: fitEmbeds([embed]), components: [] };
}
