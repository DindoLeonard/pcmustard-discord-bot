import { describe, expect, it } from "vitest";
import { AIService } from "../src/ai/ai.service.js";
import type { ParsedIntent } from "../src/ai/prompts/intent.prompt.js";
import type { AIProvider, AIRequest, AIResponse } from "../src/ai/types.js";
import { AskService } from "../src/assistant/ask.service.js";
import { DotaAssistant } from "../src/assistant/dota.assistant.js";
import { LiveDraftStore } from "../src/assistant/liveDraft.js";
import { resolvePlayerRef } from "../src/assistant/playerRefs.js";
import { renderAsk } from "../src/discord/components/ask.render.js";
import { customId } from "../src/discord/components/customIds.js";
import { renderLiveBoard } from "../src/discord/components/live.render.js";
import { DotaAdapter } from "../src/games/dota/dota.adapter.js";
import type { DotaHero } from "../src/games/dota/providers/dota.provider.js";
import { buildReview, durationLabel, modeLabel, parseMatchRef } from "../src/games/dota/services/match.service.js";
import { computeMeta } from "../src/games/dota/services/meta.service.js";
import { UserInputError } from "../src/shared/errors.js";
import { PlayerLinkStore } from "../src/storage/playerLinks.js";
import { FAKE_MATCH, FakeDotaProvider, HEROES, heroByName } from "./fixtures.js";

const byId = new Map(HEROES.map((h) => [h.id, h]));
const withStats = (name: string, picks: number, wins: number, proPicks = 0, proBans = 0): DotaHero => ({
  ...heroByName(name),
  stats: { pubPicks: picks, pubWins: wins, proPicks, proWins: 0, proBans, brackets: [{ bracket: 4, picks: picks / 2, wins: wins / 2 }] },
});

describe("computeMeta", () => {
  const heroes = [
    withStats("Disruptor", 20000, 10800, 10, 30), // 54%, common
    withStats("Lifestealer", 20000, 10200), // 51%
    withStats("Zeus", 30000, 15300), // 51%, most picked
    withStats("Puck", 40, 32), // 80% but tiny sample and <1% pick rate
  ];

  it("ranks by sample-adjusted win rate and ignores rarely picked heroes", () => {
    const m = computeMeta(heroes);
    expect(m.strongest[0]!.hero.localizedName).toBe("Disruptor");
    expect(m.strongest.map((r) => r.hero.localizedName)).not.toContain("Puck");
    expect(m.popular[0]!.hero.localizedName).toBe("Zeus");
    expect(m.pro[0]!.hero.localizedName).toBe("Disruptor");
    expect(m.matches).toBe(Math.round(70040 / 10));
  });

  it("filters by position and uses bracket stats when asked", () => {
    const pos5 = computeMeta(heroes, { position: 5 });
    const names = pos5.strongest.map((r) => r.hero.localizedName);
    expect(names).toContain("Disruptor");
    expect(names).not.toContain("Lifestealer"); // not a pos 5
    expect(pos5.strongest.find((r) => r.hero.localizedName === "Zeus")?.positionFit).toBe(0.6); // pos 5 is his 3rd role
    const archon = computeMeta(heroes, { bracket: 4 });
    expect(archon.scope).toBe("bracket 4");
    expect(archon.strongest.find((r) => r.hero.localizedName === "Disruptor")!.picks).toBe(10000);
  });
});

describe("match review", () => {
  it("parses match IDs and links", () => {
    expect(parseMatchRef("9021302861")).toBe(9021302861);
    expect(parseMatchRef("https://www.dotabuff.com/matches/9021302861")).toBe(9021302861);
    expect(parseMatchRef("https://www.opendota.com/matches/9021302861/overview")).toBe(9021302861);
    expect(parseMatchRef("hello")).toBeNull();
    expect(parseMatchRef("123")).toBeNull();
  });

  it("labels modes and durations", () => {
    expect(modeLabel(22, 7)).toBe("Ranked All Pick");
    expect(modeLabel(23, 0)).toBe("Turbo");
    expect(durationLabel(2986)).toBe("49:46");
  });

  it("turns benchmarks and team context into strengths and concerns", () => {
    const r = buildReview(FAKE_MATCH, byId, (id) => ({ 1: "Blink Dagger", 116: "Black King Bar" })[id], 100);
    const f = r.focus!;
    expect(f.hero?.localizedName).toBe("Zeus");
    expect(f.won).toBe(true);
    expect(f.items).toEqual(["Blink Dagger", "Black King Bar"]);
    expect(f.killParticipation).toBeCloseTo(22 / 30, 3);
    expect(f.netWorthRank).toBe(2); // Puck is richer
    expect(f.strengths).toContain("GPM 600: better than 90% of Zeus players");
    expect(f.concerns.some((c) => c.startsWith("Last hits per minute 2.10: lower than 80%"))).toBe(true);
    expect(f.concerns.some((c) => c.startsWith("12 deaths"))).toBe(true);
    // Zero-healing benchmark is dropped (meaningless for a hero with no heals)
    expect(f.benchmarks.map((b) => b.key)).not.toContain("hero_healing_per_min");
    expect(r.radiant.won).toBe(true);
    expect(r.mode).toBe("Ranked All Pick");
  });

  it("reviews a player's last match and requests a parse when needed", async () => {
    const provider = new FakeDotaProvider();
    provider.players.get(100)!.recent[0] = { ...provider.players.get(100)!.recent[0]!, matchId: 5000000000 };
    const dota = new DotaAdapter(provider);
    const r = await dota.matches.review({ accountId: 100 });
    expect(r.match.matchId).toBe(5000000000);
    expect(r.focus?.player.name).toBe("Alice");
    expect(r.parseRequested).toBe(true);
    expect(provider.parseRequests).toEqual([5000000000]);
  });

  it("explains missing matches and missing input", async () => {
    const dota = new DotaAdapter(new FakeDotaProvider());
    await expect(dota.matches.review({ match: "9999999" })).rejects.toThrow(/couldn't find match/);
    await expect(dota.matches.review({ match: "nope" })).rejects.toBeInstanceOf(UserInputError);
    await expect(dota.matches.review({})).rejects.toThrow(/link your account/);
  });
});

describe("LiveDraftStore", () => {
  const resolve = async (q: string) => {
    const dota = new DotaAdapter(new FakeDotaProvider());
    return (await dota.heroes.resolve(q)).hero.data;
  };

  it("adds picks and bans, rejects duplicates, and undoes", async () => {
    const s = new LiveDraftStore(resolve);
    s.start("g:c", "Alice", 5);
    await s.add("g:c", "ally", "invoker", "Alice");
    await s.add("g:c", "enemy", "storm", "Bob");
    await s.add("g:c", "ban", "zeus", "Bob");
    await expect(s.add("g:c", "enemy", "Invoker", "Bob")).rejects.toThrow("Invoker is already on your team.");
    await expect(s.add("g:c", "ally", "Zeus", "Bob")).rejects.toThrow("Zeus is already banned.");
    expect(s.require("g:c")).toMatchObject({ allies: ["Invoker"], enemies: ["Storm Spirit"], bans: ["Zeus"], lastAction: "Bob banned Zeus" });
    s.undo("g:c", "Bob");
    expect(s.require("g:c").bans).toEqual([]);
    await s.remove("g:c", "storm", "Alice");
    expect(s.require("g:c").enemies).toEqual([]);
    expect(s.toInput(s.require("g:c"))).toEqual({ allies: ["Invoker"], enemies: [], bans: [], position: 5 });
  });

  it("enforces team sizes and needs a position to suggest", async () => {
    const s = new LiveDraftStore(resolve);
    s.start("k", "A");
    for (const h of ["Puck", "Zeus", "Huskar", "Invoker"]) await s.add("k", "ally", h, "A");
    await expect(s.add("k", "ally", "Disruptor", "A")).rejects.toThrow(/already has 4/);
    expect(() => s.toInput(s.require("k"))).toThrow(/Set the open position/);
  });

  it("expires after the TTL and is per channel", () => {
    let now = 0;
    const s = new LiveDraftStore(resolve, 1000, () => now);
    s.start("a", "A");
    expect(s.get("b")).toBeUndefined();
    now = 1500;
    expect(s.get("a")).toBeUndefined();
    expect(() => s.require("a")).toThrow(/no live draft/);
  });

  it("renders a board whose Suggest button is disabled until there's something to score", async () => {
    const s = new LiveDraftStore(resolve);
    const d = s.start("k", "A");
    const buttons = () => renderLiveBoard(d).components[0]!.toJSON().components as { custom_id: string; disabled?: boolean }[];
    expect(buttons().find((b) => b.custom_id === "live:suggest")!.disabled).toBe(true);
    s.setPosition("k", 4, "A");
    await s.add("k", "enemy", "Puck", "A");
    expect(buttons().find((b) => b.custom_id === "live:suggest")!.disabled).toBe(false);
  });
});

describe("draft bans", () => {
  it("never suggests a banned hero", async () => {
    const dota = new DotaAdapter(new FakeDotaProvider());
    const open = await dota.drafts.analyze({ allies: ["Invoker"], enemies: ["Storm Spirit"], position: 5 });
    const top = open.candidates[0]!.hero.localizedName;
    const banned = await dota.drafts.analyze({ allies: ["Invoker"], enemies: ["Storm Spirit"], position: 5, bans: [top] });
    expect(banned.candidates.map((c) => c.hero.localizedName)).not.toContain(top);
  });
});

/** Canned chat reply; records prompts. */
class FakeAI implements AIProvider {
  readonly name = "fake";
  readonly model = "fake-1";
  prompts: AIRequest<unknown>[] = [];
  async generateResponse<T>(input: AIRequest<T>): Promise<AIResponse<T>> {
    this.prompts.push(input as AIRequest<unknown>);
    return { data: input.schema.parse({ reply: "ok" }), provider: this.name, model: this.model, latencyMs: 1 };
  }
}

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

function chat() {
  const provider = new FakeDotaProvider();
  const dota = new DotaAdapter(provider);
  const ai = new AIService(new FakeAI());
  const links = new PlayerLinkStore(null);
  links.set("555", 100);
  const live = new LiveDraftStore(async (q) => (await dota.heroes.resolve(q)).hero.data);
  const svc = new AskService(
    new DotaAssistant(dota, ai),
    ai,
    async (q) => (await dota.heroes.resolve(q)).hero,
    undefined,
    (ref, requesterId, nameOf) => resolvePlayerRef(ref, links, requesterId, nameOf),
    live,
  );
  return { svc, live, provider };
}

describe("chat: meta, match review and live drafts", () => {
  it("routes meta questions with position and rank", async () => {
    const { svc } = chat();
    expect(await svc.plan(intent({ intent: "meta_query", position: 5, bracket: 4 }))).toMatchObject({ request: { kind: "meta", position: 5, bracket: 4 } });
  });

  it("reviews the asker's last game, or a given match", async () => {
    const { svc } = chat();
    expect(await svc.plan(intent({ intent: "match_review" }), [], { userId: "555" })).toMatchObject({ request: { kind: "match", accountId: 100 } });
    expect(await svc.plan(intent({ intent: "match_review", matchId: "5000000000" }), [], { userId: "999" })).toMatchObject({ request: { kind: "match", match: "5000000000" } });
    expect(await svc.plan(intent({ intent: "match_review" }), [], { userId: "999" })).toMatchObject({ kind: "message", message: expect.stringMatching(/haven't linked/) });
  });

  it("with a match ID, an unlinked 'me' is optional and a plain name is matched in the match", async () => {
    const { svc } = chat();
    // Parser output for "review match 5000" from someone who never linked
    expect(await svc.plan(intent({ intent: "match_review", players: ["me"], matchId: "5000000000" }), [], { userId: "999" })).toMatchObject({
      request: { kind: "match", match: "5000000000", accountId: undefined, playerName: undefined },
    });
    // "how did Alice do in 5000?"
    expect(await svc.plan(intent({ intent: "match_review", players: ["Alice"], matchId: "5000000000" }))).toMatchObject({ request: { kind: "match", playerName: "Alice" } });
    const dota = new DotaAdapter(new FakeDotaProvider());
    const r = await dota.matches.review({ match: "5000000000", playerName: "alice" });
    expect(r.focus?.hero?.localizedName).toBe("Zeus");
  });

  it("pulls a missed match ID out of the question text", async () => {
    const { svc } = chat();
    // FakeDotaProvider has no such match: "not found" proves the ID from the text was used, not "your last game"
    // (which would have failed with "haven't linked" for this unlinked asker).
    await expect(svc.answer("review match 9021302861", intent({ intent: "match_review", players: ["me"] }), [], "Leo", { userId: "999" })).rejects.toThrow(
      /couldn't find match "9021302861"/,
    );
  });

  it("chat draft questions update the channel's live draft and respect its bans", async () => {
    const { svc, live } = chat();
    live.start("g:c", "Alice", 5);
    await live.add("g:c", "ally", "Invoker", "Alice");
    await live.add("g:c", "ban", "Disruptor", "Alice");
    // "they picked Storm, what should I pick?"
    const res = await svc.answer("they picked storm", intent({ intent: "pick_recommendation", enemies: ["storm"] }), [], "Bob", { key: "g:c", author: "Bob" });
    expect(live.require("g:c")).toMatchObject({ allies: ["Invoker"], enemies: ["Storm Spirit"], bans: ["Disruptor"] });
    expect(res).toMatchObject({ kind: "chat", request: { kind: "draft", input: { position: 5, bans: ["Disruptor"] } } });
    const payload = renderAsk(res);
    expect(payload.content).toMatch(/Updated the live draft/);
    expect((payload.components[0]!.toJSON().components[0] as { custom_id: string }).custom_id).toBe("live:suggest");
  });

  it("button ids for meta and match fit and round-trip", () => {
    expect(customId.fullMeta(5, 4)).toBe("full:meta:5:4");
    expect(customId.fullMeta()).toBe("full:meta:0:0");
    expect(customId.fullMatch(9021302861, 158650393)).toBe("full:match:9021302861:158650393");
  });
});
