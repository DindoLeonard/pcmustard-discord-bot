import { describe, expect, it } from "vitest";
import { AIService } from "../src/ai/ai.service.js";
import type { AIProvider, AIRequest, AIResponse } from "../src/ai/types.js";
import { DotaAssistant } from "../src/assistant/dota.assistant.js";
import { DotaAdapter } from "../src/games/dota/dota.adapter.js";
import { decodeDraft, customId, parseCustomId } from "../src/discord/components/customIds.js";
import { AIUnavailableError, HeroNotFoundError } from "../src/shared/errors.js";
import { FakeDotaProvider } from "./fixtures.js";

/** Returns canned data per task; a thrown Error simulates an AI outage. */
class FakeAI implements AIProvider {
  readonly name = "fake";
  readonly model = "fake-1";
  calls: string[] = [];
  constructor(private readonly responses: Record<string, unknown>) {}
  async generateResponse<T>(input: AIRequest<T>): Promise<AIResponse<T>> {
    this.calls.push(input.task);
    const r = this.responses[input.task];
    if (r instanceof Error || r === undefined) throw r ?? new AIUnavailableError(`no canned response for ${input.task}`);
    return { data: input.schema.parse(r), provider: this.name, model: this.model, latencyMs: 1 };
  }
}

function setup(responses: Record<string, unknown> | null) {
  const fake = responses ? new FakeAI(responses) : null;
  const dota = new DotaAdapter(new FakeDotaProvider());
  const assistant = new DotaAssistant(dota, new AIService(fake));
  return { fake, dota, assistant };
}

describe("DotaAssistant.counter", () => {
  it("keeps only candidates and items that exist in the data", async () => {
    const { assistant } = setup({
      "counter.explain": {
        picks: [
          { hero: "Disruptor", why: "Static Storm silences Puck" },
          { hero: "Totally Fake Hero", why: "invented" },
        ],
        strategy: ["be patient"],
        items: [
          { name: "black king bar", why: "real" },
          { name: "Sword of Hallucination", why: "invented" },
        ],
      },
    });
    const result = await assistant.counter("Puck");
    expect(result.explanation!.picks.map((p) => p.hero)).toEqual(["Disruptor"]);
    expect(result.explanation!.items.map((i) => i.name)).toEqual(["Black King Bar"]); // canonicalized
    expect(result.analysis.candidates.length).toBeGreaterThan(0);
  });

  it("falls back to data only when the AI fails", async () => {
    const { assistant } = setup({ "counter.explain": new AIUnavailableError("boom") });
    const result = await assistant.counter("Puck");
    expect(result.explanation).toBeNull();
    expect(result.aiNote).toMatch(/unavailable/);
    expect(result.analysis.candidates[0]!.reasons.length).toBeGreaterThan(0);
  });

  it("labels the response when AI is not configured", async () => {
    const { assistant } = setup(null);
    const result = await assistant.counter("Puck");
    expect(result.explanation).toBeNull();
    expect(result.aiNote).toMatch(/off/);
  });
});

describe("DotaAssistant.withHeroGuess", () => {
  it("puts AI guesses (real names only) first", async () => {
    const { assistant } = setup({ "hero.guess": { matches: ["Invoker"] } });
    const err = await assistant.counter("the guy with ten spells").catch((e) => e);
    expect(err).toBeInstanceOf(HeroNotFoundError);
    expect(err.suggestions).toEqual(["Invoker"]); // descriptive query: fuzzy noise dropped
    expect(err.aiSuggestionCount).toBe(1);
  });

  it("keeps fuzzy suggestions for short typos", async () => {
    const { assistant } = setup({ "hero.guess": { matches: ["Invoker"] } });
    const err = await assistant.counter("invkr").catch((e) => e);
    expect(err.suggestions[0]).toBe("Invoker");
  });

  it("rethrows the original error when the AI has no idea", async () => {
    const { assistant } = setup({ "hero.guess": { matches: [] } });
    const err = await assistant.counter("zzzzqqq").catch((e) => e);
    expect(err).toBeInstanceOf(HeroNotFoundError);
    expect(err.aiSuggestionCount).toBe(0);
  });
});

describe("DotaAssistant.whyNot", () => {
  it("compares an alternative against the top pick", async () => {
    const { assistant } = setup({ "draft.whynot": { verdict: "fine", comparison: ["a"], whenToPick: "b" } });
    const draft = await assistant.draft({ allies: ["Invoker"], enemies: ["Storm Spirit"], position: 5 });
    const alt = draft.analysis.candidates[1]!;
    const res = await assistant.whyNot({ allies: ["74"], enemies: ["17"], position: 5 }, alt.hero.id);
    expect(res.rank).toBe(2);
    expect(res.top.hero.id).toBe(draft.analysis.candidates[0]!.hero.id);
    expect(res.explanation?.verdict).toBe("fine");
  });
});

describe("component custom ids", () => {
  it("round-trips draft state within Discord's 100-char limit", () => {
    const id = customId.draftWhyNot(5, 8, [102, 103, 104, 105], [106, 107, 108, 109, 110]);
    expect(id.length).toBeLessThanOrEqual(100);
    const { scope, action, args } = parseCustomId(id);
    expect(`${scope}:${action}`).toBe("draft:whynot");
    expect(decodeDraft(args)).toEqual({ position: 5, bracket: 8, allies: ["102", "103", "104", "105"], enemies: ["106", "107", "108", "109", "110"] });
  });

  it("rejects malformed draft state", () => {
    expect(decodeDraft(["9", "0", "", ""])).toBeNull();
    expect(decodeDraft(["5", "0", "1.x.2", ""])).toEqual({ position: 5, bracket: undefined, allies: ["1", "2"], enemies: [] });
  });
});
