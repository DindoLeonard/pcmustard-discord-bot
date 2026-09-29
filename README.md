# MustardBot — Dota 2 AI Assistant for Discord

**Version 1.2.0** · see [CHANGELOG.md](CHANGELOG.md) for what's in each release.

A Discord bot that helps with Dota 2: counters, lane matchups, draft picks, and plain-English questions. It answers like a knowledgeable friend in chat, but its recommendations come from **real match data and a scoring engine**, not from the AI's imagination.

```text
You:        mustardbot we have Axe and Lion, they have Storm, Lifestealer and Oracle. what pos 4?
MustardBot: Go Mirana. She fits pos 4 perfectly here and lines up well into all three of their
            heroes: instant catch for Storm, setup for Lifestealer, and she can punish Oracle
            before he saves anyone. The 70.4% vs Storm over 71 games is the big green flag.
            If you want backups, Pugna and Tusk are next.
            [Show full analysis]
```

## Features

- **Counters**: `/dota counter`, which heroes beat a hero, with the reasons, strategy and items.
- **Lane matchups**: `/dota matchup`, head-to-head stats, the enemy's real cooldowns, a lane plan and items.
- **Draft analysis**: `/dota draft`, your team's strengths and gaps, the best picks for your open position, and a "Why not…?" menu to compare any other hero.
- **Hero info**: `/dota hero`, stats by rank bracket, with "Explain playstyle" and "What counters X?" buttons.
- **Natural language**: @mention the bot, start a message with `mustardbot`, or use `/ask`. You get a short conversational answer with a **Show full analysis** button for the detailed breakdown.
- **Shared conversation memory**: everyone in a channel shares one conversation, so follow-ups work across friends ("what about vs Lion?", "they also picked Oracle", "why not Earthshaker?"). `mustardbot forget` or `/forget` clears it.
- **Web search**: questions about other games (e.g. Valheim) and current Dota news or patch notes are looked up on the web, with sources listed under the answer.
- **Players and scouting**: `/dota player` shows anyone's rank, heroes and likely picks (from a Friend ID or profile link). `/dota scout` predicts what enemy players will pick, suggests bans, and recommends picks against them. `/dota link` connects your own account so `me` and @mentions work.
- **Hero name help**: autocomplete, nicknames (`storm`, `am`, `wr`), typo tolerance, and AI guesses for descriptions ("the fat guy with the hook" → Pudge).

## How it stays accurate

1. **Data**: win rates, matchups, item popularity and ability cooldowns come from [OpenDota](https://www.opendota.com/).
2. **Knowledge**: a curated trait table for all 127 heroes (what each hero provides and what it's weak to).
3. **Scoring**: deterministic code ranks the candidates and records the reasons behind each score.
4. **AI**: OpenAI explains the ranked results in plain language. It isn't allowed to invent statistics, and hero or item names it mentions are checked against real data before they're shown.

When a service is down, the bot degrades gracefully. If the AI fails you still get data-only answers. If OpenDota is down you get general advice, clearly labelled.

## Setup

### Requirements

- Node.js 20 or newer
- A Discord application with a bot user
- An OpenAI API key (optional, but needed for AI explanations, natural-language questions and web search)

### 1. Create the Discord bot

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. Under **Bot**:
   - Copy the **token** (Reset Token). This is `DISCORD_TOKEN`.
   - Under **Privileged Gateway Intents**, enable **Message Content Intent**. It's needed for the `mustardbot` name trigger.
3. Under **General Information**, copy the **Application ID**. This is `DISCORD_CLIENT_ID`.
4. Invite the bot: go to **OAuth2 → URL Generator**, tick the scopes `bot` and `applications.commands`, and open the generated URL.
5. Optional: to get your server's ID, turn on Developer Mode in Discord (User Settings → Advanced), then right-click your server → **Copy Server ID**. This is `DISCORD_GUILD_ID`.

### 2. Install and configure

```bash
npm install
cp .env.example .env    # then fill in the values
```

Minimal `.env`:

```env
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-application-id
DISCORD_GUILD_ID=your-server-id      # recommended: commands appear instantly in this server
OPENAI_API_KEY=your-openai-key
```

### 3. Register commands and run

```bash
npm run register   # tell Discord about the slash commands (re-run when commands change)
npm run dev        # start the bot; keep this running
```

The bot is only online while this process runs. To keep it up 24/7, host it on a VPS or a service like Railway or Fly.io:

```bash
npm run build && npm start
```

## Commands

| Command | Description |
|---|---|
| `/dota counter hero:<hero> [position] [rank]` | Heroes that counter the enemy hero, optionally filtered to a position |
| `/dota matchup my_hero:<hero> enemy_hero:<hero> [position]` | How to play your hero against a specific enemy |
| `/dota draft position:<1-5> [ally1..ally4] [enemy1..enemy5] [rank]` | Team analysis and pick recommendations for your open position |
| `/dota hero hero:<hero>` | Hero overview, stats by bracket, and playstyle and counters buttons |
| `/dota player [account] [user]` | A player's rank, record, most played heroes, recent matches and likely picks (default: your linked account) |
| `/dota link account:<Friend ID>` | Link **your own** Dota account, so `me` works and friends can @mention you |
| `/dota unlink` | Remove your link |
| `/dota scout enemy1..enemy5 [position] [rank]` | Scout enemy players: likely picks, suggested bans, and picks against them for your position |
| `/ask question:<text>` | Ask anything in plain English |
| `/forget` | Clear the bot's conversation memory for this channel |
| `/ping` | Check that the bot is alive |

You can also talk to the bot directly:

```text
@MustardBot I'm Invoker mid vs Huskar, how do I lane?
mustardbot what counters PA?
mustardbot i accidentally picked am pos 5, what should my team do?
mustardbot what changed in the latest dota patch?
mustardbot do you know valheim? what armor for the swamp?
mustardbot what does 158650393 usually play?
mustardbot scout @Leo and 86745912, what pos 4 should I pick?
mustardbot forget
```

Positions: 1 = carry, 2 = mid, 3 = offlane, 4 = soft support, 5 = hard support.

## Configuration

All settings live in `.env` (see `.env.example`). They're validated when the bot starts.

| Variable | Default | Description |
|---|---|---|
| `DISCORD_TOKEN` | — | **Required.** Bot token |
| `DISCORD_CLIENT_ID` | — | **Required.** Application ID |
| `DISCORD_GUILD_ID` | — | Register commands to one server (instant) instead of globally (can take up to an hour) |
| `BOT_TRIGGER_NAMES` | `mustardbot` | Comma-separated names that trigger a reply when a message starts with them. Empty = @mentions only |
| `OPENAI_API_KEY` | — | Enables AI explanations, chat replies and web search. Without it, answers are data-only |
| `OPENAI_MODEL` | `gpt-5.4-mini` | Model for explanations and chat |
| `OPENAI_REASONING_EFFORT` | `low` | `none` / `minimal` / `low` / `medium` / `high` (gpt-5 and o-series models) |
| `AI_TIMEOUT_MS` | `25000` | Timeout for AI requests |
| `WEB_SEARCH_ENABLED` | `true` | Web search for other games and Dota news (extra cost per search) |
| `WEB_SEARCH_MODEL` | `OPENAI_MODEL` | Model used for web searches |
| `WEB_SEARCH_TIMEOUT_MS` | `45000` | Timeout for web searches |
| `MEMORY_MAX_TURNS` | `6` | Exchanges remembered per channel (`0` disables memory) |
| `MEMORY_TTL_MINUTES` | `30` | A channel's memory is forgotten after this long with no messages |
| `PLAYER_LINKS_FILE` | `data/player-links.json` | Where `/dota link` saves Discord → Dota account links |
| `OPENDOTA_API_KEY` | — | Optional; raises OpenDota rate limits |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |

## Development

```bash
npm run typecheck   # TypeScript checks
npm test            # unit tests (no network: fake providers and a fake AI)
```

To try commands **without connecting to Discord**, use the driver. It sends fake interactions through the bot's real handlers:

```bash
npx tsx .claude/skills/run-discord-bot-dota/driver.mjs --text cmd dota counter hero=Puck position=2
npx tsx .claude/skills/run-discord-bot-dota/driver.mjs --text message "what counters PA?"
npx tsx .claude/skills/run-discord-bot-dota/driver.mjs --text convo "Sam>mustardbot I'm Invoker mid vs Huskar" "Alex>mustardbot what about vs Lion?"
```

See [`.claude/skills/run-discord-bot-dota/SKILL.md`](.claude/skills/run-discord-bot-dota/SKILL.md) for every driver mode, expected outputs and troubleshooting.

### Project layout

```text
src/
  discord/       Discord client, slash commands, buttons/menus, embed rendering
  assistant/     Natural-language pipeline, conversation memory, AI + data orchestration
  ai/            AI provider abstraction (OpenAI), prompts and output schemas, web search
  games/
    dota/        OpenDota provider, hero knowledge, scoring, counter/matchup/draft services
    registry.ts  Game adapter registry (other games plug in here later)
  config/        Environment validation (zod)
  shared/        Logger and errors
tests/           Vitest unit tests
```

`CLAUDE.md` holds the full design and architecture guidelines.

## Limitations

- **Memory is in-process:** it's cleared when the bot restarts. Moving it to Redis is planned.
- **The hero trait table is hand-curated** and should be reviewed after big patches. Kez, Largo and Ring Master are marked low-confidence.
- **OpenDota matchup samples are small** (often under 100 games per pair). Small samples are flagged and pulled toward 50%.
- **Chat replies aren't item-validated:** item names in the detailed embeds are checked against OpenDota, but free-form chat replies aren't yet.
- **No per-user rate limiting yet.** Every AI question uses the bot owner's OpenAI key.

## Roadmap

- Persistent memory and draft sessions (Redis)
- `/dota build`, `/dota items`, `/dota player`, `/dota meta`
- STRATZ as a second data provider
- A second game adapter (e.g. League of Legends)
- Per-user rate limits
