import { describe, expect, it } from "vitest";
import { AIService } from "../src/ai/ai.service.js";
import type { AIProvider, AIRequest, AIResponse } from "../src/ai/types.js";
import { AskService } from "../src/assistant/ask.service.js";
import { DotaAssistant } from "../src/assistant/dota.assistant.js";
import { ConversationMemory, historyBlock } from "../src/assistant/memory.js";
import { DotaAdapter } from "../src/games/dota/dota.adapter.js";
import { FakeDotaProvider } from "./fixtures.js";

const turn = (question: string) => ({ author: "Alice", question, answer: `answer to ${question}`, context: { kind: "general" as const } });

describe("ConversationMemory", () => {
  it("keeps the most recent turns per channel", () => {
    const m = new ConversationMemory({ maxTurns: 2 });
    m.add("g:c1", turn("one"));
    m.add("g:c1", turn("two"));
    m.add("g:c1", turn("three"));
    m.add("g:c2", turn("other channel"));
    expect(m.get("g:c1").map((t) => t.question)).toEqual(["two", "three"]);
    expect(m.get("g:c2").map((t) => t.question)).toEqual(["other channel"]);
  });

  it("expires a channel after the TTL since its last turn", () => {
    let now = 0;
    const m = new ConversationMemory({ ttlMs: 1000, now: () => now });
    m.add("k", turn("a"));
    now = 900;
    m.add("k", turn("b")); // refreshes the channel
    now = 1800;
    expect(m.get("k")).toHaveLength(2);
    now = 2000;
    expect(m.get("k")).toEqual([]);
  });

  it("clears on demand and reports how much was forgotten", () => {
    const m = new ConversationMemory();
    m.add("k", turn("a"));
    m.add("k", turn("b"));
    expect(m.clear("k")).toBe(2);
    expect(m.get("k")).toEqual([]);
    expect(m.clear("k")).toBe(0);
  });

  it("stores nothing when maxTurns is 0", () => {
    const m = new ConversationMemory({ maxTurns: 0 });
    m.add("k", turn("a"));
    expect(m.get("k")).toEqual([]);
  });

  it("clips long questions and answers", () => {
    const m = new ConversationMemory();
    m.add("k", { ...turn("x".repeat(1000)), answer: "y".repeat(1000) });
    const [t] = m.get("k");
    expect(t!.question.length).toBeLessThanOrEqual(300);
    expect(t!.answer.length).toBeLessThanOrEqual(400);
  });

  it("keys by guild and channel, with DMs separate", () => {
    expect(ConversationMemory.key("g1", "c1")).toBe("g1:c1");
    expect(ConversationMemory.key(null, "c1")).toBe("dm:c1");
  });

  it("renders who said what, with structured context", () => {
    const text = historyBlock([
      { author: "Sam", question: "Invoker vs Huskar", answer: "lane guide", context: { kind: "matchup", hero: "Invoker", enemy: "Huskar", position: 2 }, at: 0 },
    ]);
    expect(text).toContain('Sam asked: "Invoker vs Huskar"');
    expect(text).toContain("hero=Invoker enemy=Huskar position=2");
    expect(historyBlock([])).toBe("");
  });
});

/** Records the prompts it receives; answers intent parsing with a canned intent. */
class RecordingAI implements AIProvider {
  readonly name = "rec";
  readonly model = "rec-1";
  prompts: AIRequest<unknown>[] = [];
  constructor(private readonly intent: Record<string, unknown>) {}
  async generateResponse<T>(input: AIRequest<T>): Promise<AIResponse<T>> {
    this.prompts.push(input as AIRequest<unknown>);
    const canned: Record<string, unknown> = {
      "intent.parse": this.intent,
      "chat.reply": { reply: "a friendly answer" },
      "counter.explain": { picks: [], strategy: [], items: [] },
    };
    return { data: input.schema.parse(canned[input.task]), provider: this.name, model: this.model, latencyMs: 1 };
  }
}

function service(intent: Record<string, unknown>) {
  const ai = new AIService(new RecordingAI(intent));
  const dota = new DotaAdapter(new FakeDotaProvider());
  const svc = new AskService(new DotaAssistant(dota, ai), ai, async (q) => (await dota.heroes.resolve(q)).hero, new ConversationMemory());
  const rec = (ai as unknown as { provider: RecordingAI }).provider;
  return { svc, rec };
}

const COUNTER_PUCK = {
  game: "dota2",
  intent: "counter_character",
  hero: "Puck",
  enemy: null,
  position: null,
  allies: [],
  enemies: [],
  removed: [],
  continuesDraft: false,
};
const GENERAL = { ...COUNTER_PUCK, intent: "general_strategy", hero: null };

describe("AskService memory", () => {
  const alice = { key: "g:c", author: "Alice" };
  const bob = { key: "g:c", author: "Bob" };

  it("shares one conversation between everyone in a channel", async () => {
    const { svc, rec } = service(COUNTER_PUCK);
    await svc.ask("what counters puck", alice);
    await svc.ask("and for supports?", bob);

    const secondIntent = rec.prompts.filter((p) => p.task === "intent.parse")[1]!;
    expect(secondIntent.user).toContain('Alice asked: "what counters puck"');
    expect(secondIntent.user).toContain("hero=Puck");
    expect(secondIntent.user).toContain("NEW MESSAGE:\nand for supports?");
    expect(svc.memory.get("g:c").map((t) => t.author)).toEqual(["Alice", "Bob"]);
    expect(svc.memory.get("g:c")[0]!.answer).toMatch(/^Counters to Puck: /);
  });

  it("keeps channels separate", async () => {
    const { svc, rec } = service(COUNTER_PUCK);
    await svc.ask("what counters puck", alice);
    await svc.ask("hello", { key: "g:other", author: "Bob" });
    const second = rec.prompts.filter((p) => p.task === "intent.parse")[1]!;
    expect(second.user).not.toContain("CONVERSATION SO FAR");
  });

  it("passes history and the speaker to the chat reply for follow-ups", async () => {
    const { svc, rec } = service(GENERAL);
    await svc.ask("how do I play from behind?", alice);
    await svc.ask("why?", bob);
    const reply = rec.prompts.filter((p) => p.task === "chat.reply")[1]!;
    expect(reply.user).toContain('Alice asked: "how do I play from behind?"');
    expect(reply.user).toContain("Bob asks:\nwhy?");
  });

  it.each(["forget", "Forget everything!", "reset", "clear the conversation", "please forget that"])("'%s' clears the channel without calling the AI", async (phrase) => {
    const { svc, rec } = service(COUNTER_PUCK);
    await svc.ask("what counters puck", alice);
    const calls = rec.prompts.length;
    const res = await svc.ask(phrase, bob);
    expect(res).toMatchObject({ kind: "message", message: expect.stringMatching(/forgotten.*\(1 message\)/) });
    expect(rec.prompts.length).toBe(calls);
    expect(svc.memory.get("g:c")).toEqual([]);
  });

  it("doesn't treat sentences containing 'forget' as the command", async () => {
    const { svc } = service(GENERAL);
    const res = await svc.ask("I always forget to buy wards", alice);
    expect(res.kind).toBe("chat"); // answered normally, not treated as "forget"
    expect(svc.memory.get("g:c")).toHaveLength(1);
  });

  it("does not remember calls without a conversation (tests, tooling)", async () => {
    const { svc } = service(COUNTER_PUCK);
    await svc.ask("what counters puck");
    expect(svc.memory.get("g:c")).toEqual([]);
  });
});
