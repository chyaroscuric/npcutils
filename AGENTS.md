# AGENTS.md

This file is the entry point for AI agents and new contributors working on **npcutils**.
Read it before changing code. The detailed guides live in `docs/agents/`.

## What this project is

A Discord bot written in modern ESM JavaScript (`node >= 20.12`, no build step) with a
server-rendered Express dashboard. It ships in two modes:

- **Single bot** (`npm run start:bot`, or `ROLE=bot`): `src/bot.js` logs in with
  `DISCORD_TOKEN`.
- **BYOT manager** (`npm start`, `src/index.js`): `src/manager/` runs a Discord OAuth
  login and one isolated child bot process per token. Each bot gets its own `DATA_DIR`,
  its own dashboard port and a proxy under `/b/<botId>/`.

The UI and all user-facing text are in Croatian. Code, comments and docs are in English
except when quoting UI text.

## First commands

```bash
npm install
cp .env.example .env        # Windows: copy .env.example .env
npm run check               # loads every command and validates Discord builders
npm test                    # node:test, no network required
npm run start:bot           # single bot (needs DISCORD_TOKEN)
npm start                   # BYOT manager (needs CLIENT_ID + CLIENT_SECRET)
```

`npm test` must stay offline and deterministic. Never add tests that call YouTube,
TikTok, Twitch, Discord or any other network service.

## Repository map

```
src/
  index.js                 entry point: manager or single bot
  bot.js                   client setup, events, interaction routing, scheduler startup
  db.js                    JSON store in <DATA_DIR>/db.json (debounced atomic writes)
  loadCommands.js          loads src/commands/*.js into a Map
  commands/                slash commands (one module or a `commands` array)
  features/                business logic, one module per feature
    games/                 chat games (flags, wordle, kaladont, toplo-hladno, mafia, fishing, ship)
    ...
  data/                    static datasets (countries, words, semantic groups)
  dashboard/
    server.js              Express API, Discord OAuth, static dashboard
    public/app.js          single-page dashboard (hash router, pages, forms, actions)
    public/app.css         design tokens and components
  manager/                 BYOT manager (OAuth, bot registry, child processes, proxy)
  utils/                   helpers, duration parsing, zip
test/                      node:test files; `load-commands.js` is npm run check
docs/agents/               detailed agent documentation
design.md                  mandatory dashboard design system
```

## Non-negotiable conventions

1. **Data lives in the guild object.** Use `db.guild(guildId)` and store feature state
   under a named key (`g.config.<feature>`, `g.<feature>`, etc.). Call `db.save()` after
   mutations. `db.flush()` is called on shutdown.
2. **Feature modules do not import the Discord client.** They receive a `guild`,
   `member`, `channel` or `client` argument. This keeps them testable with plain objects.
3. **Commands are thin.** Validate Discord options, call a feature, reply. Put reusable
   logic in `src/features/`.
4. **Never crash the bot.** Event handlers are wrapped with `safe()` in `bot.js`; feature
   loops catch per-guild and per-account errors and log them.
5. **Croatian UI, English code.** Keep user-facing strings in Croatian and sentence case.
   Use `UserError` for messages that can be shown to users as-is.
6. **Dashboard changes follow `design.md`.** Use the existing tokens, components, page
   patterns, `field()`, `selectField()`, `run()`, `toast()`, `confirmAction()` and
   `pageHead()`. Do not invent new colours or components.
7. **No browser automation.** Do not install or download Chromium/Playwright/Puppeteer.
   Image generation uses `@napi-rs/canvas`; network lookups use `fetch`.
8. **No new runtime dependencies without a strong reason.** Prefer Node built-ins and
   packages already in `package.json`.
9. **Keep the design system dark-only.** The dashboard has no light theme.
10. **Schedulers must be idempotent.** Persist enough state (last checked id, last
    celebrated year, live/offline flag) so a restart does not duplicate messages.

## How to add a feature (short version)

1. Create `src/features/<name>.js` with pure helpers exported for tests, plus
   `start(client)` / `stop()` if it needs a timer.
2. Add defaults under `db.guild(guildId).config.<name>` and normalize input on read.
3. Wire timers/events in `src/bot.js` (`ClientReady`, `MessageCreate`, etc.) and stop
   them in `shutdown()`.
4. Add a command in `src/commands/<name>.js` if users need it, and list it in
   `src/commands/help.js`.
5. Add API routes in `src/dashboard/server.js` and a page in
   `src/dashboard/public/app.js` (`NAV`, `PAGES`, page function, forms/actions).
6. Add tests under `test/`; run `npm test` and `npm run check`.
7. Update `README.md` and the relevant `docs/agents/` page.

## Detailed guides

- [Architecture](docs/agents/architecture.md) — process model, events, interaction flow,
  schedulers, data flow.
- [Data model](docs/agents/data-model.md) — the guild object, config keys, state fields,
  migration rules.
- [Features](docs/agents/features.md) — every feature module and what it owns.
- [Commands](docs/agents/commands.md) — command conventions, permissions, option naming.
- [Dashboard](docs/agents/dashboard.md) — API routes, auth, SPA page pattern, design
  system, forms and actions.
- [Testing](docs/agents/testing.md) — test harness, fixtures, what to test, offline rules.
- [Operations](docs/agents/operations.md) — Docker, pm2, BYOT, data directory, backups,
  rate limits and privacy.
- [Recipes](docs/agents/recipes.md) — copy-paste recipes for common changes.

## Known gotchas

- Discord allows only **2 channel renames per 10 minutes**. `features/stats.js` throttles
  to ~5 minutes per channel.
- Message Content, Server Members and Presence intents must be enabled in the Developer
  Portal; otherwise welcome, levels, antilink, counting and transcripts break.
- `MANAGER_SECRET` mode changes dashboard auth: the manager forwards
  `X-Manager-Secret` and `X-Discord-User`; the bot's own OAuth session is not used.
- The dashboard writes require the `X-Dashboard: 1` header (the SPA's `api()` helper adds
  it). Do not remove this check.
- `src/features/games/dictionary.js` downloads Croatian dictionaries into
  `<DATA_DIR>/dict` on first use. If the download fails, games accept any word.
- Social notifications poll public pages. They are best-effort: YouTube uses RSS and the
  `/live` page, Twitch uses DecAPI, TikTok reads the public profile page. The first check
  is only a baseline and never sends a notification.
- Welcome and goodbye banners render with `@napi-rs/canvas`. If the background or avatar
  cannot be fetched, the bot falls back to the normal embed.
- Birthday dates use `Europe/Zagreb` by default (`BOT_TIMEZONE` overrides it). Feb 29 is
  celebrated on Feb 28 in non-leap years.
- The "toplo-hladno" similarity is offline: semantic groups in `src/data/semantic.js`
  plus edit distance. It is not a neural embedding.
- Mafia game state is in memory. A bot restart cancels a running game; only
  `g.mafiaScores` is persisted. Fishing inventory/XP/coins are persisted in
  `g.fishing.users`.
