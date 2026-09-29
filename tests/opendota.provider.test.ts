import { describe, expect, it, vi } from "vitest";
import { OpenDotaProvider } from "../src/games/dota/providers/opendota.provider.js";
import { ProviderUnavailableError } from "../src/shared/errors.js";

const RAW_HERO_STATS = [
  {
    id: 13,
    name: "npc_dota_hero_puck",
    localized_name: "Puck",
    primary_attr: "int",
    attack_type: "Ranged",
    roles: ["Initiator", "Escape"],
    img: "/apps/dota2/images/dota_react/heroes/puck.png?",
    "1_pick": 100,
    "1_win": 40,
    "8_pick": 0,
    "8_win": 0,
    pub_pick: 1000,
    pub_win: 470,
    pro_pick: 2,
    pro_win: 1,
    pro_ban: 4,
  },
];
const RAW_PATCH = [
  { name: "7.40", date: "2025-12-16T00:50:40.281Z", id: 59 },
  { name: "7.41", date: "2026-03-24T00:50:59.580Z", id: 60 },
];

function mockFetch(overrides: Partial<Record<string, () => Response>> = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname.replace("/api", "");
    const override = overrides[path];
    if (override) return override();
    const body = path === "/heroStats" ? RAW_HERO_STATS : path === "/constants/patch" ? RAW_PATCH : null;
    return body ? Response.json(body) : new Response("not found", { status: 404 });
  });
}

describe("OpenDotaProvider", () => {
  it("normalizes heroStats and attaches source/patch metadata", async () => {
    const provider = new OpenDotaProvider({ fetchFn: mockFetch() as typeof fetch });
    const result = await provider.getHeroes();

    expect(result.source).toBe("opendota");
    expect(result.patch).toBe("7.41");
    expect(result.fetchedAt).toBeInstanceOf(Date);
    expect(result.data[0]).toMatchObject({
      id: 13,
      localizedName: "Puck",
      primaryAttr: "int",
      attackType: "Ranged",
      imageUrl: "https://cdn.cloudflare.steamstatic.com/apps/dota2/images/dota_react/heroes/puck.png?",
      stats: { pubPicks: 1000, pubWins: 470, proBans: 4, brackets: [{ bracket: 1, picks: 100, wins: 40 }] },
    });
  });

  it("caches responses within the TTL and refetches after", async () => {
    let now = 1_000;
    const fetchFn = mockFetch();
    const provider = new OpenDotaProvider({ fetchFn: fetchFn as typeof fetch, ttlMs: 500, now: () => now });

    await provider.getHeroes();
    await provider.getHeroes();
    expect(fetchFn).toHaveBeenCalledTimes(2); // heroStats + patch, once each

    now += 501;
    await provider.getHeroes();
    expect(fetchFn).toHaveBeenCalledTimes(4);
  });

  it("dedupes concurrent requests", async () => {
    const fetchFn = mockFetch();
    const provider = new OpenDotaProvider({ fetchFn: fetchFn as typeof fetch });
    await Promise.all([provider.getHeroes(), provider.getHeroes(), provider.getHero(13)]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("appends the api key when configured", async () => {
    const fetchFn = mockFetch();
    await new OpenDotaProvider({ fetchFn: fetchFn as typeof fetch, apiKey: "k" }).getPatch();
    expect(String(fetchFn.mock.calls[0]![0])).toContain("api_key=k");
  });

  it("throws ProviderUnavailableError on HTTP errors", async () => {
    const provider = new OpenDotaProvider({
      fetchFn: mockFetch({ "/heroStats": () => new Response("rate limited", { status: 429 }) }) as typeof fetch,
    });
    await expect(provider.getHeroes()).rejects.toBeInstanceOf(ProviderUnavailableError);
  });

  it("still returns heroes when the patch endpoint fails", async () => {
    const provider = new OpenDotaProvider({
      fetchFn: mockFetch({ "/constants/patch": () => new Response("down", { status: 503 }) }) as typeof fetch,
    });
    const result = await provider.getHeroes();
    expect(result.data).toHaveLength(1);
    expect(result.patch).toBeUndefined();
  });

  it("getHero returns null for unknown ids", async () => {
    const provider = new OpenDotaProvider({ fetchFn: mockFetch() as typeof fetch });
    expect(await provider.getHero(9999)).toBeNull();
    expect((await provider.getHero(13))?.data.localizedName).toBe("Puck");
  });
});
