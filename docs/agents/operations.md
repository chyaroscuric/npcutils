# Operations

## Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `DISCORD_TOKEN` | single bot / env import | bot token |
| `CLIENT_ID` | manager | OAuth application ID |
| `CLIENT_SECRET` | manager | OAuth client secret |
| `DASHBOARD_URL` | manager | public panel URL, used for OAuth redirect and links |
| `BOT_OWNER_ID` | env import | Discord ID that owns the imported bot |
| `PORT` | dashboard | HTTP port (default 3000) |
| `HOST` | optional | bind address (manager sets `127.0.0.1` for child bots) |
| `DATA_DIR` | optional | data root (default `./data`) |
| `GUILD_ID` | optional | register commands on one guild immediately |
| `TOKEN_ENCRYPTION_KEY` | optional | manager token encryption key |
| `BOT_PORT_START` | optional | first internal port for BYOT child bots (default 4100) |
| `MANAGER_SECRET` | manager | generated at manager startup; used for proxy auth |
| `FFMPEG_PATH`, `YTDLP_PATH` | optional | custom music binaries |
| `SOCIAL_POLL_MINUTES` | optional | social alert poll interval (default 5, min 2) |
| `FREE_GAMES_POLL_HOURS` | optional | free game poll interval (default 6, min 1) |
| `BOT_TIMEZONE` | optional | birthday timezone (default `Europe/Zagreb`) |

Copy `.env.example` to `.env`. Never commit `.env`.

## Single bot

```bash
npm install
npm run start:bot
```

Requires the three privileged intents in the Discord Developer Portal:

- Presence Intent
- Server Members Intent
- Message Content Intent

Invite URL:

```
https://discord.com/oauth2/authorize?client_id=CLIENT_ID&permissions=8&scope=bot%20applications.commands
```

Move the bot role above any role it must assign (autoroles, reaction roles, birthday
role). The bot needs Administrator for clone, anti-nuke and most moderation features.

## BYOT manager

```bash
npm start
```

- Manager OAuth app needs `CLIENT_ID`, `CLIENT_SECRET`, and
  `<DASHBOARD_URL>/callback` as a redirect.
- Each bot is a child process with its own `DATA_DIR`, port and logs.
- The manager stores encrypted tokens in `data/manager/`; the key is
  `TOKEN_ENCRYPTION_KEY` or `data/manager/key`.
- Panel URL: `https://your-domain/b/<botId>/`.
- Child bots bind to `127.0.0.1`; only the manager is public.

## Docker

```bash
docker compose up -d --build
```

Keep the `data/` volume. Without it, settings, invites, levels, birthdays, social state
and tickets are lost on recreate.

## pm2

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## Data and backups

`DATA_DIR` contains:

```
db.json                 all guild/bot state
manager/                BYOT registry + encryption key
bots/<botId>/           per-bot db.json, bot.log
dict/                   downloaded Croatian dictionaries
bin/                    downloaded yt-dlp/ffmpeg
```

Back up the whole `DATA_DIR`. `db.json` is written atomically (temp file + rename), so a
copy while the bot is running is usually safe, but stopping the bot first is safest.

## Rate limits and throttling

- Discord channel rename: 2 per 10 minutes. Stats channels throttle to ~5 minutes.
- Discord message sends: social alerts and birthdays send at most one message per event;
  they are not bulk senders.
- YouTube/TikTok/Twitch polling: default every 5 minutes per account. Each YouTube account
  causes one RSS fetch and one large `/live` page fetch; keep the account count modest.
- DecAPI is a free third-party service; do not increase polling aggressively.

## Privacy

- The bot stores Discord user IDs, invite counts, levels, birthdays (day/month/year),
  warnings and social account handles.
- Message content is processed for antilink, counting, levels and games but not stored
  except ticket transcripts (sent to the configured log channel) and giveaway entries.
- Bot tokens in BYOT mode are encrypted at rest.
- Dashboard sessions are in memory and expire after 7 days; restarting the manager logs
  everyone out.
- Provide a way for server owners to delete data: removing the bot and deleting
  `DATA_DIR/bots/<botId>` or the guild entry in `db.json`.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| Slash commands missing | `GUILD_ID` wrong, bot not invited with `applications.commands`, or registration failed (check logs) |
| Welcome/autorole not working | Server Members intent off, bot role too low, or channel permissions |
| Levels/antilink/counting ignore messages | Message Content intent off |
| Stats channels not renaming | Discord rename limit, missing Manage Channels, or social lookup failing |
| Music silent | ffmpeg/yt-dlp missing, YouTube blocking the host IP, or no voice permissions |
| Social alerts never arrive | first check is baseline; wait one poll interval; check dashboard error text |
| Birthday not sent | feature disabled, no channel, hour not reached, or already celebrated this year |
| Dashboard 403 | user is not owner/dashboard user, or manager headers missing |
| Dashboard stale assets | restart the bot process so the asset version changes |

Logs are on stdout; in BYOT mode also in `DATA_DIR/bots/<botId>/bot.log`.
