import { describe, expect, it } from "vitest";
import { scoreDraft, validateDraft } from "../src/games/dota/services/draft.service.js";
import { aggregateWeakTo, analyzeTeam, buildProfile, needImportance } from "../src/games/dota/services/team.service.js";
import type { DotaHero } from "../src/games/dota/providers/dota.provider.js";
import { InvalidDraftError } from "../src/shared/errors.js";
import { HEROES, heroByName } from "./fixtures.js";

const heroes = (...names: string[]) => names.map(heroByName);

function extra(id: number, localizedName: string): DotaHero {
  return { ...heroByName("Zeus"), id, localizedName, name: `npc_dota_hero_${id}` };
}

// A pool with enough supports to make pos-5 drafts meaningful.
const POOL: DotaHero[] = [
  ...HEROES,
  extra(102, "Abaddon"),
  extra(50, "Dazzle"),
  extra(26, "Lion"),
  extra(2, "Axe"),
  extra(6, "Drow Ranger"),
  extra(9, "Mirana"),
  extra(108, "Underlord"),
  extra(111, "Oracle"),
];
const byName = (n: string) => POOL.find((h) => h.localizedName === n)!;

describe("team analysis", () => {
  it("aggregates traits into a 0..1 profile", () => {
    const profile = buildProfile([byName("Axe"), byName("Lion")]);
    expect(profile.initiation).toBeGreaterThan(0);
    expect(profile.disable).toBe(1);
    expect(profile.save).toBe(0);
    for (const v of Object.values(profile)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("detects the CLAUDE.md example weaknesses", () => {
    const allies = ["Axe", "Invoker", "Drow Ranger", "Lion"].map(byName);
    const enemies = ["Storm Spirit", "Lifestealer", "Mirana", "Underlord", "Oracle"].map(byName);
    const team = analyzeTeam(allies, enemies);
    const weak = team.weaknesses.map((w) => w.dimension);
    expect(weak).toContain("save");
    expect(weak).toContain("detection"); // Mirana's invisibility
    expect(team.strengths).toContain("disable");
  });

  it("raises importance based on the enemy lineup", () => {
    expect(needImportance([]).get("antiMobility")).toBeUndefined();
    const vsStorm = needImportance(heroes("Storm Spirit"));
    expect(vsStorm.get("antiMobility")?.importance).toBeGreaterThan(1);
    expect(vsStorm.get("antiMobility")?.because).toContain("Storm Spirit");
  });

  it("counts shared enemy weaknesses", () => {
    const vulns = aggregateWeakTo(heroes("Storm Spirit", "Puck"));
    expect(vulns[0]).toMatchObject({ count: 2 });
    expect(vulns.map((v) => v.trait)).toEqual(expect.arrayContaining(["silence", "instant_disable", "mana_burn"]));
  });
});

describe("validateDraft", () => {
  it("rejects a hero on both teams", () => {
    expect(() => validateDraft(heroes("Puck"), heroes("Puck"))).toThrow(/both teams/);
  });

  it("rejects duplicates within a team", () => {
    expect(() => validateDraft(heroes("Puck", "Puck"), [])).toThrow(InvalidDraftError);
  });

  it("rejects empty and oversized drafts", () => {
    expect(() => validateDraft([], [])).toThrow(/at least one/);
    expect(() => validateDraft(heroes("Puck", "Zeus", "Huskar", "Invoker", "Disruptor"), [])).toThrow(/at most 4 allies/);
  });

  it("accepts a normal draft", () => {
    expect(() => validateDraft(heroes("Puck"), heroes("Zeus"))).not.toThrow();
  });
});

describe("scoreDraft", () => {
  const allies = ["Axe", "Invoker", "Drow Ranger", "Lion"].map(byName);
  const enemies = ["Storm Spirit", "Lifestealer", "Mirana", "Underlord", "Oracle"].map(byName);
  const result = scoreDraft({ allies: [], enemies: [], position: 5 }, allies, enemies, POOL, new Map());

  it("only suggests untaken heroes that play the position", () => {
    const taken = new Set([...allies, ...enemies].map((h) => h.id));
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const c of result.candidates) {
      expect(taken.has(c.hero.id)).toBe(false);
      expect(c.knowledge?.positions).toContain(5);
    }
  });

  it("rewards heroes that fix the team's gaps, with structured reasons", () => {
    const dazzle = result.candidates.find((c) => c.hero.localizedName === "Dazzle")!;
    expect(dazzle.fills).toContain("save");
    expect(dazzle.reasons.some((r) => r.type === "team_need")).toBe(true);
    expect(result.candidates[0]!.reasons.length).toBeGreaterThan(0);
    // Candidates are sorted by score
    const scores = result.candidates.map((c) => c.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("uses matchup data when available", () => {
    const disruptor = byName("Disruptor");
    const storm = byName("Storm Spirit");
    // Storm's records: loses 70% of games vs Disruptor
    const withData = scoreDraft({ allies: [], enemies: [], position: 5 }, allies, [storm], POOL, new Map([[storm.id, [{ opponentId: disruptor.id, games: 500, wins: 150 }]]]));
    const withoutData = scoreDraft({ allies: [], enemies: [], position: 5 }, allies, [storm], POOL, new Map());
    const score = (r: typeof withData) => r.candidates.find((c) => c.hero.id === disruptor.id)!.components.matchup!;
    expect(score(withData)).toBeGreaterThan(score(withoutData));
  });

  it("works with only enemies or only allies", () => {
    expect(scoreDraft({ allies: [], enemies: [], position: 2 }, [], heroes("Puck"), POOL, new Map()).candidates.length).toBeGreaterThan(0);
    const noEnemies = scoreDraft({ allies: [], enemies: [], position: 5 }, heroes("Invoker"), [], POOL, new Map());
    expect(noEnemies.candidates[0]!.components.matchup).toBeUndefined();
  });
});
