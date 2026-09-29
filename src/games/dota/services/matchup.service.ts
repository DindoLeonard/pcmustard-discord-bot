import { SameHeroError } from "../../../shared/errors.js";
import { getKnowledge } from "../knowledge/heroTraits.js";
import type { Position } from "../knowledge/traits.js";
import type { DotaDataProvider, DotaHero } from "../providers/dota.provider.js";
import type { MatchupAnalysis } from "../types.js";
import type { HeroesService } from "./heroes.service.js";
import type { ItemsService } from "./items.service.js";
import { matchupFromOwnRecords, traitOverlap } from "./scoring.service.js";

export interface MatchupOptions {
  position?: Position;
}

export class MatchupService {
  constructor(
    private readonly provider: DotaDataProvider,
    private readonly heroes: HeroesService,
    private readonly items: ItemsService,
  ) {}

  async analyze(heroQuery: string, enemyQuery: string, options: MatchupOptions = {}): Promise<MatchupAnalysis> {
    const [{ hero: a }, { hero: b }] = await Promise.all([this.heroes.resolve(heroQuery), this.heroes.resolve(enemyQuery)]);
    const hero = a.data;
    const enemy = b.data;
    if (hero.id === enemy.id) throw new SameHeroError(hero.localizedName);

    const [matchups, heroAbilities, enemyAbilities, start, early] = await Promise.all([
      this.provider.getHeroMatchups(hero.id),
      this.provider.getHeroAbilities(hero.name),
      this.provider.getHeroAbilities(enemy.name),
      this.items.popular(hero.id, "start", 6),
      this.items.popular(hero.id, "early", 6),
    ]);

    return buildMatchupAnalysis(hero, enemy, {
      position: options.position,
      stat: matchupFromOwnRecords(hero.id, enemy.id, matchups.data),
      heroAbilities: heroAbilities.data,
      enemyAbilities: enemyAbilities.data,
      popularItems: { start, early },
      sources: [
        { source: a.source, fetchedAt: a.fetchedAt, patch: a.patch },
        { source: matchups.source, fetchedAt: matchups.fetchedAt, patch: matchups.patch },
      ],
    });
  }
}

export function buildMatchupAnalysis(
  hero: DotaHero,
  enemy: DotaHero,
  rest: Pick<MatchupAnalysis, "stat" | "heroAbilities" | "enemyAbilities" | "popularItems" | "sources"> & { position?: Position },
): MatchupAnalysis {
  const heroKnowledge = getKnowledge(hero.localizedName);
  const enemyKnowledge = getKnowledge(enemy.localizedName);
  return {
    hero,
    enemy,
    heroKnowledge,
    enemyKnowledge,
    heroExploits: traitOverlap(heroKnowledge?.provides, enemyKnowledge?.weakTo),
    enemyExploits: traitOverlap(enemyKnowledge?.provides, heroKnowledge?.weakTo),
    generatedAt: new Date(),
    ...rest,
  };
}
