---
name: run-discord-bot-dota
description: Build, run, test, and drive the Dota 2 Discord bot. Use when asked to start the bot, run a slash command (/ping, /dota hero|counter|matchup|draft, /ask) and see its reply or embed, click a button or select menu, send an @mention question, test hero autocomplete, check a command or AI change works, register commands, log in to Discord, or run the test suite.
---

A discord.js v14 + TypeScript bot that combines OpenDota stats, curated hero traits, a deterministic scoring engine and OpenAI explanations. Drive it with **`.claude/skills/run-discord-bot-dota/driver.mjs`**. The driver sends fake interactions and messages through the bot's real handlers (`handleInteraction` / `handleMessage` in `src/discord/client.ts`), so it exercises commands, buttons, menus, @mentions and error handling exactly as production does. No Discord connection is needed.

All paths are relative to the repo root. The commands were verified in Git Bash on Windows 11 with Node 24.18 and npm 11.16.

## Prerequisites

- Node >= 20 (verified on v24.18.0).
- Outbound HTTPS to `api.opendota.com` (free tier: 60 requests/min, about 3,000/day), and to `api.openai.com` for AI features.

## Setup

```bash
npm install
```

Ignore the npm 11 `allow-scripts ... esbuild@... (postinstall)` warning. tsx works without approving that script.

Env is loaded from `.env` via dotenv (copy `.env.example`):

```bash
DISCORD_TOKEN=...            # required for npm run dev/start/register and driver `live`
DISCORD_CLIENT_ID=...        # required for the same
DISCORD_GUILD_ID=...         # optional: register to one guild (instant) instead of globally
BOT_TRIGGER_NAMES=mustardbot # default; messages starting with a name get an AI reply. Empty = @mentions only
MEMORY_MAX_TURNS=6           # default; shared per-channel memory. 0 disables it. MEMORY_TTL_MINUTES=30
WEB_SEARCH_ENABLED=true      # default; other games + Dota news use OpenAI web_search (extra cost). WEB_SEARCH_MODEL, WEB_SEARCH_TIMEOUT_MS=45000
OPENAI_API_KEY=...           # optional: AI explanations, /ask, @mentions, AI hero-name guessing
OPENAI_MODEL=gpt-5.4-mini    # default; OPENAI_REASONING_EFFORT=low, AI_TIMEOUT_MS=25000
LOG_LEVEL=warn               # optional: hides info logs (default info)
OPENDOTA_BASE_URL=...        # optional: point at a dead URL to test the provider-down path
```

Real environment variables override `.env` (dotenv never overwrites them). That's how you flip AI off or break it for one run: `OPENAI_API_KEY= ...` or `OPENAI_API_KEY=sk-bad ...`.

## Run (agent path): the driver

Add `--text` for readable output (embeds flattened, with component custom IDs listed). Leave it off to get JSON.

```bash
D=.claude/skills/run-discord-bot-dota/driver.mjs
LOG_LEVEL=warn npx tsx $D --text cmd dota counter hero=Puck position=2
LOG_LEVEL=warn npx tsx $D --text cmd dota matchup my_hero=Invoker enemy_hero=Huskar position=2
LOG_LEVEL=warn npx tsx $D --text cmd dota draft position=5 ally1=Axe ally2=Invoker ally3="Drow Ranger" ally4=Lion enemy1=storm enemy2=Lifestealer enemy3=Mirana enemy4=Underlord enemy5=Oracle
LOG_LEVEL=warn npx tsx $D --text component draft:whynot:5:0:2.74.6.26:17.54.9.108.111 31
LOG_LEVEL=warn npx tsx $D --text cmd dota hero hero=Puck
LOG_LEVEL=warn npx tsx $D --text component hero:explain:13
LOG_LEVEL=warn npx tsx $D --text cmd ask "question=what counters PA"
LOG_LEVEL=warn npx tsx $D --text message "I'm Invoker mid against Huskar. What should I do?"
LOG_LEVEL=warn npx tsx $D --text say "mustardbot what counters PA?"
LOG_LEVEL=warn npx tsx $D --text convo "Dindo>mustardbot I'm Invoker mid vs Huskar, how do I lane?" "Sam>mustardbot what about vs Lion?" "lol nice" "Alex>mustardbot what counters him?"
LOG_LEVEL=warn npx tsx $D --text cmd forget

# Players, links and scouting. Point links at a scratch file so driver runs never touch data/player-links.json.
export PLAYER_LINKS_FILE="$TEMP/driver-links.json"
LOG_LEVEL=warn npx tsx $D --text cmd dota player account=158650393
DRIVER_USER_ID=777 npx tsx $D --text cmd dota link account=158650393
DRIVER_USER_ID=555 npx tsx $D --text cmd dota scout enemy1=@777 enemy2=86745912 position=4
LOG_LEVEL=warn npx tsx $D --text convo "Leo#888>mustardbot what does 158650393 usually play?" "Yel#666>mustardbot unsa man ganahan i-pick ni @777?"
LOG_LEVEL=warn npx tsx $D autocomplete dota hero hero Inv
npx tsx $D list
npx tsx $D live
```

| mode | what it does |
|---|---|
| `cmd <command> [sub] [opt=value...]` | Runs a chat-input command. Options are strings; integer options (`position`, `rank`) are parsed. Output: `deferReply` followed by `editReply` (or `deleteReply` + ephemeral `followUp` on error). |
| `component <customId> [value...]` | Clicks a button (no value) or picks from a select menu (value = option value). Copy the custom ID from a previous reply's `[component ...] customId=` line. |
| `message "<text>"` | An @mention of the bot. Intent parsing, then the same analysis as the slash commands, then **one conversational AI reply** grounded in that data (`messageReply` with `content`, no embeds) plus a `Show full analysis` button (`full:*` custom ID, or `hero:explain:<id>`). Click the button with `component <customId>`. |
| `convo "Author>text" ...` | Several plain messages in **one process**, posted into the same fake channel, so the shared memory carries over between them. Text must start with a trigger name, or the bot ignores it like real chat. `--text` prints each turn and then the channel memory. This is the only mode that can test follow-ups: separate driver runs are separate processes, and memory lives in-process. |
| user options | `user=<discordId>` for `/dota player user:`. `DRIVER_USER_ID=<id>` sets who runs `cmd`/`component` (for `/dota link`, `me` and comfort picks). In `convo`, write `Name#<id>>text` to give a speaker a Discord ID. Write mentions as `@777`; the driver converts them to Discord's `<@777>`. |
| `say "<text>"` | A plain message with no mention. It replies only if the text starts with a `BOT_TRIGGER_NAMES` name. When the bot ignores the message, there are no responses and the exit code is 1. |
| `autocomplete <command> [sub] <option> [text]` | Focuses `option` with `text` and prints the choices (`name=value`, where the value is the hero id). |
| `list` | The slash-command JSON that `npm run register` sends. |
| `live` | Logs in with the `.env` credentials, prints `{ok, user, guilds}`, then disconnects. Returns `{skipped:true}` with no token and `{ok:false, code:"TokenInvalid"}` for a bad one. |

Exit codes: 0 means the handler replied (including error replies); 1 means no reply, a crash, or `live` failed; 2 means a usage error.

**Timing:** AI commands take about 5–12s (the OpenAI call dominates), and data-only runs about 2–3s. The provider cache is in-memory, so each driver run refetches from OpenDota.

### Verified behaviour to compare against

- **counter** `hero=Puck position=2`: the embed "Countering Puck — Mid (pos 2)" shows Magnus, Lone Druid, Leshrac, Primal Beast and Meepo. Each has an AI "why" that names real abilities (Phase Shift, Illusory Orb…) and a stat line like `61.4% vs Puck · 44 games`. Small samples say `· small sample`. It also shows "General strategy", "Useful items" (validated against OpenDota's item list) and "Also consider".
- **matchup** Invoker vs Huskar: the head-to-head is `42.4% for Invoker over 33 games`, with an AI lane-difficulty label, threats, power spikes, lane plan, Huskar cooldowns from OpenDota (`Inner Fire: 17/15/13/11s`), and popular plus recommended items.
- **draft** (the `CLAUDE.md` example): "Your team needs" lists Detection (Mirana), Save, Anti-heal and Dispel. The recommended picks are Dazzle, Omniknight and Shadow Demon, each with a tradeoff. The reply includes a **select menu** `draft:whynot:...` for ranks 2–10.
- **component** `draft:whynot:... 31`: an ephemeral "Why not Lich? (ranked #5)" with a side-by-side score table.
- **hero** Puck: the embed has two buttons, `hero:explain:13` and `hero:counters:13`. Both reply ephemerally.
- **ask / message / say / convo** (chat replies): "what counters PA" gives a short friendly reply leading with the #1 counter and a `full:counter:44:0` button. "I'm Invoker mid vs Huskar" gives a lane-advice reply with `full:matchup:74:59:2`. "i accidentaly picked am pos 5, what should my team mates do…" gives team-adjustment advice (a team analysis of Anti-Mage only, `full:teams:1:`), not a pick list. A general strategy question gets a reply with no button. Small talk ("testing, hey how are you?", "thanks!", "gg") gets a one- or two-line friendly reply (intent `small_talk`), and off-topic questions ("what's the weather") get a light deflection. Other games ("do you know valheim? good armor for swamp?", "what about the mountains?") and Dota news ("what changed in the latest dota patch?" found 7.41f on dota2.com) are answered by **web search**. The reply ends with `-# Sources: [title](<url>) · …` (at most 3 links, `<url>` suppresses previews, `utm_*` params stripped) and has no button. The log line `"msg":"web search"` shows the queries and source hosts. With `WEB_SEARCH_ENABLED=false`, or when the search fails, the reply ends with `-# I couldn't search the web for this…` instead. Earlier versions replied "That game isn't supported yet"; that path no longer exists, and a pick question with no position gets asked for one. Clicking any `full:*` button returns the ephemeral embed the matching slash command would produce.
- **Memory (convo)**: after the Invoker vs Huskar question, Sam's "what about vs Lion?" gets Invoker vs Lion (Mid). Alex's "what counters him?" gets counters to Lion, and "lol nice" is ignored and not stored. For drafts: "we have Axe and Lion, they have Storm and Lifestealer. what should I pick?" gets "Which position…?". "pos 4" then gives `full:draft:4:0:2.26:17.54`, and "they also picked Oracle" re-scores to `full:draft:4:0:2.26:17.54.111`. "why not Earthshaker?" gives `full:whynot:…:7`, "we swapped Lion for Lich…" gives `full:draft:4:0:2.31:…`, and "new game. i picked am pos 5…" gives `full:teams:1:` (the old lineup is dropped). "forget" gets "Okay, I've forgotten this channel's conversation (N messages)." with no AI call.
- **AI typo help**: `hero="the fat guy with the hook"` gives "Did you mean: Pudge (AI guess)", and `hero=invkr` gives "Invoker (AI guess), Tinker, Puck".
- **Validation**: `ally1=Axe enemy1=Axe` gives "cannot appear on both teams", `ally1=Axe ally2=axe` gives "listed twice", and matchup Puck vs puck gives "Pick two different heroes". All are ephemeral.
- **Fallbacks**: with `OPENAI_API_KEY=` the embeds are data-only and the footer says "AI explanations are off", and `/ask` explains that it needs an AI provider. With `OPENAI_API_KEY=sk-bad` the stats still show and the footer says "AI explanation unavailable right now". With `OPENDOTA_BASE_URL=http://127.0.0.1:9/api`, commands reply "Current matchup statistics are temporarily unavailable…" and autocomplete returns no choices. For chat questions with OpenDota down, the bot answers from general knowledge and appends `-# Live Dota stats are unavailable right now…`. If only the chat reply fails, it shows the data-only embed with the footer "Couldn't write a reply right now".

## Direct invocation (no Discord layer)

Services are plain classes. For scoring or knowledge changes, call them directly from a scratch script at the repo root (delete it afterwards):

```bash
cat > smoke.ts <<'EOF'
import { dota } from "./src/games/registry.js";
const d = await dota.drafts.analyze({ allies: ["Axe", "Lion"], enemies: ["Storm Spirit"], position: 5 });
for (const c of d.candidates.slice(0, 5)) console.log(c.score, c.hero.localizedName, JSON.stringify(c.components));
EOF
LOG_LEVEL=warn npx tsx smoke.ts; rm smoke.ts
```

`assistant` / `askService` (in `src/assistant/index.ts`) add the AI layer on top: `assistant.counter("Puck", { position: 2 })` returns `{ analysis, explanation, aiNote, patch }`.

## Run (human path)

```bash
npm run register   # push slash commands. Re-run after changing any command's options.
npm run dev        # tsx src/index.ts: logs "discord ready ... ai: openai/gpt-5.4-mini"; runs until Ctrl-C
npm run build && npm start   # compiled dist/ equivalent
```

Without a token, `npm run dev` and `npm start` exit 1 with `startup failed ... DISCORD_TOKEN is required`.

## Test

```bash
npm run typecheck
npm test
```

Expect 11 files and 142 tests. They cover player lookup, scouting and account links (`tests/player.test.ts`), scoring, team profiles, draft validation and ranking, knowledge-table integrity, OpenAI strict-schema shape, provider parsing, the assistant's hallucination guards (unknown heroes and items dropped), fallbacks, intent planning (including deterministic draft merging and the no-leak guarantee), chat replies, conversation memory and custom IDs. Everything uses fake providers and a fake AI, with no network.

After a Dota patch, check that the curated trait table still covers every hero. It should print `missing: []`:

```bash
cat > check.ts <<'EOF'
import { HERO_KNOWLEDGE } from "./src/games/dota/knowledge/heroTraits.js";
const names: string[] = (await (await fetch("https://api.opendota.com/api/heroStats")).json()).map((h: { localized_name: string }) => h.localized_name);
console.log("missing:", names.filter((n) => !(n in HERO_KNOWLEDGE)));
EOF
npx tsx check.ts; rm check.ts
```

## Adding a command so the driver sees it

Register it in `src/discord/commands/index.ts`. For a `/dota` subcommand, add it to `subcommands` and `.addSubcommand(...)` in `src/discord/commands/dota/index.ts`. For buttons or menus, add a handler keyed by `scope:action` in `src/discord/components/handlers.ts` and an encoder in `customIds.ts`. The driver needs no changes unless the new code calls an interaction method it doesn't stub yet (`showModal`, `update`, ...). In that case, add it to `makeInteraction()`.

## Gotchas

- **Defer first in anything that calls the AI.** Discord requires an acknowledgement within 3s, and AI calls take 5–12s. Every command and component handler starts with `deferReply()`. On error, `replyWithError` deletes the public "thinking…" placeholder and sends the error as an ephemeral follow-up.
- **The AI never sees a bare question.** The scoring engine ranks candidates, and the prompt gets the numbers, traits and the real ability list from OpenDota. The assistant then drops any hero the AI mentions that isn't a candidate, and any item not in `/constants/items`. When you change a prompt, keep those guards in place.
- **OpenAI's 401 error message echoes part of the API key.** `redactKeys()` in `openai.provider.ts` strips `sk-...` before anything is logged. Keep it on every provider error path.
- **zod 4's `z.toJSONSchema` is almost strict-mode compatible.** Remove `$schema` and it's accepted. Use `.nullable()`, never `.optional()`, in AI schemas, because strict mode requires every key. `tests/ai.test.ts` enforces this.
- **Descriptive hero queries.** Edit-distance suggestions help with typos but are noise for "the fat guy with the hook", so they're dropped once the AI has a guess for queries of 3+ words or more than 16 characters. The bot never silently swaps in the guessed hero; the user re-runs the command.
- **Small OpenDota matchup samples** (median about 85 games per pair). Win rates are pulled toward 50% with 50 pseudo-games (`PRIOR_GAMES`) before scoring, and anything under 30 games is flagged as a small sample.
- **Custom IDs carry state.** The draft menu encodes position, rank and hero ids (`draft:whynot:5:0:2.74.6.26:17.54.9.108.111`), so old menus still work after a restart. Lookup uses `Object.hasOwn`, so `constructor:x` can't reach `Object.prototype`.
- **@mentions need only the `GuildMessages` intent**, because Discord includes message content when the bot is mentioned. **Plain-name triggers** (`BOT_TRIGGER_NAMES`) need the privileged **MessageContent** intent. `createClient()` requests it only when triggers are configured. If the intent isn't enabled in the Developer Portal, Discord rejects the entire login ("disallowed intents"), and `src/index.ts` logs a hint explaining how to fix it.
- **The trigger must be at the start and a whole word.** "mustardbot, what counters PA?" and "hey mustardbot …" reply. "I love mustardbot" and "mustardbots" don't. This keeps accidental replies (and OpenAI cost) down. `extractQuestion()` holds the logic and `tests/message.test.ts` covers it.
- **Memory is shared per channel, not per user**, which is what the owner asked for. The key is `guildId:channelId`, and each turn records the author's display name so the AI knows who said what. Only messages addressed to the bot (mentions, trigger names, `/ask`) are stored, never ordinary chat. It lives in `src/assistant/memory.ts` and is in-process only, so a restart wipes it. Redis is the planned next step (see `CLAUDE.md` draft sessions).
- **What gets stored is a one-line summary plus structured context** (`hero`, `enemy`, `position`, `allies`, `enemies`), never the full AI text. That keeps prompts small and means follow-ups reuse *resolved* hero names. `summarize()` / `contextOf()` in `ask.service.ts` produce it deterministically, with no AI call.
- **`forget` is matched by regex before any AI call**, so it's free and instant. It matches only whole-message phrases ("forget", "reset", "clear the conversation", "please forget that"). "I always forget to buy wards" is a normal question.
- **Chat replies are one AI call.** `/ask`, @mentions and trigger names parse the intent, run the deterministic analysis (`assistant.ground()`), and then make a single `chat.reply` call grounded in the same context text the embeds use. They do *not* also make the `*.explain` call. That only happens when someone clicks **Show full analysis**. Slash commands (`/dota …`) still reply with embeds.
- **Draft lineups are merged in code, never by the AI.** The intent parser returns only the heroes named in the *new* message, plus `removed` and `continuesDraft`. `AskService.mergeLineup()` does "previous − removed + new", deduped by resolved hero. Before this, the AI copied heroes from unrelated earlier turns into a new draft (a real bug: Invoker and PA showed up as enemies in an Anti-Mage question). `tests/ask.test.ts` guards this.
- **Two meanings of "position".** For `pick_recommendation` / `why_not_pick` it's the slot still to fill. For `draft_analysis` ("I picked AM pos 5, how should my team adjust?") it's where the player *plays*, so it becomes a team analysis, not a pick list. A `draft_analysis` that continues an earlier *pick* ("they also picked Oracle") re-scores that pick instead. Only `draft`/`message` turns carry a pick slot; `teams` turns never do.
- **Web search must be forced.** With `tools: [{type: "web_search"}]` alone, gpt-5.4-mini often answers from memory without searching (no `web_search_call`, no citations). `searchWeb()` sends `tool_choice: "required"`, and bumps `reasoning.effort` to at least `low` because search doesn't run at `none`. It uses the **Responses API** (`/v1/responses`), not Chat Completions. Citations arrive as `url_citation` annotations *and* inline `([site](url))` text; `stripInlineCitations()` removes the inline ones and the sources are rendered separately.
- **Web results never supply Dota stats.** The web prompt forbids hero win, pick and ban rates (CLAUDE.md data rule). "What counters PA?" still goes to OpenDota and the scoring engine, not the web.
- **Never type `<` in driver arguments on this machine.** `node` and `npx` run through a `cmd.exe` wrapper, which treats `<` as redirection even inside quotes. The failure looks like `The system cannot find the file specified.` or `The syntax of the command is incorrect.` from Bash *and* PowerShell. Use `@777`; the driver rewrites it to `<@777>`. Multi-line `node -e "…"` scripts get mangled the same way, so write a file instead.
- **Player lookups.** OpenDota returns HTTP 404 *or* an empty 200 shell for unknown accounts, and both become `PlayerNotFoundError`. Private profiles resolve but have no heroes or matches ("Expose Public Match Data"). Wins come from `player_slot < 128` (Radiant) compared with `radiant_win`. Rank tier 45 is **Archon 5** (tens digit = medal: 1 Herald … 8 Immortal).
- **Scouting is fault-tolerant.** An unlinked @mention, a bad ID or a private profile becomes a "Couldn't scout" row, and the other players still get analysed. Parser quirk: "unsa ganahan i-pick ni @Leo?" can come back as a *draft* intent because of the word "pick". `plan()` reroutes a draft intent that names players but no heroes to `player_lookup` or `scout_players`.
- **No pings.** The client sets `allowedMentions: { parse: [] }`. Before that, an AI reply containing `<@777>` would have pinged that user.
- **Languages.** Bisaya/Cebuano and Bislish work end to end: `convo "Yel>mustardbot kumusta ka?"` gets "Okay ra ko…". Testing in Bisaya found two bugs:
  - "kalimti na tanan" got an AI reply *claiming* it forgot while the memory stayed intact. The `FORGET` regex now covers Bisaya and Tagalog, and the `forget_memory` intent clears memory for any other phrasing.
  - The parser set `continuesDraft` on a message that named both teams, which leaked an earlier Anti-Mage into the draft. `mergeLineup` now ignores the old lineup whenever both teams are named.
- **Chat replies aren't item-validated.** The embeds drop item names that aren't in OpenDota's list, but free-form chat text isn't checked, and the model occasionally names removed items (seen: "Orb of Venom").
- **Adding an `AskResult` kind**: `summarize`, `contextOf` and `renderAsk` are exhaustive switches, so the typechecker points at every place you need to handle it.
- **Regex in template literals:** `\s` inside a `` `...` `` string becomes a plain `s`. Write `\\s` when building a `new RegExp(`...`)`. (Doing it wrong left stray spaces where mentions were removed.)
- **Never `process.exit()` right after a `fetch` on Windows.** Undici's sockets are still closing and Node aborts with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c`. Set `process.exitCode` instead.
- **The ready event is `clientReady`, not `ready`** (discord.js 14.27).
- **The driver imports TS sources directly**, so it must run under `npx tsx`. Plain `node` fails with `ERR_MODULE_NOT_FOUND`. Run it from the repo root, because dotenv reads `.env` from the cwd.
- **The Git Bash tool can choke on long multi-file heredocs** (`unexpected EOF while looking for matching '`). Write files with the editor tool instead.

## Troubleshooting

- **`Invalid environment configuration: - DISCORD_TOKEN: DISCORD_TOKEN is required`**: no `.env`, or an empty value. Fill it in, or use the driver's `cmd`/`component`/`message` modes, which don't need Discord.
- **`{"mode":"live","ok":false,"code":"TokenInvalid"}`**: the token is wrong or was reset. Regenerate it under Developer Portal → Bot → Reset Token.
- **Footer says "AI explanation unavailable right now"**: check the `ai request failed` warn log. `HTTP 401` means a bad key, `timed out after 25000ms` means raise `AI_TIMEOUT_MS`, and `response truncated` means raise `maxOutputTokens` in the prompt builder.
- **"Current matchup statistics are temporarily unavailable"**: OpenDota is unreachable or rate-limited (HTTP 429). Check `curl -sI https://api.opendota.com/api/heroStats`. `OPENDOTA_API_KEY` raises the limits.
- **New options don't show up in Discord**: re-run `npm run register`. Guild registration is instant, global can take up to an hour.
