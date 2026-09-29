import { HeroNotFoundError } from "../../../shared/errors.js";
import type { Sourced } from "../../types/game.js";
import { HERO_ALIASES } from "../knowledge/heroAliases.js";
import type { DotaDataProvider, DotaHero } from "../providers/dota.provider.js";

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
    }
    prev = curr;
  }
  return prev[b.length]!;
}

export interface HeroMatch {
  hero: Sourced<DotaHero>;
  matchedBy: "id" | "exact" | "alias" | "prefix" | "fuzzy";
}

export class HeroesService {
  constructor(private readonly provider: DotaDataProvider) {}

  async list(): Promise<Sourced<DotaHero[]>> {
    return this.provider.getHeroes();
  }

  /** Resolve a user-supplied name (or numeric id from autocomplete) to a hero, or throw HeroNotFoundError with suggestions. */
  async resolve(input: string): Promise<HeroMatch> {
    const heroes = await this.provider.getHeroes();
    const wrap = (hero: DotaHero, matchedBy: HeroMatch["matchedBy"]): HeroMatch => ({
      hero: { ...heroes, data: hero },
      matchedBy,
    });

    const trimmed = input.trim();
    if (/^\d+$/.test(trimmed)) {
      const byId = heroes.data.find((h) => h.id === Number(trimmed));
      if (byId) return wrap(byId, "id");
    }

    const query = normalizeName(trimmed);
    if (!query) throw new HeroNotFoundError(input, []);

    const exact = heroes.data.find((h) => normalizeName(h.localizedName) === query);
    if (exact) return wrap(exact, "exact");

    const aliasTarget = HERO_ALIASES[query];
    if (aliasTarget) {
      const alias = heroes.data.find((h) => h.localizedName === aliasTarget);
      if (alias) return wrap(alias, "alias");
    }

    const prefixed = heroes.data.filter((h) => normalizeName(h.localizedName).startsWith(query));
    if (prefixed.length === 1) return wrap(prefixed[0]!, "prefix");

    const ranked = this.rankFuzzy(heroes.data, query);
    const best = ranked[0];
    // Accept a single clearly-best fuzzy match with a small edit distance.
    if (best && best.distance <= Math.max(1, Math.floor(query.length / 4)) && ranked[1]?.distance !== best.distance) {
      return wrap(best.hero, "fuzzy");
    }

    const suggestions = (prefixed.length > 1 ? prefixed : ranked.slice(0, 3).map((r) => r.hero))
      .slice(0, 5)
      .map((h) => h.localizedName);
    throw new HeroNotFoundError(input, suggestions);
  }

  /** Autocomplete: heroes whose name or alias starts with / contains the prefix. Max 25 (Discord limit). */
  async search(prefix: string, limit = 25): Promise<DotaHero[]> {
    const heroes = (await this.provider.getHeroes()).data;
    const query = normalizeName(prefix);
    const sorted = [...heroes].sort((a, b) => a.localizedName.localeCompare(b.localizedName));
    if (!query) return sorted.slice(0, limit);

    const aliasName = HERO_ALIASES[query];
    const score = (h: DotaHero): number => {
      const n = normalizeName(h.localizedName);
      if (h.localizedName === aliasName) return 0;
      if (n.startsWith(query)) return 1;
      if (h.localizedName.toLowerCase().split(/[\s-]+/).some((w) => normalizeName(w).startsWith(query))) return 2;
      if (n.includes(query)) return 3;
      return Infinity;
    };
    return sorted
      .map((h) => ({ h, s: score(h) }))
      .filter((x) => x.s !== Infinity)
      .sort((a, b) => a.s - b.s)
      .slice(0, limit)
      .map((x) => x.h);
  }

  private rankFuzzy(heroes: DotaHero[], query: string) {
    return heroes
      .map((hero) => ({ hero, distance: levenshtein(query, normalizeName(hero.localizedName)) }))
      .sort((a, b) => a.distance - b.distance);
  }
}
