# Changelog

All notable changes to MustardBot are listed here. Versions follow [Semantic Versioning](https://semver.org/):
MAJOR for breaking changes (renamed commands, changed `.env` settings), MINOR for new features, PATCH for fixes.

The version lives in `package.json`. Bump it with `npm version <patch|minor|major> --no-git-tag-version`.

## [Unreleased]

## [1.3.0] - 2026-09-30

### Added
- **`/dota meta [position] [rank]`**: what's strong this patch. It shows the strongest heroes (win rate adjusted for sample size, among heroes in at least 1% of games), the most picked, and the most contested in pro games, for any position and rank.
- **`/dota match [match] [account] [user]`**: match review. It defaults to your last game if you're linked, or takes a match ID or link. It compares you with other players of the same hero ("GPM better than 89% of Zeus players"), lists what went well and what to improve, and adds a short coach summary. Unparsed replays are sent to OpenDota for parsing, so laning data shows up a few minutes later.
- **`/dota live …`**: a shared draft board for the channel. Start it with `/dota live start`, then add picks and bans with `ally`, `enemy`, `ban` and `remove` as the draft happens. Buttons: **Suggest a pick**, **Undo** and **End draft**. Banned heroes are never suggested, the newest board always replaces the old one, and a draft expires 2 hours after the last change.
- **Images and draft screenshots**: attach an image when you @mention the bot or write `mustardbot`, reply to an image, or use `/ask image:`.
  - Draft screenshots: the bot reads both teams' heroes, finds your side from your name under a portrait (or asks with **We're Radiant / We're Dire** buttons), then gives pick or team advice. It always shows what it read so you can correct it.
  - Any other image: it describes the image and answers your question about it.
- Chat works for all of the above, in English or Bisaya: "what's the best pos 5 in Archon?", "how did I do last game?", "review match 9021302861", "unsa ang meta karon sa mid?", or "what should I pick?" with a draft screenshot attached.

### Changed
- While a live draft is running, chat draft questions ("they also picked Oracle, what now?") update that draft and respect its bans.

### Fixed
- The bot no longer claims it can "check the image if you resend it" when it can't see images. It now reads them, and says so honestly when nothing is attached.

### Known limitations
- Screenshot reading isn't perfect: it occasionally misreads a hero (Oracle, most often), and bans aren't read from screenshots. Add them with `/dota live ban`.
- Live drafts and chat memory are cleared when the bot restarts.
- Laning and ward details in match reviews need a parsed replay. The bot requests the parse, so check again a few minutes later.

## [1.2.0] - 2026-09-29

### Added
- `/dota player`: a player's rank, record, most played heroes, last 10 matches and **likely picks**, looked up by Friend ID, Steam ID64, an OpenDota/Dotabuff/Steam link, `me`, or a linked Discord user.
- `/dota link` / `/dota unlink`: link your own Discord account to your Dota account (saved in `data/player-links.json`). You can only link yourself.
- `/dota scout`: scout up to 5 enemy players. You get their likely picks, suggested bans, and (with a position) picks against their likely heroes, with a bonus for heroes you play well if you're linked.
- The same features work in chat: "mustardbot what does 158650393 usually play?", "what's my rank?", "scout @Leo and 86745912, what pos 4?", "unsa ganahan i-pick ni @Leo?".

### Fixed
- Bot messages can no longer ping users, roles or @everyone.

## [1.1.0] - 2026-09-29

### Added
- Chat in Bisaya/Cebuano, Tagalog or mixed Bislish/Taglish: the bot understands it and replies in the same language.
- "Forget" works in Bisaya and Tagalog ("kalimti na tanan", "kalimutan mo na") and in any other phrasing.
- Web search for everyday questions: opening hours, addresses, weather, news (e.g. "what time does Anytime Fitness Escario close?").

### Fixed
- The bot no longer claims it forgot the conversation without actually clearing its memory.
- The bot no longer says "I can't search" when web search is enabled.
- Web answers without source links now say so.
- A new lineup that names both teams no longer picks up heroes from an earlier, unrelated question.

## [1.0.0] - 2026-09-29

First stable release.

### Commands
- `/dota counter`: counter picks for a hero, with reasons, matchup stats, strategy and items. Optional position and rank filters.
- `/dota matchup`: head-to-head lane guide with the enemy's real cooldowns, popular and recommended items, and power spikes.
- `/dota draft`: team profile, gaps and strengths, the top picks for the open position, and a "Why not…?" comparison menu.
- `/dota hero`: hero overview with stats by rank bracket, plus "Explain playstyle" and "What counters X?" buttons.
- `/ask`, `/forget` and `/ping` (now shows the bot version).
- Hero autocomplete, nicknames (`storm`, `am`, `wr`…), typo tolerance, and AI guesses for hero descriptions.

### Chat
- Talk to the bot with an @mention, by starting a message with `mustardbot` (configurable), or with `/ask`.
- Replies are short and conversational, grounded in the same data as the commands, with a **Show full analysis** button.
- Shared short-term memory per channel (last 6 exchanges, 30 minutes), so follow-ups work across friends. `forget` clears it.
- Follow-ups on drafts are merged in code ("they also picked Oracle", "we swapped Lion for Lich", "why not Earthshaker?").
- Friendly replies to small talk.
- Web search, with sources, for other games and current Dota news and patch notes.

### Data and accuracy
- OpenDota provider with per-endpoint caching (hero stats, matchups, items, abilities, patch).
- Curated trait table for all 127 heroes, plus a deterministic scoring engine with explainable reasons.
- The AI explains results but never ranks or invents statistics. Unknown heroes and items are stripped from AI explanations.
- Graceful fallbacks: data-only answers when the AI fails, and labelled general advice when OpenDota is down.
- API keys are redacted from logs.
