import { describe, expect, it } from "vitest";
import { AIService } from "../src/ai/ai.service.js";
import type { ParsedIntent } from "../src/ai/prompts/intent.prompt.js";
import type { AIProvider, AIRequest, AIResponse } from "../src/ai/types.js";
import { AskService, contextOf } from "../src/assistant/ask.service.js";
import { DotaAssistant } from "../src/assistant/dota.assistant.js";
import type { Turn } from "../src/assistant/memory.js";
import { renderAsk } from "../src/discord/components/ask.render.js";
import { DotaAdapter } from "../src/games/dota/dota.adapter.js";
import { AIUnavailableError, ProviderUnavailableError } from "../src/shared/errors.js";
import { FakeDotaProvider } from "./fixtures.js";

const intent = (over: Partial<ParsedIntent>): ParsedIntent => ({
  game: "dota2",
  intent: "general_strategy",
  hero: null,
  enemy: null,
  position: null,
  allies: [],
  enemies: [],
  removed: [],
  players: [],
  matchId: null,
  bracket: null,
  continuesDraft: false,
  ...over,
});

/** Canned response per task; an Error value simulates that call failing. */
class FakeAI implements AIProvider {
  readonly name = "fake";
  readonly model = "fake-1";
  prompts: AIRequest<unknown>[] = [];
  constructor(private readonly responses: Record<string, unknown>) {}
  async generateResponse<T>(input: AIRequest<T>): Promise<AIResponse<T>> {
    this.prompts.push(input as AIRequest<unknown>);
    const r = this.responses[input.task];
    if (r instanceof Error || r === undefined) throw r ?? new AIUnavailableError(`no canned ${input.task}`);
    return { data: input.schema.parse(r), provider: this.name, model: this.model, latencyMs: 1 };
  }
}

function setup(responses: Record<string, unknown> = { "chat.reply": { reply: "Go **Disruptor**." } }) {
  const fake = new FakeAI(responses);
  const ai = new AIService(fake);
  const dota = new DotaAdapter(new FakeDotaProvider());
  const svc = new AskService(new DotaAssistant(dota, ai), ai, async (q) => (await dota.heroes.resolve(q)).hero);
  return { svc, fake };
}

const turn = (context: Turn["context"]): Turn => ({ author: "Sam", question: "q", answer: "a", context, at: Date.now() });

describe("AskService.plan", () => {
  it("maps intents to the same requests as the slash commands", async () => {
    const { svc } = setup();
    expect(await svc.plan(intent({ intent: "counter_character", hero: "Puck" }))).toMatchObject({ request: { kind: "counter", hero: "Puck" } });
    expect(await svc.plan(intent({ intent: "matchup_advice", hero: "Invoker", enemy: "Huskar", position: 2 }))).toMatchObject({
      request: { kind: "matchup", hero: "Invoker", enemy: "Huskar", position: 2 },
    });
    expect(await svc.plan(intent({ intent: "pick_recommendation", enemies: ["Storm Spirit"], position: 5 }))).toMatchObject({
      request: { kind: "draft", input: { enemies: ["Storm Spirit"], position: 5 } },
    });
    expect(await svc.plan(intent({ intent: "hero_info", hero: "Puck" }))).toMatchObject({ request: { kind: "hero" } });
    expect(await svc.plan(intent({}))).toMatchObject({ request: { kind: "general" } });
  });

  it("answers 'how should my team adjust' with a team analysis, not a pick for that position", async () => {
    const { svc } = setup();
    // "i accidentally picked am pos 5, what should my team mates do?"
    const plan = await svc.plan(intent({ intent: "draft_analysis", hero: "Anti-Mage", allies: ["am"], position: 5 }));
    expect(plan).toMatchObject({ request: { kind: "teams", input: { allies: ["Anti-Mage"], enemies: [] } } });
  });

  it("never pulls heroes from unrelated earlier turns into a new lineup", async () => {
    const { svc } = setup();
    const history = [turn({ kind: "counter", hero: "Zeus" }), turn({ kind: "draft", position: 2, allies: ["Invoker"], enemies: ["Huskar"] })];
    const plan = await svc.plan(intent({ intent: "draft_analysis", allies: ["Anti-Mage"], continuesDraft: false }), history);
    expect(plan).toMatchObject({ request: { kind: "teams", input: { allies: ["Anti-Mage"], enemies: [] } } });
  });

  it("merges a continued draft deterministically: adds, removes, dedupes and keeps the pick slot", async () => {
    const { svc } = setup();
    const history = [turn({ kind: "draft", position: 4, allies: ["Invoker", "Zeus"], enemies: ["Storm Spirit"] })];
    // "they also picked Lifestealer" (parsed as draft_analysis) must still re-score the pos 4 pick
    expect(await svc.plan(intent({ intent: "draft_analysis", enemies: ["ls"], continuesDraft: true }), history)).toMatchObject({
      request: { kind: "draft", input: { allies: ["Invoker", "Zeus"], enemies: ["Storm Spirit", "Lifestealer"], position: 4 } },
    });
    // "we swapped Zeus for Disruptor"
    expect(await svc.plan(intent({ intent: "pick_recommendation", allies: ["Disruptor"], removed: ["zeus"], continuesDraft: true }), history)).toMatchObject({
      request: { kind: "draft", input: { allies: ["Invoker", "Disruptor"], enemies: ["Storm Spirit"], position: 4 } },
    });
    // "storm" again is not a duplicate
    const dup = await svc.plan(intent({ intent: "pick_recommendation", enemies: ["storm"], continuesDraft: true }), history);
    expect(dup).toMatchObject({ request: { input: { enemies: ["Storm Spirit"] } } });
  });

  it("starts a fresh lineup when the message names both teams, even if the parser says it continues", async () => {
    const { svc } = setup();
    // Earlier: someone's Anti-Mage team question. Now: "naa mi Axe ug Lion, sila kay Storm ug Lifestealer. pos 4?"
    const history = [turn({ kind: "teams", allies: ["Anti-Mage"], enemies: [] })];
    const plan = await svc.plan(
      intent({ intent: "pick_recommendation", allies: ["Invoker", "Zeus"], enemies: ["Storm Spirit"], position: 4, continuesDraft: true }),
      history,
    );
    expect(plan).toMatchObject({ request: { kind: "draft", input: { allies: ["Invoker", "Zeus"], enemies: ["Storm Spirit"] } } });
  });

  it("completes a half-asked draft when the position arrives", async () => {
    const { svc } = setup();
    const asked = await svc.plan(intent({ intent: "pick_recommendation", allies: ["Invoker"], enemies: ["Puck"] }));
    expect(asked).toMatchObject({ kind: "message", message: expect.stringMatching(/Which position/) });
    const history = [turn((asked as { context: Turn["context"] }).context)];
    expect(await svc.plan(intent({ intent: "pick_recommendation", position: 5, continuesDraft: true }), history)).toMatchObject({
      request: { kind: "draft", input: { allies: ["Invoker"], enemies: ["Puck"], position: 5 } },
    });
  });

  it("does not treat a team analysis's position as a pick slot", async () => {
    const { svc } = setup();
    const history = [turn({ kind: "teams", position: 5, allies: ["Anti-Mage"], enemies: [] })];
    const plan = await svc.plan(intent({ intent: "pick_recommendation", enemies: ["Puck"], continuesDraft: true }), history);
    expect(plan).toMatchObject({ kind: "message", message: expect.stringMatching(/Which position/) });
  });

  it("routes 'why not X' against the draft being discussed", async () => {
    const { svc } = setup();
    const history = [turn({ kind: "draft", position: 5, allies: ["Invoker"], enemies: ["Storm Spirit"] })];
    expect(await svc.plan(intent({ intent: "why_not_pick", hero: "Zeus", continuesDraft: true }), history)).toMatchObject({
      request: { kind: "whynot", hero: "Zeus", input: { position: 5, allies: ["Invoker"], enemies: ["Storm Spirit"] } },
    });
  });

  it("treats small talk as a normal chat reply, not an unsupported game", async () => {
    const { svc } = setup({ "chat.reply": { reply: "Hey, doing good!" } });
    expect(await svc.plan(intent({ intent: "small_talk" }))).toMatchObject({ request: { kind: "general" } });
    const res = await svc.answer("testing, hey how are you?", intent({ intent: "small_talk" }));
    expect(renderAsk(res)).toMatchObject({ content: "Hey, doing good!", components: [] });
  });

  it("sends other games and Dota news to web search", async () => {
    const { svc } = setup();
    expect(await svc.plan(intent({ game: "other", intent: "other_game" }))).toMatchObject({ request: { kind: "web", topic: "other_game" } });
    // game "other" wins even if the parser picked a Dota intent
    expect(await svc.plan(intent({ game: "other", intent: "general_strategy" }))).toMatchObject({ request: { kind: "web", topic: "other_game" } });
    expect(await svc.plan(intent({ intent: "dota_news" }))).toMatchObject({ request: { kind: "web", topic: "dota_news" } });
  });

  it("asks for missing heroes", async () => {
    const { svc } = setup();
    expect(await svc.plan(intent({ intent: "counter_character" }))).toMatchObject({ kind: "message" });
    expect(await svc.plan(intent({ intent: "draft_analysis" }))).toMatchObject({ kind: "message" });
  });
});

describe("AskService.answer (chat replies)", () => {
  it("replies conversationally, grounded in the analysis, with a full-analysis button", async () => {
    const { svc, fake } = setup();
    const res = await svc.answer("what counters puck", intent({ intent: "counter_character", hero: "Puck" }), [], "Yel");
    expect(res).toMatchObject({ kind: "chat", reply: "Go **Disruptor**." });

    const chat = fake.prompts.find((p) => p.task === "chat.reply")!;
    expect(chat.user).toContain("Yel asks");
    expect(chat.user).toContain("RANKED COUNTER CANDIDATES"); // grounded in the same data as the embed
    expect(fake.prompts.some((p) => p.task === "counter.explain")).toBe(false); // one AI call, not two

    const payload = renderAsk(res);
    expect(payload.content).toBe("Go **Disruptor**.");
    expect(payload.embeds).toHaveLength(0);
    const button = payload.components[0]!.toJSON().components[0] as { custom_id: string; label: string };
    expect(button.custom_id).toBe("full:counter:13:0");
    expect(button.label).toBe("Show full analysis");
  });

  it("falls back to the data-only embed when the chat reply fails", async () => {
    const { svc } = setup({ "chat.reply": new AIUnavailableError("down") });
    const res = await svc.answer("what counters puck", intent({ intent: "counter_character", hero: "Puck" }));
    expect(res.kind).toBe("fallback");
    const payload = renderAsk(res);
    expect(payload.embeds[0]!.data.title).toBe("Countering Puck");
    expect(payload.embeds[0]!.data.footer?.text).toMatch(/Couldn't write a reply/);
  });

  it("still answers from general knowledge when the stats provider is down, and says so", async () => {
    const fake = new FakeAI({ "chat.reply": { reply: "Play safe." } });
    const ai = new AIService(fake);
    const provider = new FakeDotaProvider();
    provider.getHeroMatchups = async () => {
      throw new ProviderUnavailableError("opendota");
    };
    const dota = new DotaAdapter(provider);
    const svc = new AskService(new DotaAssistant(dota, ai), ai, async (q) => (await dota.heroes.resolve(q)).hero);
    const res = await svc.answer("what counters puck", intent({ intent: "counter_character", hero: "Puck" }));
    expect(res).toMatchObject({ kind: "chat", reply: expect.stringMatching(/^Play safe\.\n-# Live Dota stats are unavailable/) });
    expect(fake.prompts.find((p) => p.task === "chat.reply")!.user).toMatch(/live statistics are unavailable/);
    expect(renderAsk(res).components).toHaveLength(0);
  });

  it("general advice gets no button and no statistics", async () => {
    const { svc, fake } = setup();
    const res = await svc.answer("how do I play from behind", intent({}));
    expect(renderAsk(res).components).toHaveLength(0);
    expect(fake.prompts.find((p) => p.task === "chat.reply")!.user).toMatch(/no statistics were fetched/);
  });

  it("records resolved lineups for the next follow-up", async () => {
    const { svc } = setup();
    const res = await svc.answer("team?", intent({ intent: "draft_analysis", hero: "Anti-Mage", allies: ["am"], position: 5 }));
    expect(contextOf(res)).toMatchObject({ kind: "teams", allies: ["Anti-Mage"], enemies: [], position: 5 });
  });
});
