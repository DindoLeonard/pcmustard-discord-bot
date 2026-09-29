import { z } from "zod";
import type { AIRequest } from "../types.js";

export const GAME_INTENTS = [
  "counter_character",
  "matchup_advice",
  "draft_analysis",
  "pick_recommendation",
  "why_not_pick",
  "hero_info",
  "general_strategy",
  "small_talk",
  "forget_memory",
  "dota_news",
  "other_game",
  "web_lookup",
] as const;

export type GameIntent = (typeof GAME_INTENTS)[number];

export const intentSchema = z.object({
  game: z.enum(["dota2", "other"]).describe('"other" only for questions about a different video game'),
  intent: z.enum(GAME_INTENTS),
  hero: z
    .string()
    .nullable()
    .describe("Hero to counter (counter_character), the player's own hero (matchup_advice, or their already-picked hero in a draft), the subject of hero_info, or the hero asked about in why_not_pick"),
  enemy: z.string().nullable().describe("Enemy hero for matchup_advice"),
  position: z
    .number()
    .int()
    .min(1)
    .max(5)
    .nullable()
    .describe("pick_recommendation/why_not_pick: the slot the player still has to pick. Otherwise: the position the player plays. 1 carry, 2 mid, 3 offlane, 4 soft support, 5 hard support"),
  allies: z.array(z.string()).describe("Allied heroes named in the NEW MESSAGE only (including the player's own already-picked hero)"),
  enemies: z.array(z.string()).describe("Enemy heroes named in the NEW MESSAGE only"),
  removed: z.array(z.string()).describe("Heroes the NEW MESSAGE says were removed/swapped out of the draft being discussed"),
  continuesDraft: z.boolean().describe("true if the NEW MESSAGE builds on the draft lineup from CONVERSATION SO FAR"),
});

export type ParsedIntent = z.infer<typeof intentSchema>;

const SYSTEM = `You convert Dota 2 players' questions into a structured request for a game-analysis bot. You do not answer the question.

Intents:
- counter_character: "what counters X", "how do I beat X" (single enemy hero). Put the enemy in "hero".
- matchup_advice: the player names their own hero AND one enemy hero ("I'm Invoker mid vs Huskar"). "hero" = player's hero, "enemy" = enemy hero.
- pick_recommendation: the player still has to pick and wants suggestions ("what should I pick", "what pos 4 into this?"). "position" = the slot they are picking.
- draft_analysis: evaluate lineups or give team advice without asking for a pick ("what are we missing", "how should we adjust", "is our draft ok", "I picked AM pos 5, what should my team do?"). The player's already-picked hero goes in allies (and "hero"); "position" = the position they play, or null.
- why_not_pick: asks why a specific hero wasn't recommended, or how it compares, for the draft being discussed ("why not Earthshaker?", "is Lich ok instead?"). "hero" = that hero.
- hero_info: asks about one hero in general ("how do I play Puck").
- general_strategy: Dota strategy question with no specific heroes, or a Dota question that fits none of the above.
- forget_memory: the user asks the bot to forget / reset / clear the conversation, in any language ("forget everything", "kalimti na tanan", "kalimutan mo na").
- small_talk: greetings, thanks, reactions, testing the bot, jokes, or questions about the bot itself, including whether it can search ("hey how are you?", "thanks!", "gg", "can you search?"). game = "dota2".
- web_lookup: a real-world question that needs facts or current information from the web and isn't about a video game: opening/closing hours, addresses, prices, weather, news, events, sports, "what is X" facts ("what time does Anytime Fitness Escario close?", "weather in Cebu today"). game = "dota2".
- dota_news: Dota 2 facts that change over time and need up-to-date information: patch notes and what changed in a patch, hero/item reworks, new heroes, tournaments (TI, majors), esports results, pro players/teams, news, events, battle pass. game = "dota2".
- other_game: a question about a different video game (Valheim, Valorant, League, CS2...). Set game "other".

Rules:
- Messages may be in any language or a mix: Bisaya/Cebuano, Tagalog, Taglish/Bislish, English. Understand them the same way (e.g. "unsa may counter sa PA?" = what counters PA; "naa mi Axe" = we have Axe; "sila kay Storm" = they have Storm). Hero names stay in English.
- Expand common nicknames to full names when obvious (storm -> Storm Spirit, ls -> Lifestealer, wr -> Windranger, am -> Anti-Mage) but otherwise copy hero names as written.
- Positions: carry/safelane=1, mid=2, offlane=3, soft support/roamer=4, hard support=5. If they say "support" without detail, use 5 for picks and null otherwise.
- "we/our/my team" and the player's own pick are allies; "they/them/enemy" heroes are enemies.
- allies/enemies/removed contain ONLY heroes written in the NEW MESSAGE. Never copy heroes from the conversation into them - the bot merges the earlier lineup itself when continuesDraft is true.
- Use null / [] / false for anything not mentioned.

Follow-ups (when CONVERSATION SO FAR is given):
- Several friends share this conversation. A new message may continue what anyone asked earlier.
- Single-hero references may be resolved from the most recent relevant turn: "what about vs Lion?" after a matchup keeps the player's hero (set "hero") and changes "enemy"; "only supports" / "for pos 4" after a counter keeps "hero" and sets position; "what counters him?" uses the hero just discussed.
- continuesDraft = true when the message adds to, changes, or asks about the draft being discussed ("they also picked Oracle", "pos 4", "why not Lich?", "we swapped Lion for Lich" -> enemies/allies [Lich], removed [Lion]). If the message starts a new lineup or is unrelated, continuesDraft = false. A message that lists heroes for BOTH teams is a new lineup (continuesDraft = false), even if a draft was discussed before.
- If the message is unrelated to earlier turns, ignore the history.`;

export function intentPrompt(text: string, history = ""): AIRequest<ParsedIntent> {
  return {
    task: "intent.parse",
    schemaName: "game_intent",
    schema: intentSchema,
    system: SYSTEM,
    user: history ? `${history}\n\nNEW MESSAGE:\n${text.slice(0, 1500)}` : text.slice(0, 1500),
    maxOutputTokens: 700,
  };
}
