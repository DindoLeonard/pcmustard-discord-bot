import type { DotaDataProvider, DotaItem, ItemPhase } from "../providers/dota.provider.js";
import type { PopularItem } from "../types.js";
import { normalizeName } from "./heroes.service.js";

export class ItemsService {
  constructor(private readonly provider: DotaDataProvider) {}

  async popular(heroId: number, phase: ItemPhase, limit = 6): Promise<PopularItem[]> {
    const [popularity, items] = await Promise.all([this.provider.getItemPopularity(heroId), this.byId()]);
    return Object.entries(popularity.data[phase])
      .map(([id, matches]) => ({ id: Number(id), name: items.get(Number(id))?.name ?? `item ${id}`, matches }))
      .sort((a, b) => b.matches - a.matches)
      .slice(0, limit);
  }

  /**
   * Keep only names that are real items (case/punctuation-insensitive), canonicalized.
   * Used to validate item names the AI mentions.
   */
  async validateNames(names: string[]): Promise<{ valid: string[]; rejected: string[] }> {
    const items = (await this.provider.getItems()).data;
    const index = new Map(items.map((i) => [normalizeName(i.name), i.name]));
    const valid: string[] = [];
    const rejected: string[] = [];
    for (const n of names) {
      const hit = index.get(normalizeName(n));
      if (hit && !valid.includes(hit)) valid.push(hit);
      else if (!hit) rejected.push(n);
    }
    return { valid, rejected };
  }

  async allNames(): Promise<string[]> {
    return (await this.provider.getItems()).data.map((i) => i.name);
  }

  private async byId(): Promise<Map<number, DotaItem>> {
    return new Map((await this.provider.getItems()).data.map((i) => [i.id, i]));
  }
}
