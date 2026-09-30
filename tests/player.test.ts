import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AIService } from "../src/ai/ai.service.js";
import type { ParsedIntent } from "../src/ai/prompts/intent.prompt.js";
import { AskService } from "../src/assistant/ask.service.js";
import { DotaAssistant } from "../src/assistant/dota.assistant.js";
import { resolvePlayerRef } from "../src/assistant/playerRefs.js";
import { customId } from "../src/discord/components/customIds.js";
import { DotaAdapter } from "../src/games/dota/dota.adapter.js";
import { OpenDotaProvider } from "../src/games/dota/providers/opendota.provider.js";
import { likelyPicks, parseAccountRef, rankLabel } from "../src/games/dota/services/player.service.js";
import { comfortBonus, suggestBans } from "../src/games/dota/services/scout.service.js";
import { PlayerNotFoundError, UserInputError } from "../src/shared/errors.js";
import { PlayerLinkStore } from "../src/storage/playerLinks.js";
import { FakeDotaProvider, HEROES, NOW_SEC, match } from "./fixtures.js";

const dota = () => new DotaAdapter(new FakeDotaProvider());
const byId = new Map(HEROES.map((h) => [h.id, h]));

describe("parseAccountRef", () => {
  it("accepts Friend IDs, Steam ID64s and profile links", () => {
    expect(parseAccountRef("158650393")).toBe(158650393);
    expect(parseAccountRef(" 76561198118916121 ")).toBe(158650393);
    expect(parseAccountRef("https://www.dotabuff.com/players/158650393/heroes")).toBe(158650393);
    expect(parseAccountRef("https://www.opendota.com/players/158650393")).toBe(158650393);
    expect(parseAccountRef("https://steamcommunity.com/profiles/76561198118916121")).toBe(158650393);
  });

  it("rejects garbage and out-of-range numbers", () => {
    expect(parseAccountRef("abc")).toBeNull();
    expect(parseAccountRef("0")).toBeNull();
    expect(parseAccountRef("99999999999999999999")).toBeNull();
    expect(parseAccountRef("https://example.com/players/123")).toBeNull();
  });
});

describe("rankLabel", () => {
  it("decodes medal and stars", () => {
    expect(rankLabel(45)).toBe("Archon 5");
    expect(rankLabel(11)).toBe("Herald 1");
    expect(rankLabel(80, 379)).toBe("Immortal (#379)");
    expect(rankLabel(80)).toBe("Immortal");
    expect(rankLabel(null)).toBe("Unranked");
  });
});

describe("likelyPicks", () => {
  const heroes = [
    { heroId: 87, games: 120, wins: 72, lastPlayed: NOW_SEC - 86400 }, // Disruptor: main, recent
    { heroId: 13, games: 200, wins: 100, lastPlayed: NOW_SEC - 400 * 86400 }, // Puck: most games but stale
    { heroId: 22, games: 10, wins: 6, lastPlayed: NOW_SEC - 86400 }, // Zeus: few games but hot lately
  ];

  it("favours recent form, and discounts heroes not played in months", () => {
    const recent = [match(22, true), match(22, true), match(22, true), match(87, true)];
    const picks = likelyPicks(heroes, recent, byId, NOW_SEC);
    expect(picks.map((p) => p.hero.localizedName)).toEqual(["Zeus", "Disruptor", "Puck"]);
    expect(picks[0]!.score).toBe(1); // normalized
    expect(picks[2]!.reasons).toContain("not played in 6+ months");
  });

  it("falls back to all-time play with no recent matches", () => {
    const picks = likelyPicks(heroes, [], byId, NOW_SEC);
    expect(picks[0]!.hero.localizedName).toBe("Disruptor");
  });
});

describe("PlayerService", () => {
  it("summarizes a player with likely picks", async () => {
    const p = await dota().players.analyze("100");
    expect(p.profile.name).toBe("Alice");
    expect(p.rank).toBe("Archon 5");
    expect(p.topHeroes[0]!.hero.localizedName).toBe("Disruptor");
    expect(p.likelyPicks[0]!.hero.localizedName).toBe("Zeus"); // 3 of last 4 matches
    expect(p.profileUrl).toBe("https://www.opendota.com/players/100");
  });

  it("explains unknown and private accounts", async () => {
    await expect(dota().players.analyze("999")).rejects.toThrow(/couldn't find a Dota account/);
    await expect(dota().players.analyze("300")).rejects.toThrow(/Expose Public Match Data/);
    await expect(dota().players.analyze("not an id")).rejects.toBeInstanceOf(PlayerNotFoundError);
  });
});

describe("OpenDotaProvider players", () => {
  const provider = (routes: Record<string, () => Response>) =>
    new OpenDotaProvider({
      fetchFn: (async (input: string | URL | Request) => {
        const path = new URL(String(input)).pathname.replace("/api", "");
        return routes[path]?.() ?? new Response("nope", { status: 404 });
      }) as typeof fetch,
    });

  it("treats 404s and empty shells as not found", async () => {
    await expect(provider({}).getPlayer(12345)).rejects.toBeInstanceOf(PlayerNotFoundError);
    const shell = provider({ "/players/9": () => Response.json({ profile: { personaname: null }, rank_tier: null }) });
    await expect(shell.getPlayer(9)).rejects.toBeInstanceOf(PlayerNotFoundError);
  });

  it("derives wins from player slot and match result", async () => {
    const p = provider({
      "/players/1/recentMatches": () =>
        Response.json([
          { match_id: 1, player_slot: 0, radiant_win: true, hero_id: 1, start_time: 1, kills: 1, deaths: 1, assists: 1 },
          { match_id: 2, player_slot: 130, radiant_win: true, hero_id: 1, start_time: 1, kills: 1, deaths: 1, assists: 1 },
          { match_id: 3, player_slot: 131, radiant_win: false, hero_id: 1, start_time: 1, kills: 1, deaths: 1, assists: 1 },
        ]),
    });
    expect((await p.getPlayerRecentMatches(1)).data.map((m) => m.won)).toEqual([true, false, true]);
  });
});

describe("scouting", () => {
  it("scouts players, keeps going past private ones, and suggests bans", async () => {
    const s = await dota().scouts.analyze({
      enemies: [{ accountId: 100 }, { accountId: 300 }, { accountId: 200 }],
      unresolved: [{ label: "@Sam", error: "Sam hasn't linked" }],
    });
    expect(s.players.map((p) => p.label)).toEqual(["Alice", "300", "Bob", "@Sam"]);
    expect(s.players[1]!.error).toMatch(/Expose Public Match Data/);
    expect(s.bans.map((b) => b.hero.localizedName)).toEqual(expect.arrayContaining(["Zeus", "Invoker"]));
    expect(s.likelyEnemies.map((h) => h.localizedName)).toEqual(["Zeus", "Invoker"]);
    expect(s.picks).toEqual([]); // no position asked
  });

  it("recommends picks for a position against their likely heroes, with a comfort bonus from your pool", async () => {
    const s = await dota().scouts.analyze({ enemies: [{ accountId: 200 }], position: 5, myAccountId: 100 });
    expect(s.draft?.enemies.heroes.map((h) => h.localizedName)).toEqual(["Invoker"]);
    const disruptor = s.picks.find((p) => p.candidate.hero.localizedName === "Disruptor")!;
    expect(disruptor.yourGames).toBe(120);
    expect(disruptor.score).toBeGreaterThan(disruptor.candidate.score);
  });

  it("rejects empty or oversized scouts", async () => {
    await expect(dota().scouts.analyze({ enemies: [] })).rejects.toBeInstanceOf(UserInputError);
    const six = Array.from({ length: 6 }, (_, i) => ({ accountId: i + 1 }));
    await expect(dota().scouts.analyze({ enemies: six })).rejects.toThrow(/at most 5/);
  });

  it("only rewards comfort heroes you actually win with", () => {
    expect(comfortBonus(73, 30)).toBeLessThan(0.02); // 41% win: almost nothing
    expect(comfortBonus(60, 20)).toBe(0); // 33% win: none
    expect(comfortBonus(140, 84)).toBeCloseTo(0.1, 1); // 60% over many games: ~full
    expect(comfortBonus(3, 3)).toBeLessThan(0.02); // tiny sample
    expect(comfortBonus(0, 0)).toBe(0);
  });

  it("sums ban value across players who share a hero", () => {
    const zeus = byId.get(22)!;
    const pick = { hero: zeus, score: 1, recentGames: 2, allTimeGames: 10, allTimeWinRate: 0.6, reasons: [] };
    const player = (label: string) => ({ accountId: 1, label, analysis: { likelyPicks: [pick] } as never });
    const bans = suggestBans([player("A"), player("B")]);
    expect(bans[0]).toMatchObject({ hero: zeus, players: ["A", "B"] });
  });
});

describe("player links", () => {
  it("persist to disk and can be removed", () => {
    const file = join(mkdtempSync(join(tmpdir(), "links-")), "nested", "links.json");
    const store = new PlayerLinkStore(file);
    store.set("555", 158650393);
    expect(JSON.parse(readFileSync(file, "utf8"))["555"].accountId).toBe(158650393);
    expect(new PlayerLinkStore(file).get("555")?.accountId).toBe(158650393); // survives a restart
    expect(store.remove("555")).toBe(true);
    expect(store.remove("555")).toBe(false);
    expect(new PlayerLinkStore(file).get("555")).toBeUndefined();
  });

  it("resolves me, @mentions and pasted IDs", () => {
    const links = new PlayerLinkStore(null);
    links.set("555", 100);
    expect(resolvePlayerRef("me", links, "555")).toEqual({ accountId: 100, label: "you" });
    expect(resolvePlayerRef("nako", links, "555").accountId).toBe(100); // Bisaya "me"
    expect(resolvePlayerRef("<@555>", links, "999", () => "Leo")).toEqual({ accountId: 100, label: "@Leo" });
    expect(resolvePlayerRef("https://www.dotabuff.com/players/42", links)).toEqual({ accountId: 42 });
    expect(() => resolvePlayerRef("me", links, "999")).toThrow(/haven't linked/);
    expect(() => resolvePlayerRef("<@777>", links, "999", () => "Sam")).toThrow(/@Sam hasn't linked/);
    expect(() => resolvePlayerRef("lol", links)).toThrow(/doesn't look like a Dota account/);
  });
});

describe("chat routing for players", () => {
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
    image: null,
    continuesDraft: false,
    ...over,
  });

  function service() {
    const links = new PlayerLinkStore(null);
    links.set("555", 100);
    const ai = new AIService(null);
    const d = dota();
    const svc = new AskService(new DotaAssistant(d, ai), ai, async (q) => (await d.heroes.resolve(q)).hero, undefined, (ref, requesterId, nameOf) =>
      resolvePlayerRef(ref, links, requesterId, nameOf),
    );
    return svc;
  }

  it("looks up a player, defaulting to the asker", async () => {
    const svc = service();
    expect(await svc.plan(intent({ intent: "player_lookup", players: ["200"] }))).toMatchObject({ request: { kind: "player", accountId: 200 } });
    expect(await svc.plan(intent({ intent: "player_lookup" }), [], { userId: "555" })).toMatchObject({ request: { kind: "player", accountId: 100 } });
    expect(await svc.plan(intent({ intent: "player_lookup" }), [], { userId: "999" })).toMatchObject({ kind: "message", message: expect.stringMatching(/haven't linked/) });
  });

  it("scouts several players, keeping unlinked ones as notes and adding the asker's pool", async () => {
    const svc = service();
    const plan = await svc.plan(intent({ intent: "scout_players", players: ["200", "<@777>"], position: 4 }), [], { userId: "555", names: { "777": "Sam" } });
    expect(plan).toMatchObject({
      request: { kind: "scout", input: { enemies: [{ accountId: 200 }], unresolved: [{ label: "<@777>" }], position: 4, myAccountId: 100 } },
    });
  });

  it("treats a 'what do they pick' question as a player lookup even if parsed as a draft", async () => {
    const svc = service();
    // "unsa ganahan i-pick ni <@555>?"
    expect(await svc.plan(intent({ intent: "pick_recommendation", players: ["<@555>"] }))).toMatchObject({ request: { kind: "player", accountId: 100 } });
    expect(await svc.plan(intent({ intent: "pick_recommendation", players: ["100", "200"] }))).toMatchObject({ request: { kind: "scout" } });
  });

  it("fits five 10-digit account IDs in a button custom ID", () => {
    const id = customId.fullScout(5, [4294967295, 4294967294, 4294967293, 4294967292, 4294967291]);
    expect(id.length).toBeLessThanOrEqual(100);
    expect(customId.fullPlayer(158650393)).toBe("full:player:158650393");
    expect(customId.heroExplain(13)).toBe("hero:explain:13"); // base IDs still intact
  });
});

vi.setConfig({ testTimeout: 10_000 });
