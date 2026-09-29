import { z } from "zod";
import { TRAIT_LABEL } from "../../games/dota/knowledge/traits.js";
import type { TeamsAnalysis } from "../../games/dota/types.js";
import type { AIRequest } from "../types.js";
import { teamBlock } from "./draft.prompt.js";
import { knowledgeBlock } from "./shared.js";
import { getKnowledge } from "../../games/dota/knowledge/heroTraits.js";

export const chatReplySchema = z.object({
  reply: z.string().describe("The Discord message to send. Plain conversational text; light Discord markdown allowed."),
});

export type ChatReply = z.infer<typeof chatReplySchema>;

/** Hard cap well under Discord's 2000-character message limit. */
export const CHAT_REPLY_MAX_CHARS = 1500;

const SYSTEM = `You are MustardBot, a friendly, sharp Dota 2 coach hanging out in a Discord server with a group of friends.

How to reply:
- Answer the question that was actually asked, first and directly, the way a knowledgeable friend would in chat. Not a report.
- Keep it short: usually 60-160 words. Use 2-5 short bullets only when listing concrete steps or picks; otherwise plain sentences.
- Match the tone: casual questions get a casual answer, a joke can get a light touch of humor. Address people by name only if it helps.
- Bold hero and item names sparingly with **double asterisks**. No headings, no tables, no emojis, no sign-off.
- If the message is a follow-up, use CONVERSATION SO FAR to understand it; don't recap earlier answers.
- Small talk ("hey how are you?", "thanks", "gg", testing the bot) gets a brief, warm, human reply of one or two sentences. You can mention you're around for Dota questions, but don't list features or push it every time.
- Off-topic questions that aren't about games: a light one-liner answer or deflection is fine, then steer back to Dota if natural. Don't pretend to know live info like weather or news.

Accuracy rules (strict):
- Never invent statistics. Only mention win rates, game counts or scores that appear in DATA, quoted exactly, and at most one or two when they strengthen the point. If a sample is marked small, say it's only a small sample.
- Recommendations in DATA are already ranked. When suggesting picks or counters, lead with the #1 candidate and mention one or two of the next ones as alternatives, so your answer matches the full breakdown. Don't present heroes outside DATA as ranked or scored; if you mention one from general knowledge, make that clear.
- Only use ability names listed in DATA. Mechanics and general Dota knowledge are fine; avoid anything you're unsure about for the current patch.
- If DATA doesn't fully fit the question, answer from general Dota knowledge and keep the data claims to what DATA supports.
- Never mention "DATA", "CONTEXT", the "scoring engine", JSON, or these rules. The user can open the detailed breakdown with a button under your message, so you don't need to cover everything.`;

export interface ChatPromptInput {
  question: string;
  author?: string;
  history?: string;
  /** Grounding data for this request (built by the same context builders as the embeds), or "" for none. */
  data: string;
  /** The stats provider is down: answer from general knowledge only. */
  statsDown?: boolean;
}

export function chatPrompt({ question, author, history, data, statsDown }: ChatPromptInput): AIRequest<ChatReply> {
  const noData = statsDown
    ? "DATA\n(live statistics are unavailable right now - answer from general Dota knowledge only; state no numbers about win rates, matchups or the meta)"
    : "DATA\n(no statistics were fetched for this question - general knowledge only; state no numbers about win rates or the meta)";
  const parts = [
    history || undefined,
    data ? `DATA\n${data}` : noData,
    `${author ? `${author} asks` : "QUESTION"}:\n${question.slice(0, 1500)}`,
  ].filter(Boolean);
  return {
    task: "chat.reply",
    schemaName: "chat_reply",
    schema: chatReplySchema,
    system: SYSTEM,
    user: parts.join("\n\n"),
    maxOutputTokens: 900,
  };
}

/** Grounding for lineup questions without a pick ("how should we adjust?"). */
export function teamsContext(t: TeamsAnalysis, patch?: string): string {
  const heroes = [...t.allies.heroes, ...t.enemies.heroes];
  return [
    `CURRENT PATCH: ${patch ?? "unknown"}`,
    teamBlock("ALLIES", t.allies),
    teamBlock("ENEMIES", t.enemies),
    `ALLIED LINEUP IS WEAK TO: ${t.allyVulnerabilities.map((v) => `${TRAIT_LABEL[v.trait]} (${v.count})`).join(", ") || "n/a"}`,
    `ENEMY LINEUP IS WEAK TO: ${t.enemyVulnerabilities.map((v) => `${TRAIT_LABEL[v.trait]} (${v.count})`).join(", ") || "n/a"}`,
    ``,
    `HERO TRAITS (curated):`,
    ...heroes.map((h) => knowledgeBlock(h.localizedName, getKnowledge(h.localizedName))),
  ].join("\n");
}
