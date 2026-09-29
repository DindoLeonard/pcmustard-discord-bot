# Changelog

All notable changes to MustardBot are listed here. Versions follow [Semantic Versioning](https://semver.org/):
MAJOR for breaking changes (renamed commands, changed `.env` settings), MINOR for new features, PATCH for fixes.

The version lives in `package.json`. Bump it with `npm version <patch|minor|major> --no-git-tag-version`.

## [Unreleased]

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
