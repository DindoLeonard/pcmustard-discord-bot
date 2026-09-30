# Discord Multi-Game AI Assistant

## Project Goal

Build a Discord bot that acts as an AI-powered game assistant.

The bot should help players with game-specific questions such as:

- How to counter a hero or character
- How to counter an enemy lineup
- What hero/character to pick
- How to play a specific matchup
- What items/builds to use
- What a team composition is lacking
- Draft analysis
- General gameplay strategy

The initial supported game should be **Dota 2**, but the architecture should be designed so other games can be added later without rewriting the Discord or AI layers.

Possible future games:

- League of Legends
- Valorant
- Counter-Strike 2
- Mobile Legends
- Overwatch
- Other competitive games

Until a game has its own adapter, questions about it are answered through web search with cited sources (see Data Accuracy Rules).

---

# Current Status (updated 2026-09-29)

Built and working (Phases 1–4 and 6, plus parts of 5):

- Slash commands: `/ping`, `/dota hero|counter|matchup|draft`, `/ask`, `/forget`, all with hero autocomplete and embeds.
- OpenDota provider with per-endpoint caching; curated trait table for all 127 heroes (`src/games/dota/knowledge/heroTraits.ts`).
- Deterministic scoring for counters and drafts, with typed reasons. The AI explains results and never ranks them.
- Natural language through @mentions, the `mustardbot` trigger name and `/ask`. It gives conversational replies grounded in data, with a "Show full analysis" button, plus small talk.
- Shared per-channel conversation memory with `forget`; deterministic draft follow-ups ("they also picked Oracle", "why not X?").
- Web search (OpenAI `web_search` tool) for other games, Dota news and everyday lookups, with sources listed under the reply.
- Player features: `/dota player`, `/dota link`/`unlink`, `/dota scout` (likely picks, bans, and picks against scouted players with a comfort bonus from your own pool). Links are stored in `data/player-links.json`.
- Fallbacks: data-only embeds when the AI fails, and general advice (labelled) when OpenDota is down.

- `/dota meta` (sample-adjusted strongest, most picked, pro-contested), `/dota match` (a review against same-hero percentiles, requesting a parse for unparsed replays), and `/dota live …` (the shared per-channel draft board with bans, undo and suggestions; chat draft questions update it).

Not built yet: Redis/Postgres (memory and live drafts are in-process), STRATZ, `/dota build|items`, a second game adapter, per-user rate limiting.

How to run, drive and test the bot: see `.claude/skills/run-discord-bot-dota/SKILL.md` (the driver exercises real handlers without Discord).

---

# Core Product Principle

Do not rely on the LLM alone for game facts.

The system should combine:

1. **Current game data**
2. **Structured game knowledge**
3. **AI reasoning and explanation**
4. **Web search** — only for questions the game data can't answer (other games, Dota patch notes/news/tournaments, and everyday lookups like opening hours or weather), always with cited sources

The intended architecture is:

```text
Discord User
     |
     v
Discord Bot
     |
     v
Command / Intent Layer
     |
     v
Game Assistant Service
     |
     +------------------------+------------------------+
     |                        |                        |
     v                        v                        v
Game Data / Knowledge        LLM                  Web Search
     |                                     (LLM tool; cited sources;
     v                                      never for Dota statistics)
Game Adapter
     |
     +--> Dota 2
     +--> League of Legends
     +--> Valorant
     +--> future games
```

Web search is a fallback for knowledge, not a source of statistics. Dota win/pick/ban rates and matchup numbers must still come from the configured data providers, never from web results.

The LLM should primarily be responsible for:

- Explaining recommendations
- Reasoning about team compositions
- Summarizing matchup information
- Converting raw statistics into understandable advice
- Handling natural-language questions

The LLM should NOT invent:

- Win rates
- Pick rates
- Patch information
- Matchup statistics
- Current meta data

Any numerical/statistical claims should come from trusted data providers.

---

# Recommended Stack

## Backend

- TypeScript
- Node.js
- discord.js

Recommended web/backend framework:

- Fastify
- Hono
- Express

Any of these are acceptable, but prefer a lightweight TypeScript-first setup.

## Database

Start simple.

For the first MVP, a database may not be required.

Later use:

- PostgreSQL
- Drizzle ORM or Prisma

## Cache

Optional for MVP.

Later:

- Redis

Useful for:

- Hero data
- Recent matchup queries
- Patch metadata
- Draft sessions
- API response caching

## AI

Use an LLM API for reasoning.

The system should be provider-agnostic where possible.

Possible providers:

- OpenAI
- Anthropic
- Gemini

Create an abstraction so the provider can be replaced later.

Example:

```ts
interface AIProvider {
  generateResponse(input: AIRequest): Promise<AIResponse>;
}
```

---

# Initial Game: Dota 2

Start only with Dota 2.

Do not attempt to build all supported games immediately.

Recommended data providers:

- OpenDota
- STRATZ

These providers should be implemented behind dedicated provider classes.

Example:

```text
DotaAdapter
    |
    +--> OpenDotaProvider
    |
    +--> StratzProvider
```

The Dota service should not depend directly on HTTP calls scattered throughout the codebase.

---

# MVP Commands

Implement these first:

```text
/dota counter
/dota matchup
/dota draft
```

After these are working well, add:

```text
/dota build
/dota items
/dota player
/dota analyze-match
/dota meta
```

---

# Command 1: /dota counter

Purpose:

Recommend heroes or strategies that counter a specific enemy hero.

Example:

```text
/dota counter hero:Puck role:Mid
```

Possible inputs:

```text
hero
role
player_role
rank_bracket
```

Example response:

```text
Countering Puck — Mid

Recommended heroes:

1. Hero A
   - Reason
   - Reason
   - Matchup data

2. Hero B
   - Reason
   - Reason
   - Matchup data

General strategy:
- ...
- ...

Useful items:
- ...
- ...
```

The recommendations should use:

- Current matchup data
- Role compatibility
- Hero mechanics
- Patch information
- Strategic reasoning

---

# Command 2: /dota matchup

Purpose:

Analyze a specific hero-versus-hero matchup.

Example:

```text
/dota matchup my_hero:Invoker enemy_hero:Huskar role:Mid
```

The system should return information such as:

- Lane difficulty
- Key threats
- Power spikes
- Important cooldowns
- Recommended starting items
- Recommended early items
- How to approach the lane
- What mistakes to avoid
- When the matchup changes in favor of either hero

Do not reduce the answer to only win-rate statistics.

The bot should explain the actual mechanics behind the matchup.

---

# Command 3: /dota draft

This is expected to become the most important feature.

Purpose:

Analyze entire team compositions and recommend appropriate picks.

Example:

```text
/dota draft
```

Inputs may include:

```text
allied heroes
enemy heroes
open position
player rank
preferred hero pool
```

Example:

```text
Allies:
- Axe
- Invoker
- Drow Ranger
- Lion

Enemies:
- Storm Spirit
- Lifestealer
- Mirana
- Underlord
- Oracle

Open position:
5
```

The bot should analyze:

## Allied team strengths

Examples:

- Initiation
- Disable
- Physical damage
- Magical damage
- Wave clear
- Push
- Sustain
- Save
- Mobility
- Catch
- Frontline

## Allied team weaknesses

Examples:

- No defensive save
- Weak against mobility
- Poor tower damage
- Limited lockdown
- Weak lanes
- Lack of dispel
- No instant disable

## Enemy strengths

Same categories.

## Enemy weaknesses

Same categories.

Then recommend heroes that:

1. Fit the available role
2. Fix allied team weaknesses
3. Counter important enemy heroes
4. Synergize with the allied lineup
5. Perform reasonably in the current patch/meta

---

# Draft Scoring Engine

Do not rely entirely on the LLM to choose heroes.

Create a deterministic scoring system before the AI explanation.

Example:

```text
candidateScore =
    matchupScore        * 0.35
  + teamSynergy         * 0.25
  + roleFit             * 0.20
  + metaPerformance     * 0.10
  + laneCompatibility   * 0.10
```

The exact weights can be adjusted later.

The LLM should receive the calculated candidate information and explain the result.

Do not ask the LLM:

```text
What hero should this player pick?
```

without supplying structured data.

Instead provide something like:

```text
Candidate: Disruptor

matchupScore: 0.84
teamSynergy: 0.91
roleFit: 1.00
metaPerformance: 0.71
laneCompatibility: 0.78

Provides:
- silence
- anti-mobility
- catch
- teamfight

Strong against:
- Storm Spirit

Team currently lacks:
- backline control
- anti-mobility

Explain why this hero fits the draft.
```

---

# Game Adapter Architecture

The Discord layer should not contain game-specific logic.

Create a shared game interface.

Example:

```ts
interface GameAdapter {
  game: string;

  resolveCharacter(name: string): Promise<GameCharacter | null>;

  getCounters(
    characterId: string,
    options?: CounterOptions,
  ): Promise<CounterResult[]>;

  analyzeMatchup(
    characterA: string,
    characterB: string,
    options?: MatchupOptions,
  ): Promise<MatchupAnalysis>;

  analyzeTeam(team: string[]): Promise<TeamAnalysis>;

  getMeta(): Promise<MetaData>;
}
```

Implement:

```ts
class DotaAdapter implements GameAdapter {
  ...
}
```

Future:

```ts
class LeagueAdapter implements GameAdapter {
  ...
}

class ValorantAdapter implements GameAdapter {
  ...
}
```

Use a registry.

Example:

```ts
const gameRegistry = new Map<string, GameAdapter>();

gameRegistry.set("dota2", new DotaAdapter());
```

Then higher layers can do:

```ts
const adapter = gameRegistry.get(game);

const result = await adapter.getCounters(heroId);
```

---

# Recommended Project Structure

```text
src/

  discord/
    client.ts

    commands/
      dota/
        counter.ts
        matchup.ts
        draft.ts
        build.ts
        items.ts

      ask.ts

    components/
      buttons.ts
      selects.ts
      embeds.ts

  games/
    registry.ts

    types/
      game.ts
      hero.ts
      matchup.ts
      draft.ts

    dota/
      dota.adapter.ts

      services/
        heroes.service.ts
        matchup.service.ts
        draft.service.ts
        items.service.ts
        meta.service.ts
        scoring.service.ts

      providers/
        opendota.provider.ts
        stratz.provider.ts

      knowledge/
        heroTraits.ts
        itemTraits.ts
        mechanics.ts

  ai/
    ai.service.ts

    providers/
      anthropic.provider.ts
      openai.provider.ts

    prompts/
      counter.prompt.ts
      matchup.prompt.ts
      draft.prompt.ts
      general.prompt.ts

  cache/
    redis.ts

  db/
    index.ts
    schema.ts

  config/
    env.ts

  shared/
    errors.ts
    logger.ts
    utils.ts

  index.ts
```

---

# Structured Dota Knowledge

In addition to API statistics, maintain structured knowledge about heroes and mechanics.

Example:

```ts
type HeroTrait =
  | "mobility"
  | "burst"
  | "sustain"
  | "silence"
  | "instant_disable"
  | "save"
  | "dispel"
  | "mana_burn"
  | "break"
  | "frontline"
  | "wave_clear"
  | "tower_push"
  | "teamfight"
  | "catch"
  | "anti_mobility";
```

Example hero definition:

```ts
{
  hero: "Puck",

  strengths: [
    "mobility",
    "wave_clear",
    "teamfight",
    "spell_dodge"
  ],

  weaknesses: [
    "silence",
    "instant_disable",
    "mana_burn"
  ]
}
```

Example:

```ts
{
  hero: "Disruptor",

  provides: [
    "silence",
    "catch",
    "anti_mobility",
    "teamfight"
  ]
}
```

This allows the system to reason about:

```text
Storm Spirit
    |
    v
weak to anti-mobility
    |
    v
Disruptor provides anti-mobility
```

instead of depending only on matchup percentages.

---

# Team Trait Analysis

Create a shared representation of what a lineup provides.

Example:

```ts
interface TeamProfile {
  initiation: number;
  disable: number;
  catch: number;
  physicalDamage: number;
  magicalDamage: number;
  burst: number;
  sustain: number;
  save: number;
  waveClear: number;
  towerPush: number;
  mobility: number;
  frontline: number;
  dispel: number;
}
```

Values could initially be normalized:

```text
0.0 - 1.0
```

or:

```text
0 - 10
```

This should be calculated from structured hero data.

Example output:

```text
Team Profile

Initiation:       8/10
Disable:          7/10
Catch:            6/10
Physical Damage:  9/10
Magical Damage:   6/10
Save:             2/10
Wave Clear:       8/10
Tower Push:       5/10
```

Then detect deficiencies.

Example:

```text
Major weaknesses:
- Save
- Anti-mobility
- Defensive dispel
```

Candidate hero scoring should reward heroes that fix these weaknesses.

---

# Natural Language Support

After structured slash commands are working well, support natural-language questions.

Example:

```text
@GameBot I'm Invoker mid against Huskar. What should I do?
```

The AI should first extract structured intent.

Example:

```json
{
  "game": "dota2",
  "intent": "matchup_advice",
  "hero": "Invoker",
  "enemy": "Huskar",
  "role": "mid"
}
```

Then the normal game service handles the request.

Do not create a separate logic system for natural-language queries.

Natural language should simply translate user text into the same internal models used by slash commands.

## How natural language works (implemented)

Entry points: `@mention`, messages that start with a trigger name (`BOT_TRIGGER_NAMES`, default `mustardbot`), and `/ask`. Everything goes through `AskService` (`src/assistant/ask.service.ts`):

```text
text + channel memory
     |
     v
intent parse (AI, structured JSON)  -> only heroes named in the NEW message
     |
     v
plan (deterministic)                 -> same inputs as the slash commands;
     |                                  draft lineups merged in code: previous - removed + new
     v
ground (deterministic analysis)      -> OpenDota + curated traits + scoring engine
     |                                  (or web search for other games / Dota news)
     v
one conversational chat reply (AI)   -> grounded in the same context text the embeds use
     |
     v
Discord message + "Show full analysis" button (opens the slash-command embed, ephemeral)
```

Rules:

- Chat replies are short and conversational and answer the question actually asked. Detailed embeds sit behind the button; slash commands still reply with embeds.
- The intent parser never merges draft lineups: it reports heroes named in the new message plus `removed` and `continuesDraft`, and code does the merge. This prevents heroes from unrelated earlier turns leaking into a draft.
- "Position" means the slot to fill for `pick_recommendation` / `why_not_pick`, but the player's own position for `draft_analysis` ("I picked AM pos 5, how should my team adjust?" is a team analysis, not a pick list).
- Small talk gets a brief friendly reply with no data. Other games and time-sensitive Dota info go to web search.
- Any language works (tested with Bisaya/Cebuano and Bislish). The parser understands it, and replies use the user's language and style, with game names kept in English.
- A message that names heroes for both teams always starts a fresh lineup, even if the parser says it continues a draft. This stops an earlier question's heroes leaking in.
- The bot must never *say* it forgot without clearing memory. "Forget" is matched by a regex (English, Bisaya, Tagalog) and by the `forget_memory` intent.

## Conversation memory (implemented)

- Short-term, **shared per channel**: everyone in a channel is in one conversation; each turn records the author's display name.
- Only messages addressed to the bot are stored, never ordinary chat.
- Each turn stores a one-line summary plus structured context (hero, enemy, position, allies, enemies), not the full reply.
- Defaults: last 6 turns, expires 30 minutes after the last turn (`MEMORY_MAX_TURNS`, `MEMORY_TTL_MINUTES`).
- `forget` / `reset` / `/forget` clears the channel without an AI call.
- In-process only (lost on restart). Move to Redis together with draft sessions.

---

# Intent Types

Implemented intents (`src/ai/prompts/intent.prompt.ts`):

```ts
type GameIntent =
  | "counter_character"   // what counters X
  | "matchup_advice"      // my hero vs enemy hero
  | "draft_analysis"      // evaluate lineups / how should we adjust (team analysis; re-scores a pick when continuing one)
  | "pick_recommendation" // what should I pick for position N
  | "why_not_pick"        // why not hero X for the draft being discussed
  | "hero_info"           // how to play hero X
  | "general_strategy"    // Dota strategy without specific heroes
  | "small_talk"          // greetings, thanks, off-topic chat
  | "forget_memory"       // "forget everything" in any language -> actually clears memory
  | "dota_news"           // patch notes, tournaments, news -> web search
  | "other_game"          // a different video game -> web search
  | "web_lookup"          // everyday real-world facts: opening hours, places, weather, news -> web search
  | "player_lookup"       // one player's rank / heroes / what they pick ("me", Friend ID, link, @linked user)
  | "scout_players"       // several enemy players: likely picks, bans, picks against them
  | "meta_query"          // what's strong this patch (position / rank bracket)
  | "match_review";       // "how did I do last game?" / review match <id> (optionally a player by name)
```

Planned later: `item_recommendation`, `build_recommendation`.

---

# Draft Session Feature

**Implemented as `/dota live …`** (`src/assistant/liveDraft.ts`, `src/discord/commands/dota/live.ts`). It works as described below, with these differences: the commands live under `/dota live` (because `/dota draft` is the one-shot analysis), it tracks **bans** (never suggested), the board has Suggest / Undo / End buttons and each update replaces the previous board message, and it is stored **in-process** (TTL 2h after the last change) until Redis is added. Chat draft questions in a channel with a live draft update that draft.

Original design notes:

Later, support persistent drafting inside a Discord channel.

Example:

```text
/dota draft start
```

Then:

```text
/dota draft ally Axe
/dota draft enemy Storm Spirit
/dota draft ally Invoker
```

The bot maintains the draft state.

Example:

```text
RADIANT

1. Axe
2. Invoker
3. ?
4. ?
5. ?

DIRE

1. Storm Spirit
2. ?
3. ?
4. ?
5. ?
```

Then:

```text
/dota suggest position:5
```

The bot returns recommended candidates.

Store session state in Redis.

Suggested key format:

```text
draft:{guildId}:{channelId}
```

Potential stored object:

```ts
interface DraftSession {
  game: "dota2";

  guildId: string;
  channelId: string;

  allies: string[];
  enemies: string[];

  createdBy: string;

  createdAt: number;
  updatedAt: number;
}
```

Draft sessions should expire automatically.

Example:

```text
TTL: 1 hour
```

---

# Discord UX

Prefer slash commands over requiring users to memorize syntax.

Use:

- Autocomplete
- Select menus
- Buttons
- Embeds
- Modals when useful

Hero arguments should support autocomplete.

Example:

```text
/dota matchup my_hero:Inv...
```

Discord should suggest:

```text
Invoker
```

Potential response actions:

```text
[Explain Matchup]

[Recommended Items]

[Team Counters]

[Show Stats]
```

Use Discord embeds for readable responses.

Avoid extremely long wall-of-text messages.

---

# AI Input Design

The AI should be given normalized, trusted information.

Example:

```text
SYSTEM

You are a Dota 2 strategy analyst.

You must not invent statistics.

Only use numerical statistics supplied in the context.

If data is incomplete, clearly say so.

CURRENT PATCH

7.xx

USER ROLE

Position 5

ALLIES

Axe
Invoker
Drow Ranger
Lion

ENEMIES

Storm Spirit
Lifestealer
Mirana
Underlord
Oracle

TEAM ANALYSIS

Allied strengths:
- initiation
- physical damage
- wave clear

Allied weaknesses:
- save
- anti-mobility

Enemy strengths:
- mobility
- sustain

IMPORTANT ENEMY

Storm Spirit

CANDIDATE

Disruptor

Candidate metrics:
matchup score: 0.84
team synergy: 0.91
role fit: 1.00
meta score: 0.71

Provides:
- silence
- anti-mobility
- catch
- teamfight

TASK

Explain why Disruptor fits this draft.

Mention weaknesses and tradeoffs.

Do not claim that this is objectively the only correct pick.
```

---

# Data Accuracy Rules

Important system requirements:

1. Never allow the LLM to generate fake win rates.

2. Numerical game statistics must come from:

```text
OpenDota
STRATZ
or another configured game provider
```

3. Every cached data object should include:

```ts
{
  source: string;
  fetchedAt: Date;
  patch?: string;
}
```

4. If API data is unavailable:

The bot may still provide general strategic advice, but it should clearly distinguish this from current statistical analysis.

5. Cache game API responses to avoid unnecessary requests.

6. Player data rules:

- Player stats come only from OpenDota and only work for public profiles ("Expose Public Match Data"). Explain this when there's no data.
- A Discord user can only be linked to a Dota account by themselves (`/dota link`). Never link or look up someone by @mention unless they linked themselves.
- "Likely picks" are estimates from match history (recent form weighted above all-time), and must be labelled as a guess, not a prediction.
- Bot messages must never ping anyone: the client sets `allowedMentions: { parse: [] }`.

7. Web search rules:

- Use web search only when configured data providers can't answer: questions about other games, time-sensitive Dota information (patch notes, hero reworks, tournaments, esports results, news), and everyday real-world lookups (opening hours, addresses, weather, news).
- The bot must describe its own abilities truthfully. The chat prompt is told whether web search is enabled, so "can you search?" gets an honest answer.
- If a web answer comes back without citations, say so ("no source links came back, so double-check it") rather than showing it without provenance.
- Never use web results for Dota win rates, pick rates, ban rates or matchup statistics. Those come only from the data providers.
- Every web-based answer must show its sources (titles + links) under the reply.
- If web search is disabled or fails, the bot may answer from the model's general knowledge, but must label it as possibly out of date.

---

# Provider Interfaces

Example:

```ts
interface DotaDataProvider {
  getHeroes(): Promise<DotaHero[]>;

  getHero(heroId: number): Promise<DotaHero>;

  getHeroMatchups(heroId: number): Promise<HeroMatchup[]>;

  getHeroStats(heroId: number): Promise<HeroStats>;

  getPatch(): Promise<PatchInfo>;
}
```

Possible providers:

```ts
class OpenDotaProvider implements DotaDataProvider {
  ...
}

class StratzProvider implements DotaDataProvider {
  ...
}
```

The Dota services should consume the provider interface, not hard-coded HTTP clients.

---

# Error Handling

Provide useful Discord errors.

Examples:

```text
I couldn't find the hero "Invokker".

Did you mean:
- Invoker
```

API unavailable:

```text
Current matchup statistics are temporarily unavailable.

I can still provide strategy advice based on hero mechanics.
```

Invalid draft:

```text
The same hero cannot appear on both teams.
```

Unknown game:

```text
That game isn't supported yet.
```

---

# Logging

Create structured logging.

Log:

- Command used
- Game
- Intent
- API provider
- API latency
- AI latency
- Cache hit/miss
- Errors

Do NOT log:

- Discord tokens
- API keys
- Private credentials

---

# Environment Variables

Example:

Current variables (see `.env.example`; validated in `src/config/env.ts`):

```env
# Discord (required to boot the bot)
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_GUILD_ID=            # optional: guild-scoped command registration
BOT_TRIGGER_NAMES=mustardbot # messages starting with these names get a reply (needs Message Content intent)

# Data providers
OPENDOTA_API_KEY=            # optional
OPENDOTA_BASE_URL=           # optional, for testing outages

# AI
OPENAI_API_KEY=              # optional: without it the bot shows data-only answers
OPENAI_MODEL=gpt-5.4-mini
OPENAI_REASONING_EFFORT=low
AI_TIMEOUT_MS=25000

# Web search (OpenAI web_search tool; extra cost per search)
WEB_SEARCH_ENABLED=true
WEB_SEARCH_MODEL=            # optional, defaults to OPENAI_MODEL
WEB_SEARCH_TIMEOUT_MS=45000

# Conversation memory
MEMORY_MAX_TURNS=6           # 0 disables memory
MEMORY_TTL_MINUTES=30

# Player links (/dota link)
PLAYER_LINKS_FILE=data/player-links.json

LOG_LEVEL=info
```

Planned later:

```env
ANTHROPIC_API_KEY=
STRATZ_API_TOKEN=
REDIS_URL=
DATABASE_URL=
```

Validate environment variables at startup.

Use a schema validator such as:

```text
Zod
```

---

# Security

Never expose secrets to Discord users.

Do not commit:

```text
.env
Discord bot token
LLM API keys
STRATZ keys
database credentials
```

Provide:

```text
.env.example
```

instead.

Add `.env` to `.gitignore`.

---

# Development Strategy

Build incrementally.

## Phase 1

Goal:

Get the Discord bot responding.

Implement:

```text
/ping
```

Then:

```text
/dota hero
```

The bot should resolve a hero and return basic hero information.

---

## Phase 2

Implement:

```text
/dota counter
```

Pipeline:

```text
Discord command
     |
     v
Dota service
     |
     v
OpenDota
     |
     v
Normalize data
     |
     v
AI explanation
     |
     v
Discord embed
```

---

## Phase 3

Implement:

```text
/dota matchup
```

Focus on:

- Hero-vs-hero statistics
- Lane strategy
- Item recommendations
- Mechanical explanation

---

## Phase 4

Implement:

```text
/dota draft
```

Build:

- Team traits
- Team weakness detection
- Candidate filtering
- Candidate scoring
- AI explanation

This is the most important architectural phase.

---

## Phase 5

Implement draft sessions.

Commands:

```text
/dota draft start
/dota draft ally
/dota draft enemy
/dota draft remove
/dota draft status
/dota draft suggest
/dota draft reset
```

---

## Phase 6

Add natural-language support.

Example:

```text
@bot what should I pick against Storm and Lifestealer?
```

Convert this into structured intent, then reuse existing services.

---

## Phase 7

Add another game.

Use this phase to verify that the original architecture is truly game-agnostic.

Possible next game:

```text
League of Legends
```

Implement:

```ts
class LeagueAdapter implements GameAdapter
```

The Discord and AI orchestration layers should require little or no modification.

---

# Coding Principles

Follow these principles while implementing the project:

## Keep Discord thin

Discord handlers should primarily:

1. Validate input
2. Call a service
3. Format a response

Avoid putting game logic in command handlers.

Bad:

```ts
execute() {
  fetch(...)
  calculateCounters(...)
  calculateTeam(...)
  callAI(...)
}
```

Good:

```ts
execute() {
  const result = await draftService.analyze(input);

  return renderDraftResponse(result);
}
```

---

## Keep LLM output separate from raw game logic

Prefer:

```text
data collection
      |
      v
deterministic analysis
      |
      v
AI explanation
```

instead of:

```text
user input
      |
      v
LLM decides everything
```

---

## Favor typed structured objects

Avoid passing loose strings between services.

Example:

```ts
interface CounterAnalysis {
  targetHero: Hero;

  candidates: CounterCandidate[];

  patch: string;

  source: string[];

  generatedAt: Date;
}
```

---

## Make ranking explainable

Every recommended hero should include structured reasons.

Example:

```ts
interface RecommendationReason {
  type: "counter" | "synergy" | "role_fit" | "team_need" | "meta";

  description: string;

  weight: number;
}
```

Then a candidate can expose:

```ts
{
  hero: "Disruptor",

  score: 0.86,

  reasons: [
    {
      type: "counter",
      description: "Provides strong anti-mobility against Storm Spirit",
      weight: 0.35
    },
    {
      type: "team_need",
      description: "Adds catch and silence",
      weight: 0.25
    }
  ]
}
```

This will make recommendations easier to debug and improve.

---

# Testing

Use unit tests for deterministic logic.

Especially test:

- Hero name matching
- Trait aggregation
- Team analysis
- Candidate scoring
- Role validation
- Duplicate hero detection

Do not primarily test AI wording.

Instead test the structured data given to the AI.

Example:

```ts
expect(result.teamWeaknesses).toContain("save");

expect(result.candidates[0].reasons.length).toBeGreaterThan(0);
```

Mock external APIs.

Recommended test framework:

```text
Vitest
```

---

# Initial Deliverable

The first useful production milestone should be:

```text
A Discord bot that supports:

/dota counter
/dota matchup
/dota draft
```

with:

- Hero autocomplete
- OpenDota integration
- Structured game service architecture
- AI explanations
- Clean Discord embeds
- No hallucinated statistics

Do not over-engineer the first release.

Prioritize an end-to-end working system.

---

# First Implementation Task

Start by creating the TypeScript Discord project.

Implement:

1. Project structure
2. Environment configuration
3. Discord client
4. Command registration
5. `/ping`
6. `/dota hero`
7. Dota hero lookup service
8. OpenDota provider
9. Hero autocomplete

Once that works, implement `/dota counter`.

Before introducing PostgreSQL, Redis, or additional APIs, make sure the basic Dota data pipeline works correctly.

---

# Long-Term Vision

The final product should feel less like:

```text
ChatGPT running inside Discord
```

and more like:

```text
An intelligent game-analysis engine with Discord as its interface.
```

The main competitive advantage should be:

- Current game data
- Structured game knowledge
- Team composition analysis
- Explainable recommendations
- Natural-language interaction
- Support for multiple games through adapters

The bot should eventually be capable of answering:

```text
What counters Puck?
```

```text
How do I lane as Invoker against Huskar?
```

```text
What position 5 fits this draft?
```

```text
Why is our lineup losing teamfights?
```

```text
What item should I buy against this lineup?
```

```text
Our enemies are Storm, Lifestealer, Mirana and Oracle.
What are we missing?
```

and produce recommendations based on actual game data plus game-mechanics reasoning rather than generic LLM knowledge.
