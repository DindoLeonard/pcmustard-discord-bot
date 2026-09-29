import { describe, expect, it } from "vitest";
import { HERO_KNOWLEDGE } from "../src/games/dota/knowledge/heroTraits.js";
import { HERO_TRAITS, POSITIONS } from "../src/games/dota/knowledge/traits.js";
import { scoreCounters } from "../src/games/dota/services/counter.service.js";
import {
  adjustedWinRate,
  matchupFromOpponentRecords,
  matchupFromOwnRecords,
  roleFit,
  weightedScore,
  winRateScore,
} from "../src/games/dota/services/scoring.service.js";
import { HEROES, heroByName } from "./fixtures.js";

describe("scoring primitives", () => {
  it("shrinks small samples toward 50%", () => {
    expect(adjustedWinRate(9, 11)).toBeLessThan(0.6);
    expect(adjustedWinRate(9, 11)).toBeGreaterThan(0.5);
    // A large sample keeps most of its signal
    expect(adjustedWinRate(600, 1000)).toBeCloseTo(0.595, 2);
    expect(adjustedWinRate(0, 0)).toBe(0.5);
  });

  it("maps win rates to 0..1 around 50%", () => {
    expect(winRateScore(0.5)).toBe(0.5);
    expect(winRateScore(0.6)).toBeCloseTo(1, 10);
    expect(winRateScore(0.3)).toBe(0);
  });

  it("mirrors an opponent's record into the candidate's perspective", () => {
    // Puck (13) won 30 of 100 games vs Storm (17) -> Storm won 70 of 100 vs Puck
    const puckRecords = [{ opponentId: 17, games: 100, wins: 30 }];
    const storm = matchupFromOpponentRecords(17, 13, puckRecords);
    expect(storm).toMatchObject({ heroId: 17, opponentId: 13, games: 100, wins: 70, winRate: 0.7, lowSample: false });
    const puck = matchupFromOwnRecords(13, 17, puckRecords);
    expect(puck.winRate).toBe(0.3);
  });

  it("flags low samples and handles missing data", () => {
    expect(matchupFromOwnRecords(1, 2, [{ opponentId: 2, games: 5, wins: 5 }]).lowSample).toBe(true);
    expect(matchupFromOwnRecords(1, 2, [])).toMatchObject({ games: 0, winRate: null, adjustedWinRate: 0.5 });
  });

  it("scores role fit by position order", () => {
    const k = { positions: [5, 4] as const, provides: [], weakTo: [] };
    expect(roleFit({ ...k, positions: [5, 4] }, 5)).toBe(1);
    expect(roleFit({ ...k, positions: [5, 4] }, 4)).toBe(0.8);
    expect(roleFit({ ...k, positions: [5, 4] }, 1)).toBe(0);
    expect(roleFit(undefined, 1)).toBe(0);
  });

  it("normalizes weighted scores over the components present", () => {
    expect(weightedScore({ a: 1, b: 0 }, { a: 0.5, b: 0.5 })).toBe(0.5);
    expect(weightedScore({ a: 1 }, { a: 0.5, b: 0.5 })).toBe(1);
    expect(weightedScore({}, { a: 1 })).toBe(0);
  });
});

describe("curated hero knowledge", () => {
  it("uses only known traits and valid positions", () => {
    for (const [name, k] of Object.entries(HERO_KNOWLEDGE)) {
      expect(k.positions.length, name).toBeGreaterThan(0);
      for (const p of k.positions) expect(POSITIONS, name).toContain(p);
      for (const t of [...k.provides, ...k.weakTo]) expect(HERO_TRAITS, `${name}: ${t}`).toContain(t);
      expect(new Set(k.positions).size, `${name} duplicate positions`).toBe(k.positions.length);
    }
  });

  it("covers every fixture hero", () => {
    for (const h of HEROES) expect(HERO_KNOWLEDGE[h.localizedName], h.localizedName).toBeDefined();
  });
});

describe("scoreCounters", () => {
  const puck = heroByName("Puck");
  // Puck's own records: loses hard to Disruptor, beats Zeus
  const puckRecords = [
    { opponentId: 87, games: 400, wins: 160 }, // Disruptor wins 60%
    { opponentId: 22, games: 400, wins: 260 }, // Zeus wins 35%
  ];

  it("excludes the target and ranks strong matchups higher", () => {
    const ranked = scoreCounters(puck, HEROES, puckRecords);
    expect(ranked.map((c) => c.hero.localizedName)).not.toContain("Puck");
    const names = ranked.map((c) => c.hero.localizedName);
    expect(names.indexOf("Disruptor")).toBeLessThan(names.indexOf("Zeus"));
  });

  it("filters by position and explains every candidate", () => {
    const ranked = scoreCounters(puck, HEROES, puckRecords, { position: 5 });
    expect(ranked.length).toBeGreaterThan(0);
    for (const c of ranked) {
      expect(c.knowledge?.positions).toContain(5);
      expect(c.reasons.length).toBeGreaterThan(0);
      expect(c.reasons.some((r) => r.type === "role_fit")).toBe(true);
    }
  });

  it("rewards heroes that provide what the target is weak to", () => {
    // With no matchup data, trait fit decides: Disruptor (silence) beats Zeus (no Puck weakness).
    const ranked = scoreCounters(puck, HEROES, []);
    const d = ranked.find((c) => c.hero.localizedName === "Disruptor")!;
    const z = ranked.find((c) => c.hero.localizedName === "Zeus")!;
    expect(d.exploits).toContain("silence");
    expect(d.components.traits).toBeGreaterThan(z.components.traits!);
  });
});
