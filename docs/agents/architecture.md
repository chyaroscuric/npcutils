# Architecture

## Process model

### Single bot

`src/index.js` decides what to run:

```js
const hasManager = Boolean(process.env.CLIENT_ID && process.env.CLIENT_SECRET);
const runSingleBot = process.env.ROLE === 'bot' || (!hasManager && process.env.DISCORD_TOKEN);
```

- Single bot: `await import('./bot.js')`.
- Manager: `await import('./manager/index.js')`.

`src/bot.js` is the only place that creates the `discord.js` `Client`. It:

1. loads `.env` (`process.loadEnvFile()`),
2. calls `db.load()`,
3. loads commands with `loadCommands()`,
4. creates the client with the intents below,
5. registers event handlers,
6. registers slash commands on `ClientReady`,
7. starts schedulers and the dashboard if `PORT` is set.

Intents used: `Guilds`, `GuildMembers`, `GuildInvites`, `GuildMessages`,
`GuildMessageReactions`, `GuildVoiceStates`, `GuildModeration`, `MessageContent`.
Partials: message, channel, reaction, user, guild member.

### BYOT manager

`src/manager/index.js`:

- Express app with Discord OAuth (`/login`, `/callback`, `/logout`).
- `src/manager/store.js` persists bot records and encrypts tokens with AES-256-GCM.
- `src/manager/bots.js` spawns `node src/bot.js` for each bot with:
  - `DISCORD_TOKEN`, `DATA_DIR=<data>/bots/<botId>`, `PORT=<free port>`,
  - `HOST=127.0.0.1`, `MANAGER_SECRET`, `DASHBOARD_URL=<base>/b/<botId>`,
  - `CLIENT_SECRET=''`, `GUILD_ID=''`, `BOT_OWNER_ID=<owner>`, `ROLE=bot`.
- The manager proxies `/b/<botId>/*` to the child dashboard. HTML responses get a
  `<base href="/b/<botId>/">` injected so the SPA's relative asset URLs work.
- The manager authenticates the user and forwards `X-Manager-Secret` and
  `X-Discord-User`; the bot dashboard trusts those headers when `MANAGER_SECRET` is set.

Each bot process has its own database file, logs (`bot.log`), dictionary cache and
binary cache. There is no shared feature state between bots.

## Event flow

```
Discord gateway
  -> client.on(Events.*)
    -> feature function (safe wrapper logs errors)
      -> db.guild(guildId) mutation + db.save()
      -> optional channel.send() / member.roles.* / interaction reply
```

Important handlers in `src/bot.js`:

| Event | Work |
| --- | --- |
| `ClientReady` | fetch application, apply presence, register commands, prepare guilds, start giveaways/levels/birthdays/social alerts/music/games |
| `GuildCreate` | fetch members, cache invites, schedule stats update |
| `GuildMemberAdd` | invites, autoroles, welcome message, activity log, stats |
| `GuildMemberRemove` | invite leave counting, activity log, stats |
| `GuildMemberUpdate` | boost detection, boost message, stats |
| `MessageCreate` | antilink, antinuke, counting, levels, games |
| `MessageDelete` | reaction-role and giveaway cleanup |
| `VoiceStateUpdate` | levels voice tracking, music voice handling |
| `MessageReactionAdd/Remove` | reaction roles |
| `InteractionCreate` | slash commands and component handlers |

The `safe(label, fn)` wrapper catches and logs errors so one bad event cannot crash the
process. `process.on('uncaughtException')` flushes and exits so Docker/pm2 can restart.

## Interaction routing

`loadCommands()` imports every `src/commands/*.js` sorted by filename. A module exports
either:

```js
export const data = new SlashCommandBuilder()...;
export async function execute(interaction) { ... }
```

or:

```js
export const commands = [{ data, execute, deferEphemeral }, ...];
```

`InteractionCreate`:

- `isChatInputCommand()` → find by name, optionally `deferEphemeral`, call `execute`.
- `isButton()` / `isModalSubmit()` → split `customId` on `:` and call
  `componentHandlers[prefix]`.
- `UserError` → ephemeral error reply. Any other error → generic error reply and log.

Component handler prefixes currently registered: `ticket`, `giveaway`, `music`, `flag`,
`wordle`, `clone`. Add a new prefix in the `componentHandlers` object in `src/bot.js`.

## Schedulers

| Scheduler | Interval | State that prevents duplicates |
| --- | --- | --- |
| stats channels | 5 min per channel, 10 min safety sweep | `lastRename` map in memory; channel names themselves |
| levels voice flush | 5 min | in-memory sessions, persisted voiceMs |
| giveaways | per-giveaway timeout + startup restore | `ended`, `endsAt`, `winnerIds` |
| birthdays | 15 min + 20 s kickoff | `entry.lastCelebrated` year |
| social alerts | `SOCIAL_POLL_MINUTES` (default 5) + 15 s kickoff | `account.state.lastCheckedAt`, `lastVideoId`, `videoCount`, `live` |

All intervals call `.unref?.()` so they do not keep the process alive by themselves.

## Data flow

- `db.load()` reads `<DATA_DIR>/db.json` (default `data/db.json`).
- `db.guild(id)` creates `{ config, invites, joins, tickets, reactionRoles, giveaways }`
  defaults lazily. Features add their own keys.
- `db.save()` schedules a flush in 1 second. `db.flush()` writes a temp file and renames
  it atomically.
- There is no schema migration framework. Normalizers (`normalizeStatsConfig`,
  `normalizeConfig`, `normalizeBanner`, etc.) accept old shapes and fill defaults. Follow
  that pattern when changing a stored shape.

## External services

| Service | Used by | Notes |
| --- | --- | --- |
| YouTube public pages/RSS | `/stats`, stats channels, social alerts | no API key; may be blocked on hosting IPs |
| DecAPI (`decapi.me`) | Twitch stats and social alerts | uptime, title, game, avatar, follower count |
| TikTok public profile | `/stats`, stats channels, social alerts | HTML contains `__UNIVERSAL_DATA_FOR_REHYDRATION__` |
| yt-dlp / ffmpeg | music | downloaded into `data/bin` if not present |
| Croatian hunspell dictionaries | wordle/kaladont | downloaded into `data/dict` |
| Discord CDN | avatars, banners, images | fetched by canvas renderers |

There are no paid API keys or OAuth scopes beyond `identify` for the dashboard login.
