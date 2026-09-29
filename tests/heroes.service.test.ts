import { describe, expect, it } from "vitest";
import { HeroesService, levenshtein, normalizeName } from "../src/games/dota/services/heroes.service.js";
import { HeroNotFoundError } from "../src/shared/errors.js";
import { FakeDotaProvider } from "./fixtures.js";

const service = () => new HeroesService(new FakeDotaProvider());

async function notFound(input: string): Promise<HeroNotFoundError> {
  try {
    await service().resolve(input);
  } catch (err) {
    if (err instanceof HeroNotFoundError) return err;
    throw err;
  }
  throw new Error(`expected "${input}" not to resolve`);
}

describe("normalizeName / levenshtein", () => {
  it("strips punctuation, spaces and case", () => {
    expect(normalizeName("Nature's Prophet")).toBe("naturesprophet");
    expect(normalizeName(" Anti-Mage ")).toBe("antimage");
  });

  it("computes edit distance", () => {
    expect(levenshtein("invoker", "invokker")).toBe(1);
    expect(levenshtein("", "abc")).toBe(3);
    expect(levenshtein("same", "same")).toBe(0);
  });
});

describe("HeroesService.resolve", () => {
  it("matches exact names ignoring case and punctuation", async () => {
    const m = await service().resolve("natures prophet");
    expect(m.hero.data.localizedName).toBe("Nature's Prophet");
    expect(m.matchedBy).toBe("exact");
  });

  it("matches by numeric id (autocomplete value)", async () => {
    const m = await service().resolve("74");
    expect(m.hero.data.localizedName).toBe("Invoker");
    expect(m.matchedBy).toBe("id");
  });

  it("matches community aliases", async () => {
    expect((await service().resolve("storm")).hero.data.localizedName).toBe("Storm Spirit");
    expect((await service().resolve("AM")).hero.data.localizedName).toBe("Anti-Mage");
    expect((await service().resolve("wr")).matchedBy).toBe("alias");
  });

  it("matches a unique prefix", async () => {
    const m = await service().resolve("Husk");
    expect(m.hero.data.localizedName).toBe("Huskar");
    expect(m.matchedBy).toBe("prefix");
  });

  it("accepts a close typo", async () => {
    const m = await service().resolve("Invokker");
    expect(m.hero.data.localizedName).toBe("Invoker");
    expect(m.matchedBy).toBe("fuzzy");
  });

  it("suggests all candidates for an ambiguous prefix", async () => {
    const err = await notFound("e");
    expect(err.suggestions).toEqual(expect.arrayContaining(["Earth Spirit", "Ember Spirit"]));
  });

  it("suggests nearest heroes for garbage input", async () => {
    const err = await notFound("Xyzzyqq");
    expect(err.suggestions.length).toBeGreaterThan(0);
    expect(err.suggestions.length).toBeLessThanOrEqual(3);
  });

  it("carries source metadata through", async () => {
    const m = await service().resolve("Puck");
    expect(m.hero.source).toBe("fake");
    expect(m.hero.patch).toBe("7.41");
  });
});

describe("HeroesService.search", () => {
  it("returns prefix matches first", async () => {
    const names = (await service().search("inv")).map((h) => h.localizedName);
    expect(names[0]).toBe("Invoker");
  });

  it("matches word starts and aliases", async () => {
    expect((await service().search("spirit")).map((h) => h.localizedName)).toEqual(
      expect.arrayContaining(["Storm Spirit", "Earth Spirit", "Ember Spirit"]),
    );
    expect((await service().search("storm"))[0]!.localizedName).toBe("Storm Spirit");
  });

  it("returns alphabetical list for empty input and respects the limit", async () => {
    const all = await service().search("", 3);
    expect(all.map((h) => h.localizedName)).toEqual(["Anti-Mage", "Disruptor", "Earth Spirit"]);
  });

  it("returns nothing for no match", async () => {
    expect(await service().search("qqqq")).toEqual([]);
  });
});
