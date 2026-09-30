import type { AIService } from "../ai/ai.service.js";
import { teamsContext } from "../ai/prompts/chat.prompt.js";
import { counterContext, counterPrompt, type CounterExplanation } from "../ai/prompts/counter.prompt.js";
import { candidateBlock, draftContext, draftPrompt, whyNotPrompt, type DraftExplanation, type WhyNotExplanation } from "../ai/prompts/draft.prompt.js";
import { heroContext, heroGuessPrompt, heroPrompt, type HeroExplanation } from "../ai/prompts/general.prompt.js";
import { matchupContext, matchupPrompt, type MatchupExplanation } from "../ai/prompts/matchup.prompt.js";
import { chatPrompt } from "../ai/prompts/chat.prompt.js";
import { matchContext, metaContext, playerContext, scoutContext } from "../ai/prompts/player.prompt.js";
import type { MatchReview, ReviewInput } from "../games/dota/services/match.service.js";
import type { MetaAnalysis } from "../games/dota/services/meta.service.js";
import type { WebTopic } from "../ai/prompts/web.prompt.js";
import type { PlayerAnalysis } from "../games/dota/services/player.service.js";
import type { ScoutAnalysis, ScoutInput } from "../games/dota/services/scout.service.js";
import type { DotaAdapter } from "../games/dota/dota.adapter.js";
import { getKnowledge } from "../games/dota/knowledge/heroTraits.js";
import { POSITION_LABEL, type Position } from "../games/dota/knowledge/traits.js";
import type { DotaHero } from "../games/dota/providers/dota.provider.js";
import type { CounterOptions } from "../games/dota/services/counter.service.js";
import type { MatchupOptions } from "../games/dota/services/matchup.service.js";
import type { CounterAnalysis, DraftAnalysis, DraftCandidate, DraftInput, MatchupAnalysis, TeamsAnalysis } from "../games/dota/types.js";
import type { Sourced } from "../games/types/game.js";
import { HeroNotFoundError, UserInputError } from "../shared/errors.js";
import { logger } from "../shared/logger.js";

/** A deterministic analysis plus an optional AI explanation. `explanation` is null when AI failed or is off. */
export interface Explained<A, E> {
  analysis: A;
  explanation: E | null;
  /** Why there is no explanation, or what was stripped from it. User-facing. */
  aiNote?: string;
  patch?: string;
}

export interface WhyNotBase {
  analysis: DraftAnalysis;
  alternative: DraftCandidate;
  rank: number;
  top: DraftCandidate;
  patch?: string;
}

export type WhyNotResult = WhyNotBase & Explained<DraftAnalysis, WhyNotExplanation>;

export type TeamsInput = Pick<DraftInput, "allies" | "enemies">;

/** A natural-language request, already merged with conversation memory. Same inputs as the slash commands. */
export type ChatRequest =
  | { kind: "counter"; hero: string; position?: Position }
  | { kind: "matchup"; hero: string; enemy: string; position?: Position }
  | { kind: "draft"; input: DraftInput }
  | { kind: "teams"; input: TeamsInput }
  | { kind: "whynot"; input: DraftInput; hero: string }
  | { kind: "hero"; hero: string }
  | { kind: "general" }
  /** Answered by web search, not our data: other games, Dota news/patch notes. */
  | { kind: "web"; topic: WebTopic }
  | { kind: "player"; accountId: number; label?: string }
  | { kind: "scout"; input: ScoutInput }
  | { kind: "meta"; position?: Position; bracket?: number }
  | { kind: "match"; match?: string; accountId?: number; playerName?: string };

/** Deterministic analysis for a chat request plus the text the chat reply is grounded in. */
export type Grounded = { data: string; patch?: string } & (
  | { kind: "counter"; analysis: CounterAnalysis }
  | { kind: "matchup"; analysis: MatchupAnalysis }
  | { kind: "draft"; analysis: DraftAnalysis }
  | { kind: "teams"; analysis: TeamsAnalysis }
  | { kind: "whynot"; result: WhyNotBase }
  | { kind: "hero"; hero: Sourced<DotaHero> }
  | { kind: "general" }
  | { kind: "player"; analysis: PlayerAnalysis; label?: string }
  | { kind: "scout"; analysis: ScoutAnalysis; position?: Position }
  | { kind: "meta"; analysis: MetaAnalysis }
  | { kind: "match"; review: MatchReview }
);

export const COUNTER_EXPLAIN_COUNT = 5;
export const DRAFT_EXPLAIN_COUNT = 3;

const AI_OFF_NOTE = "AI explanations are off (no OPENAI_API_KEY) - showing data only.";
const AI_FAILED_NOTE = "AI explanation unavailable right now - showing data only.";

export class DotaAssistant {
  constructor(
    private readonly dota: DotaAdapter,
    private readonly ai: AIService,
  ) {}

  get aiAvailable(): boolean {
    return this.ai.available;
  }

  async counter(hero: string, options: CounterOptions = {}): Promise<Explained<CounterAnalysis, CounterExplanation>> {
    const analysis = await this.withHeroGuess(() => this.dota.counters.analyze(hero, options));
    const patch = await this.patch();
    if (!analysis.candidates.length) return { analysis, explanation: null, patch };
    if (!this.ai.available) return { analysis, explanation: null, aiNote: AI_OFF_NOTE, patch };

    const explained = analysis.candidates.slice(0, COUNTER_EXPLAIN_COUNT);
    const [targetAbilities, ...candidateAbilities] = await Promise.all([
      this.abilities(analysis.target),
      ...explained.map((c) => this.abilities(c.hero)),
    ]);
    const res = await this.ai.tryGenerate(
      counterPrompt({
        analysis,
        explainCount: COUNTER_EXPLAIN_COUNT,
        patch,
        targetAbilities: targetAbilities!,
        candidateAbilities: new Map(explained.map((c, i) => [c.hero.id, candidateAbilities[i]!.map((a) => a.name)])),
      }),
    );
    if (!res.ok) return { analysis, explanation: null, aiNote: AI_FAILED_NOTE, patch };

    const names = new Set(explained.map((c) => c.hero.localizedName));
    const items = await this.validateItems(res.data.items);
    return {
      analysis,
      explanation: { ...res.data, picks: res.data.picks.filter((p) => names.has(p.hero)), items: items.kept },
      aiNote: items.note,
      patch,
    };
  }

  async matchup(hero: string, enemy: string, options: MatchupOptions = {}): Promise<Explained<MatchupAnalysis, MatchupExplanation>> {
    const analysis = await this.withHeroGuess(() => this.dota.matchups.analyze(hero, enemy, options));
    const patch = await this.patch();
    if (!this.ai.available) return { analysis, explanation: null, aiNote: AI_OFF_NOTE, patch };
    const res = await this.ai.tryGenerate(matchupPrompt(analysis, patch));
    if (!res.ok) return { analysis, explanation: null, aiNote: AI_FAILED_NOTE, patch };
    const items = await this.validateItems(res.data.items);
    return { analysis, explanation: { ...res.data, items: items.kept }, aiNote: items.note, patch };
  }

  async draft(input: DraftInput): Promise<Explained<DraftAnalysis, DraftExplanation>> {
    const analysis = await this.withHeroGuess(() => this.dota.drafts.analyze(input));
    const patch = await this.patch();
    if (!analysis.candidates.length) return { analysis, explanation: null, patch };
    if (!this.ai.available) return { analysis, explanation: null, aiNote: AI_OFF_NOTE, patch };
    const res = await this.ai.tryGenerate(draftPrompt(analysis, DRAFT_EXPLAIN_COUNT, patch));
    if (!res.ok) return { analysis, explanation: null, aiNote: AI_FAILED_NOTE, patch };
    const names = new Set(analysis.candidates.slice(0, DRAFT_EXPLAIN_COUNT).map((c) => c.hero.localizedName));
    return { analysis, explanation: { ...res.data, picks: res.data.picks.filter((p) => names.has(p.hero)) }, patch };
  }

  /** "Why not X?" for a draft: X must be one of the scored candidates. */
  async whyNot(input: DraftInput, heroId: number): Promise<WhyNotResult> {
    const base = await this.whyNotData(input, heroId);
    if (!this.ai.available) return { ...base, explanation: null, aiNote: AI_OFF_NOTE };
    const res = await this.ai.tryGenerate(whyNotPrompt(base.analysis, base.alternative, base.rank, base.patch));
    return res.ok ? { ...base, explanation: res.data } : { ...base, explanation: null, aiNote: AI_FAILED_NOTE };
  }

  /** Every hero's display name (to constrain AI output to real heroes). */
  async heroNames(): Promise<string[]> {
    return (await this.dota.heroes.list()).data.map((h) => h.localizedName);
  }

  /** Match review plus a short AI coach summary (null summary when the AI is off or fails). */
  async matchReview(input: ReviewInput): Promise<{ review: MatchReview; summary?: string }> {
    const review = await this.dota.matches.review(input);
    if (!this.ai.available) return { review };
    const res = await this.ai.tryGenerate(
      chatPrompt({
        question: review.focus
          ? "Give a short coach's summary of how this player did in this match: 2-3 sentences, one thing that went well and one concrete thing to improve."
          : "Summarize how this match went in 2-3 sentences.",
        data: matchContext(review),
      }),
    );
    return { review, summary: res.ok ? res.data.reply.slice(0, 1000) : undefined };
  }

  /** Lineup analysis without pick candidates (data only). */
  async teams(input: TeamsInput): Promise<Explained<TeamsAnalysis, never>> {
    const analysis = await this.withHeroGuess(() => this.dota.drafts.analyzeTeams(input));
    return { analysis, explanation: null, patch: await this.patch() };
  }

  /**
   * Deterministic analysis + grounding text for a chat reply, with no AI explanation call.
   * The chat reply is the only AI call on the natural-language path.
   */
  async ground(request: ChatRequest): Promise<Grounded> {
    const patch = await this.patch();
    switch (request.kind) {
      case "counter": {
        const analysis = await this.withHeroGuess(() => this.dota.counters.analyze(request.hero, { position: request.position }));
        const explained = analysis.candidates.slice(0, COUNTER_EXPLAIN_COUNT);
        const [targetAbilities, ...candidateAbilities] = await Promise.all([analysis.target, ...explained.map((c) => c.hero)].map((h) => this.abilities(h)));
        const data = counterContext({
          analysis,
          explainCount: COUNTER_EXPLAIN_COUNT,
          patch,
          targetAbilities: targetAbilities!,
          candidateAbilities: new Map(explained.map((c, i) => [c.hero.id, candidateAbilities[i]!.map((a) => a.name)])),
        });
        return { kind: "counter", analysis, data, patch };
      }
      case "matchup": {
        const analysis = await this.withHeroGuess(() => this.dota.matchups.analyze(request.hero, request.enemy, { position: request.position }));
        return { kind: "matchup", analysis, data: matchupContext(analysis, patch), patch };
      }
      case "draft": {
        const analysis = await this.withHeroGuess(() => this.dota.drafts.analyze(request.input));
        const data = [draftContext(analysis, patch), "", "RANKED CANDIDATES (statistics from OpenDota):", ...analysis.candidates.slice(0, 5).map(candidateBlock)].join("\n");
        return { kind: "draft", analysis, data, patch };
      }
      case "teams": {
        const analysis = await this.withHeroGuess(() => this.dota.drafts.analyzeTeams(request.input));
        return { kind: "teams", analysis, data: teamsContext(analysis, patch), patch };
      }
      case "whynot": {
        const { hero } = await this.withHeroGuess(() => this.dota.heroes.resolve(request.hero));
        const result = await this.whyNotData(request.input, hero.data.id);
        const data = [
          draftContext(result.analysis, patch),
          "",
          "TOP PICK:",
          candidateBlock(result.top, 0),
          "",
          `HERO THE USER ASKED ABOUT (ranked #${result.rank}):`,
          candidateBlock(result.alternative, result.rank - 1),
        ].join("\n");
        return { kind: "whynot", result, data, patch };
      }
      case "hero": {
        const { hero } = await this.withHeroGuess(() => this.dota.heroes.resolve(request.hero));
        const abilities = await this.abilities(hero.data);
        return { kind: "hero", hero, data: heroContext(hero.data, getKnowledge(hero.data.localizedName), abilities, patch), patch };
      }
      case "player": {
        const analysis = await this.dota.players.analyze(request.accountId);
        return { kind: "player", analysis, label: request.label, data: playerContext(analysis, request.label), patch };
      }
      case "scout": {
        const analysis = await this.dota.scouts.analyze(request.input);
        return { kind: "scout", analysis, position: request.input.position, data: scoutContext(analysis, request.input.position), patch };
      }
      case "meta": {
        const analysis = await this.dota.meta.analyze({ position: request.position, bracket: request.bracket });
        return { kind: "meta", analysis, data: metaContext(analysis), patch };
      }
      case "match": {
        const review = await this.dota.matches.review({ match: request.match, accountId: request.accountId, playerName: request.playerName });
        return { kind: "match", review, data: matchContext(review), patch };
      }
      case "general":
      case "web":
        return { kind: "general", data: "", patch };
    }
  }

  private async whyNotData(input: DraftInput, heroId: number): Promise<WhyNotBase> {
    const analysis = await this.dota.drafts.analyze(input, 200);
    const index = analysis.candidates.findIndex((c) => c.hero.id === heroId);
    if (index < 0) {
      const inDraft = [...analysis.allies.heroes, ...analysis.enemies.heroes].find((h) => h.id === heroId);
      if (inDraft) throw new UserInputError(`${inDraft.localizedName} is already in this draft.`);
      const hero = (await this.dota.provider.getHero(heroId))?.data;
      const k = hero ? getKnowledge(hero.localizedName) : undefined;
      if (hero && k) {
        throw new UserInputError(
          `${hero.localizedName} wasn't considered because it doesn't usually play ${POSITION_LABEL[input.position]} (it plays pos ${k.positions.join(", ")}).`,
        );
      }
      throw new UserInputError("That hero isn't a valid candidate for this draft any more.");
    }
    return { analysis, alternative: analysis.candidates[index]!, rank: index + 1, top: analysis.candidates[0]!, patch: await this.patch() };
  }

  async heroExplain(heroQuery: string): Promise<Explained<DotaHero, HeroExplanation>> {
    const { hero } = await this.withHeroGuess(() => this.dota.heroes.resolve(heroQuery));
    const patch = await this.patch();
    if (!this.ai.available) return { analysis: hero.data, explanation: null, aiNote: AI_OFF_NOTE, patch };
    const abilities = await this.abilities(hero.data);
    const res = await this.ai.tryGenerate(heroPrompt(hero.data, getKnowledge(hero.data.localizedName), abilities, patch));
    return res.ok
      ? { analysis: hero.data, explanation: res.data, patch }
      : { analysis: hero.data, explanation: null, aiNote: AI_FAILED_NOTE, patch };
  }

  /**
   * Run `fn`; if it fails to resolve a hero, ask the AI which hero was meant (from the real hero list only)
   * and rethrow with those guesses first. The user still confirms by re-running: we never silently swap heroes.
   */
  async withHeroGuess<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof HeroNotFoundError) || !this.ai.available) throw err;
      const names = (await this.dota.heroes.list()).data.map((h) => h.localizedName) as [string, ...string[]];
      const res = await this.ai.tryGenerate(heroGuessPrompt(err.query, names));
      if (!res.ok || !res.data.matches.length) throw err;
      // Edit-distance suggestions are useful for typos ("invokr") but noise for descriptions
      // ("the fat guy with the hook"), so drop them for longer queries once the AI has an answer.
      const descriptive = err.query.trim().split(/\s+/).length >= 3 || err.query.length > 16;
      const merged = [...new Set([...res.data.matches, ...(descriptive ? [] : err.suggestions)])].slice(0, 5);
      logger.info("ai hero guess", { query: err.query, guesses: res.data.matches });
      throw new HeroNotFoundError(err.query, merged, res.data.matches.length);
    }
  }

  async patch(): Promise<string | undefined> {
    try {
      return (await this.dota.provider.getPatch()).data.name;
    } catch {
      return undefined;
    }
  }

  private async abilities(hero: DotaHero) {
    try {
      return (await this.dota.provider.getHeroAbilities(hero.name)).data;
    } catch (err) {
      logger.warn("ability lookup failed", { hero: hero.localizedName, error: err });
      return [];
    }
  }

  /** Drop item names that don't exist in OpenDota's item list (hallucination guard). */
  private async validateItems<T extends { name: string }>(items: T[]): Promise<{ kept: T[]; note?: string }> {
    try {
      const { valid, rejected } = await this.dota.items.validateNames(items.map((i) => i.name));
      if (rejected.length) logger.warn("ai suggested unknown items", { rejected });
      const kept = items.filter((i) => valid.some((v) => v.toLowerCase() === i.name.toLowerCase()));
      return { kept: kept.map((i) => ({ ...i, name: valid.find((v) => v.toLowerCase() === i.name.toLowerCase())! })) };
    } catch {
      return { kept: items, note: "Item names could not be verified against OpenDota." };
    }
  }
}
