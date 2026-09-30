import { env } from "../../config/env.js";
import { HeroNotFoundError } from "../../shared/errors.js";
import type { GameAdapter } from "../types/game.js";
import type { GameCharacter } from "../types/hero.js";
import type { DotaDataProvider, DotaHero } from "./providers/dota.provider.js";
import { OpenDotaProvider } from "./providers/opendota.provider.js";
import { CounterService } from "./services/counter.service.js";
import { DraftService } from "./services/draft.service.js";
import { HeroesService } from "./services/heroes.service.js";
import { ItemsService } from "./services/items.service.js";
import { MatchService } from "./services/match.service.js";
import { MatchupService } from "./services/matchup.service.js";
import { MetaService } from "./services/meta.service.js";
import { PlayerService } from "./services/player.service.js";
import { ScoutService } from "./services/scout.service.js";

function toCharacter(hero: DotaHero): GameCharacter {
  return { id: String(hero.id), name: hero.localizedName, roles: hero.roles, imageUrl: hero.imageUrl };
}

export class DotaAdapter implements GameAdapter {
  readonly game = "dota2";
  readonly displayName = "Dota 2";
  readonly provider: DotaDataProvider;
  readonly heroes: HeroesService;
  readonly items: ItemsService;
  readonly counters: CounterService;
  readonly matchups: MatchupService;
  readonly drafts: DraftService;
  readonly players: PlayerService;
  readonly scouts: ScoutService;
  readonly meta: MetaService;
  readonly matches: MatchService;

  constructor(provider: DotaDataProvider = new OpenDotaProvider({ apiKey: env.OPENDOTA_API_KEY, baseUrl: env.OPENDOTA_BASE_URL })) {
    this.provider = provider;
    this.heroes = new HeroesService(provider);
    this.items = new ItemsService(provider);
    this.counters = new CounterService(provider, this.heroes);
    this.matchups = new MatchupService(provider, this.heroes, this.items);
    this.drafts = new DraftService(provider, this.heroes);
    this.players = new PlayerService(provider, this.heroes);
    this.scouts = new ScoutService(this.players, this.drafts);
    this.meta = new MetaService(this.heroes);
    this.matches = new MatchService(provider, this.heroes, this.items);
  }

  async resolveCharacter(name: string): Promise<GameCharacter | null> {
    try {
      return toCharacter((await this.heroes.resolve(name)).hero.data);
    } catch (err) {
      if (err instanceof HeroNotFoundError) return null;
      throw err;
    }
  }

  async searchCharacters(prefix: string, limit?: number): Promise<GameCharacter[]> {
    return (await this.heroes.search(prefix, limit)).map(toCharacter);
  }
}
