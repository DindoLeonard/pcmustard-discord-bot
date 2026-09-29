import type { AIService } from "../ai/ai.service.js";
import { CHAT_REPLY_MAX_CHARS, chatPrompt } from "../ai/prompts/chat.prompt.js";
import { intentPrompt, type ParsedIntent } from "../ai/prompts/intent.prompt.js";
import { webSearchPrompt } from "../ai/prompts/web.prompt.js";
import type { WebSource } from "../ai/types.js";
import { POSITION_LABEL, isPosition, type Position } from "../games/dota/knowledge/traits.js";
import type { DotaHero } from "../games/dota/providers/dota.provider.js";
import { pct } from "../games/dota/services/scoring.service.js";
import { DIMENSION_LABEL } from "../games/dota/services/team.service.js";
import type { Sourced } from "../games/types/game.js";
import { ProviderUnavailableError } from "../shared/errors.js";
import { logger } from "../shared/logger.js";
import type { ChatRequest, DotaAssistant, Grounded } from "./dota.assistant.js";
import { ConversationMemory, historyBlock, type Turn, type TurnContext } from "./memory.js";

/**
 * Natural language is only a front door: the parsed intent becomes the same inputs the slash commands use,
 * the same deterministic analysis runs, and the AI writes one conversational reply grounded in that data.
 */
export type AskResult =
  | { kind: "chat"; intent: ParsedIntent; request: ChatRequest; grounded: Grounded; reply: string; sources?: WebSource[] }
  /** The chat reply failed: render the data-only analysis instead. */
  | { kind: "fallback"; intent: ParsedIntent; request: ChatRequest; grounded: Grounded }
  | { kind: "message"; intent?: ParsedIntent; message: string; context?: TurnContext };

export const ASK_HELP =
  'Ask me things like "what counters Puck?", "I\'m Invoker mid vs Huskar, what do I do?" or "we have Axe and Lion, they have Storm and Lifestealer, what pos 4 should I pick?"';

/** Where a question came from: memory is shared by everyone in the same channel. */
export interface Conversation {
  key: string;
  author: string;
}

// Whole-message "forget" commands, matched before any AI call: English, Bisaya ("kalimti na tanan") and
// Tagalog ("kalimutan mo na"). Other phrasings are caught by the parser's forget_memory intent.
const FORGET =
  /^(please\s+)?(forget|reset|clear|kalimti|kalimte|kalimtan|limti|limtan|kalimutan)(\s+(it|that|this|everything|all|memory|the conversation|our conversation|chat|na|tanan|to|ni|ang|atong|istorya|mo|lahat|usapan))*[\s.!]*$/i;

/** Web answers list at most this many sources under the reply. */
export const MAX_SOURCES = 3;
export const NO_SOURCES_NOTE = "Found with a web search, but no source links came back, so double-check it.";

type Plan = { kind: "request"; request: ChatRequest } | { kind: "message"; message: string; context?: TurnContext };

export class AskService {
  constructor(
    private readonly assistant: DotaAssistant,
    private readonly ai: AIService,
    private readonly lookupHero: (query: string) => Promise<Sourced<DotaHero>>,
    readonly memory: ConversationMemory = new ConversationMemory(),
  ) {}

  async ask(text: string, conversation?: Conversation): Promise<AskResult> {
    const question = text.trim();
    if (!question) return { kind: "message", message: ASK_HELP };
    if (conversation && FORGET.test(question)) return this.forget(conversation.key);
    if (!this.ai.available) {
      return { kind: "message", message: "Natural-language questions need an AI provider (OPENAI_API_KEY). Use `/dota counter`, `/dota matchup` or `/dota draft` instead." };
    }

    const turns = conversation ? this.memory.get(conversation.key) : [];
    const history = historyBlock(turns);
    const parsed = await this.ai.tryGenerate(intentPrompt(question, history));
    if (!parsed.ok) return { kind: "message", message: "I couldn't understand that right now. Try the /dota commands instead." };
    const intent = parsed.data;
    logger.info("intent parsed", { intent: intent.intent, game: intent.game, continuesDraft: intent.continuesDraft, historyTurns: turns.length });

    // Never claim to forget without actually doing it, whatever language it was asked in.
    if (intent.intent === "forget_memory") {
      return conversation ? this.forget(conversation.key) : { kind: "message", message: "There was nothing to forget." };
    }

    const result = await this.answer(question, intent, turns, conversation?.author);
    if (conversation) this.remember(conversation, question, result);
    return result;
  }

  /** Exposed for tests: everything after intent parsing. */
  async answer(question: string, intent: ParsedIntent, turns: Turn[] = [], author?: string): Promise<AskResult> {
    const plan = await this.plan(intent, turns);
    if (plan.kind === "message") return { kind: "message", intent, message: plan.message, context: plan.context };
    if (plan.request.kind === "web") return this.answerFromWeb(question, intent, plan.request, turns, author);

    // If the stats provider is down, still answer from general knowledge and say so (CLAUDE.md data rules).
    let grounded: Grounded;
    let statsDown = false;
    try {
      grounded = await this.assistant.ground(plan.request);
    } catch (err) {
      if (!(err instanceof ProviderUnavailableError)) throw err;
      logger.warn("stats unavailable, answering from general knowledge", { request: plan.request.kind });
      grounded = { kind: "general", data: "" };
      statsDown = true;
    }
    const res = await this.ai.tryGenerate(chatPrompt({ question, author, history: historyBlock(turns), data: grounded.data, statsDown, webSearchAvailable: this.ai.webSearchAvailable }));
    if (!res.ok) {
      if (statsDown) throw new ProviderUnavailableError("opendota");
      return { kind: "fallback", intent, request: plan.request, grounded };
    }
    const reply = clipReply(res.data.reply);
    return {
      kind: "chat",
      intent,
      request: plan.request,
      grounded,
      reply: statsDown ? `${reply}\n-# Live Dota stats are unavailable right now, so this is general advice without current numbers.` : reply,
    };
  }

  /**
   * Questions our data can't answer (other games, Dota news): search the web and cite sources.
   * If search is off or fails, answer from general knowledge and say it may be out of date.
   */
  private async answerFromWeb(
    question: string,
    intent: ParsedIntent,
    request: Extract<ChatRequest, { kind: "web" }>,
    turns: Turn[],
    author?: string,
  ): Promise<AskResult> {
    const grounded: Grounded = { kind: "general", data: "" };
    const history = historyBlock(turns);
    if (this.ai.webSearchAvailable) {
      const res = await this.ai.trySearchWeb(webSearchPrompt({ question, author, history, topic: request.topic }));
      if (res.ok) {
        const sources = res.data.sources.slice(0, MAX_SOURCES);
        // Some results (e.g. weather widgets) come back without citations: say so rather than show no provenance.
        const reply = sources.length ? clipReply(res.data.text) : `${clipReply(res.data.text)}\n-# ${NO_SOURCES_NOTE}`;
        return { kind: "chat", intent, request, grounded, reply, sources };
      }
    }
    // Search is off or just failed: be honest that this answer comes without a live lookup.
    const fallback = await this.ai.tryGenerate(chatPrompt({ question, author, history, data: "", webSearchAvailable: false }));
    if (!fallback.ok) return { kind: "message", intent, message: "I couldn't look that up right now. Try again in a moment." };
    return {
      kind: "chat",
      intent,
      request,
      grounded,
      reply: `${clipReply(fallback.data.reply)}\n-# I couldn't search the web for this, so it's from general knowledge and may be out of date.`,
    };
  }

  /**
   * Intent -> request. Draft lineups are merged here, deterministically: the parser only reports heroes named
   * in the new message, so heroes from unrelated earlier turns can't leak into a draft.
   */
  async plan(intent: ParsedIntent, turns: Turn[] = []): Promise<Plan> {
    // Other games and time-sensitive Dota info (patches, tournaments) aren't in our data: look them up.
    if (intent.game !== "dota2" || intent.intent === "other_game") return { kind: "request", request: { kind: "web", topic: "other_game" } };
    if (intent.intent === "dota_news") return { kind: "request", request: { kind: "web", topic: "dota_news" } };
    if (intent.intent === "web_lookup") return { kind: "request", request: { kind: "web", topic: "general" } };
    const position = intent.position !== null && isPosition(intent.position) ? intent.position : undefined;

    switch (intent.intent) {
      case "counter_character": {
        const target = intent.hero ?? intent.enemies[0] ?? intent.enemy;
        if (!target) return { kind: "message", message: "Which hero do you want to counter?" };
        return { kind: "request", request: { kind: "counter", hero: target, position } };
      }
      case "matchup_advice": {
        if (intent.hero && intent.enemy) return { kind: "request", request: { kind: "matchup", hero: intent.hero, enemy: intent.enemy, position } };
        const target = intent.enemy ?? intent.hero;
        if (!target) return { kind: "message", message: 'Tell me your hero and the enemy hero, e.g. "Invoker vs Huskar".' };
        return { kind: "request", request: { kind: "counter", hero: target, position } };
      }
      case "pick_recommendation":
      case "draft_analysis":
      case "why_not_pick": {
        const lineup = await this.mergeLineup(intent, turns);
        // A draft_analysis position is where the player *plays*, not a slot to fill, so it never starts a pick.
        const pickPosition = (intent.intent === "draft_analysis" ? undefined : position) ?? lineup.pickPosition;
        const context: TurnContext = { kind: "message", allies: lineup.allies, enemies: lineup.enemies, position: pickPosition };
        if (!lineup.allies.length && !lineup.enemies.length) {
          return { kind: "message", message: 'List some heroes from either team, e.g. "they have Storm and Lifestealer".', context };
        }
        // "They also picked Oracle" after a pick recommendation should re-score the pick, not drop to a team summary.
        if (intent.intent === "draft_analysis" && !lineup.pickPosition) {
          return { kind: "request", request: { kind: "teams", input: { allies: lineup.allies, enemies: lineup.enemies } } };
        }
        if (!pickPosition) {
          return { kind: "message", message: "Which position are you picking for (1 carry, 2 mid, 3 offlane, 4 soft support, 5 hard support)?", context };
        }
        const input = { allies: lineup.allies, enemies: lineup.enemies, position: pickPosition };
        if (intent.intent === "why_not_pick") {
          if (!intent.hero) return { kind: "request", request: { kind: "draft", input } };
          return { kind: "request", request: { kind: "whynot", input, hero: intent.hero } };
        }
        return { kind: "request", request: { kind: "draft", input } };
      }
      case "hero_info":
        if (intent.hero) return { kind: "request", request: { kind: "hero", hero: intent.hero } };
        break;
      case "forget_memory":
        return { kind: "message", message: "There was nothing to forget." };
      case "general_strategy":
      case "small_talk":
        // Both become a plain chat reply with no stats; the chat prompt handles tone.
        break;
    }
    return { kind: "request", request: { kind: "general" } };
  }

  /** Previous lineup (if the message continues it) minus removed heroes plus newly named ones, deduped by hero. */
  private async mergeLineup(intent: ParsedIntent, turns: Turn[]): Promise<{ allies: string[]; enemies: string[]; pickPosition?: Position }> {
    // Naming heroes for both teams is a fresh lineup, even if the parser thought it continued an earlier one
    // (seen: an earlier Anti-Mage question leaking AM into a new "we have Axe and Lion, they have Storm" draft).
    const restatesBothTeams = intent.allies.length > 0 && intent.enemies.length > 0;
    const base = intent.continuesDraft && !restatesBothTeams ? lastLineup(turns) : undefined;
    const removed = new Set(await this.canonical(intent.removed));
    // Earlier heroes survive unless removed; heroes named now are always included ("swap Lion for Lich").
    const merge = async (previous: string[] = [], added: string[]) =>
      [...(await this.canonical(previous)).filter((n) => !removed.has(n)), ...(await this.canonical(added))].filter(unique);
    return {
      allies: await merge(base?.allies, intent.allies),
      enemies: await merge(base?.enemies, intent.enemies),
      // Only pick recommendations (and half-asked ones) carry a slot to fill; a team analysis's position is the player's own.
      pickPosition: base && base.kind !== "teams" ? base.position : undefined,
    };
  }

  /** Resolve names to canonical hero names so "am" and "Anti-Mage" dedupe. Unknown names are kept for the error path. */
  private async canonical(names: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const n of names) {
      try {
        out.push((await this.lookupHero(n)).data.localizedName);
      } catch {
        out.push(n);
      }
    }
    return out.filter(unique);
  }

  forget(key: string): AskResult {
    const n = this.memory.clear(key);
    logger.info("memory cleared", { turns: n });
    return {
      kind: "message",
      message: n ? `Okay, I've forgotten this channel's conversation (${n} message${n === 1 ? "" : "s"}).` : "There was nothing to forget in this channel.",
    };
  }

  private remember(conversation: Conversation, question: string, result: AskResult): void {
    this.memory.add(conversation.key, { author: conversation.author, question, answer: summarize(result), context: contextOf(result) });
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www./, "");
  } catch {
    return url;
  }
}

function unique<T>(v: T, i: number, all: T[]): boolean {
  return all.indexOf(v) === i;
}

function clipReply(text: string): string {
  const t = text.trim();
  return t.length <= CHAT_REPLY_MAX_CHARS ? t : `${t.slice(0, CHAT_REPLY_MAX_CHARS - 1).trimEnd()}…`;
}

/** Most recent turn that carried a lineup (a draft, a team analysis, or a half-asked draft). */
function lastLineup(turns: Turn[]): TurnContext | undefined {
  for (let i = turns.length - 1; i >= 0; i--) {
    const c = turns[i]!.context;
    if (c.allies?.length || c.enemies?.length) return c;
  }
  return undefined;
}

const names = (heroes: { localizedName: string }[]) => heroes.map((h) => h.localizedName);

/** One-line, deterministic description of what the analysis covered (no AI call). */
export function summarizeGrounded(g: Grounded): string {
  switch (g.kind) {
    case "counter": {
      const a = g.analysis;
      const pos = a.position ? ` for ${POSITION_LABEL[a.position]}` : "";
      return `Counters to ${a.target.localizedName}${pos}: ${names(a.candidates.slice(0, 5).map((c) => c.hero)).join(", ") || "none found"}`;
    }
    case "matchup": {
      const a = g.analysis;
      const s = a.stat;
      const h2h = s.games > 0 ? `${pct(s.winRate)} for ${a.hero.localizedName} over ${s.games} games` : "no head-to-head data";
      return `Lane guide ${a.hero.localizedName}${a.position ? ` (${POSITION_LABEL[a.position]})` : ""} vs ${a.enemy.localizedName}: ${h2h}`;
    }
    case "draft": {
      const d = g.analysis;
      const needs = d.allies.weaknesses.slice(0, 3).map((w) => DIMENSION_LABEL[w.dimension].toLowerCase());
      return `Draft for ${POSITION_LABEL[d.position]}; team needs ${needs.join(", ") || "nothing major"}; top picks ${names(d.candidates.slice(0, 3).map((c) => c.hero)).join(", ")}`;
    }
    case "teams": {
      const t = g.analysis;
      const needs = t.allies.weaknesses.slice(0, 3).map((w) => DIMENSION_LABEL[w.dimension].toLowerCase());
      return `Team analysis; allies ${names(t.allies.heroes).join(", ") || "none"} vs ${names(t.enemies.heroes).join(", ") || "unknown"}; needs ${needs.join(", ") || "nothing major"}`;
    }
    case "whynot": {
      const r = g.result;
      return `Compared ${r.alternative.hero.localizedName} (ranked #${r.rank}, score ${r.alternative.score.toFixed(2)}) with top pick ${r.top.hero.localizedName} (${r.top.score.toFixed(2)}) for ${POSITION_LABEL[r.analysis.position]}`;
    }
    case "hero":
      return `Hero overview for ${g.hero.data.localizedName}`;
    case "general":
      return "General advice";
  }
}

export function summarize(result: AskResult): string {
  switch (result.kind) {
    case "chat":
      if (result.request.kind === "web") return `Looked it up on the web${result.sources?.length ? ` (${result.sources.map((s) => hostOf(s.url)).join(", ")})` : ""}. Said: ${result.reply}`;
      return `${summarizeGrounded(result.grounded)}. Said: ${result.reply}`;
    case "fallback":
      return summarizeGrounded(result.grounded);
    case "message":
      return result.message;
  }
}

/** Structured state a follow-up can build on, using resolved hero names. */
export function contextOf(result: AskResult): TurnContext {
  if (result.kind === "message") return result.context ?? { kind: "message" };
  const g = result.grounded;
  switch (g.kind) {
    case "counter":
      return { kind: "counter", hero: g.analysis.target.localizedName, position: g.analysis.position };
    case "matchup":
      return { kind: "matchup", hero: g.analysis.hero.localizedName, enemy: g.analysis.enemy.localizedName, position: g.analysis.position };
    case "draft":
      return { kind: "draft", position: g.analysis.position, allies: names(g.analysis.allies.heroes), enemies: names(g.analysis.enemies.heroes) };
    case "teams": {
      const i = result.intent;
      const position = i.position !== null && isPosition(i.position) ? i.position : undefined;
      return { kind: "teams", hero: i.hero ?? undefined, position, allies: names(g.analysis.allies.heroes), enemies: names(g.analysis.enemies.heroes) };
    }
    case "whynot": {
      // Still "the draft we're discussing": keep its lineup for the next follow-up.
      const d = g.result.analysis;
      return { kind: "draft", position: d.position, allies: names(d.allies.heroes), enemies: names(d.enemies.heroes) };
    }
    case "hero":
      return { kind: "hero", hero: g.hero.data.localizedName };
    case "general":
      return { kind: "general" };
  }
}
