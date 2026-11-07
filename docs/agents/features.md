# Features

All feature modules live in `src/features/`. They receive Discord objects as arguments
and own their guild state. Commands and the dashboard call into them.

## Core server features

### `members.js`

- `giveAutoroles(member)` adds every configured autorole the bot can assign.
- `welcomePayload(member, inviterId, { banner })` builds the welcome embed.
- `buildWelcomePayload(member, inviterId)` renders the optional auto banner and falls
  back to the embed if rendering fails.
- `sendWelcome(member, inviterId)` sends to `config.welcome.channelId`.
- `boostPayload(member)` / `onMemberUpdate()` handle boost messages.

Placeholders: `{user}`, `{username}`, `{server}`, `{memberCount}`, `{inviter}`,
`{invites}`; `\n` becomes a newline via `fillTemplate`.

### `welcomeBanner.js`

Uses `@napi-rs/canvas` to draw a 1024×512 PNG:

- background image drawn cover, with a configurable dark overlay,
- title and subtitle from templates (`{server}`, `{username}`, `{memberCount}`),
- circular avatar with an accent ring,
- white rounded name pill with configurable text colour.

`normalizeBanner()` validates URLs and hex colours. Backgrounds are cached in memory for
10 minutes. If the background or avatar fetch fails, the renderer uses a flat fallback;
`buildWelcomePayload()` still falls back to the normal embed if the whole render fails.

### `stats.js` + `socialStats.js`

- `stats.js` creates locked voice channels at the top of the server and renames them with
  member/bot/boost/social counts. Discord limits renames to 2 per 10 minutes, so each
  channel is updated at most every ~5 minutes.
- `socialStats.js` exposes `fetchSocial(platform, account)` and `cleanAccount()`.
  - YouTube: channel page + `interactionType FollowAction` / `subscriberCountText`.
  - TikTok: `__UNIVERSAL_DATA_FOR_REHYDRATION__` JSON.
  - Twitch: DecAPI follower count, avatar and uptime.
- Results are cached for 10 minutes; `clearSocialCache()` is used by tests/tools.

### `socialAlerts.js`

Polls public pages and sends an embed when a tracked account changes state.

- Platforms/events: YouTube `upload` + `live`, TikTok `upload` + `live`, Twitch `live`.
- YouTube uploads: RSS feed `https://www.youtube.com/feeds/videos.xml?channel_id=...`.
  The channel ID is resolved from the profile page and cached in `state.channelId`.
- YouTube live: `/channel/<id>/live` page, `"videoDetails": { "isLive": true }`.
- TikTok live: non-empty `roomId` on the public profile.
- TikTok uploads: `videoCount` increase (the public page does not expose the latest video
  ID without a signed API request, so the alert links to the profile).
- Twitch live: DecAPI uptime, then title/game/avatar only while live.
- First check is a baseline (`lastCheckedAt` null) and sends nothing.
- A live stream that also appears in the YouTube RSS is marked as seen, so it produces
  one live alert instead of a live alert plus an upload alert.
- `buildNotification()` supports `{account}`, `{username}`, `{platform}`, `{event}`,
  `{title}`, `{url}`, `{game}`, `{followers}` and an optional role mention.
- `checkGuild(guild, { notify, accountId })` is used by the poller and dashboard.
- `start(client)` polls every `SOCIAL_POLL_MINUTES` (default 5, minimum 2).

### `tickets.js`

Panel button → modal reason → private channel `ticket-0001` → close button/command →
transcript `.txt` in the log channel. Staff can add/remove members. `tickets.open` tracks
open channels so they survive restarts.

### `invites.js`

Tracks joins/leaves by diffing invite uses. `stats(g, userId)` returns
`{ regular, left, fake, bonus, total }`. Accounts younger than 7 days count as fake.
Requires Manage Server and the Guild Invites intent.

### `reactionRoles.js`

Managed reaction-role messages and arbitrary existing messages. Emoji keys are
normalized by `parseEmoji` / `emojiKey`. Handles add/remove reactions.

### `giveaways.js`

Button entry, timed end, reroll. State is in `g.giveaways` and restored on startup.
`handleComponent` handles enter/leave/reroll buttons.

### `levels.js`

Message XP with cooldown, voice XP per minute, `/rank`, `/top`. Voice sessions are kept
in memory and flushed every 5 minutes. Announcements go to `config.levels.channelId` or
the message channel.

### `counting.js`

One channel, members count 1, 2, 3... A wrong number resets to 0 and posts where the
chain broke. Only numeric messages are considered.

### `moderation.js`

`/purge`, ban/kick/timeout, warnings, slowmode, lock/unlock. `modLog(guild, embed)` sends
to `config.modLogChannelId`. Warnings live in `g.warns`.

### `antilink.js`

Deletes links/invites from non-exempt members. Normalizes obfuscated links
(`[.]`, `dot`, `hxxp`, zero-width chars). Exempt: owner, bot, moderators and configured
roles/channels. Logs every deletion to the mod log.

### `antinuke.js`

Watches audit-log entries, counts actions in a window, punishes the actor and optionally
reverts damage (unban, recreate channels/roles, remove dangerous roles). Only the guild
owner can configure it. Incidents are kept in memory (last 30).

### `clone.js`

Copies roles, categories, channels, permissions, server profile, emojis and bot settings
(welcome + banner, boost, autoroles, tickets, stats, mod log, anti-nuke, birthdays,
social notification accounts) to a target guild. Destructive confirmation is handled by
the `/klon pokreni` button.

### `music.js`

`@discordjs/voice` + yt-dlp/ffmpeg. Queue is in memory; dashboard and slash commands
share `play()`, `control()` and `snapshot()`. `checkSetup()` downloads binaries if needed.

### `activity.js`

Appends to `g.activity` (max 30) and powers the dashboard overview feed.

## Games

### `games/index.js`

`onMessage(message)` tries flags, kaladont, then toplo-hladno. Only one game may run in a
channel; each `start()` checks the other games.

### `games/flags.js`

`/zastava [kontinent]`: bot posts a flag, first correct country name wins. Buttons:
skip, hint, play again. Round state is in memory and expires after 60 seconds.

### `games/wordle.js`

`/wordle`: per-player Wordle with buttons and modals. Uses `data/words.js`.

### `games/kaladont.js`

`/kaladont start|stop`: each word must start with the last two letters of the previous
word. Same player cannot play twice in a row. A word ending in `-nt` (or with no possible
continuation) wins. Words are checked with `dictionary.js`.

### `games/dictionary.js`

Loads Croatian and Serbian Latin hunspell dictionaries into `<DATA_DIR>/dict` on first
use. `isWord()` accepts words without diacritics (`kuca` for `kuća`). If loading fails,
games accept any word so they never get stuck.

### `games/toplo.js` + `games/similarity.js`

`/toplohladno start|stop`: a secret Croatian word is chosen from the semantic dataset.
Every guess gets a percentage and a temperature label:

- 100% = exact word; the round ends and a new secret starts automatically.
- 75–99% = hot/warm.
- 50–74% = lukewarm.
- 25–49% = cold.
- 0–24% = icy.

Similarity combines:

1. **Semantic groups** from `src/data/semantic.js` (school, family, food, nature,
   animals, technology, etc.). Words in the same group get a high base score.
2. **Strong related pairs** (`škola`–`učenik`, `more`–`plaža`, ...).
3. **Edit distance / prefix overlap** for unknown words and typos.

This is deliberately offline and deterministic; there is no embedding API. Extend
`src/data/semantic.js` to make more words feel related. `similarity()` returns an integer
0–100, `similarityLabel()` returns the emoji label and `similarityBar()` the 10-block bar.

### `games/ship.js`

`/ship`: deterministic percentage from a hash of both user IDs, drawn with avatars and a
heart on a canvas.

## Messaging

### `messages.js`

`buildMessagePayload(input)` validates and builds a Discord payload for a plain message
and/or one embed:

- content max 2000,
- title 256, description 4096, footer 2048, author 256,
- up to 25 fields (name 256, value 1024),
- total embed text max 6000,
- only http(s) URLs,
- `#rrggbb` or `rrggbb` colours.

`sendMessage(channel, input)` sends it. Used by the dashboard and `/posalji`.

## Birthdays

### `birthdays.js`

- `setBirthday(guildId, userId, { day, month, year? })`, `removeBirthday`,
  `getBirthday`, `listBirthdays`.
- Dates are validated against real month lengths; Feb 29 is allowed.
- `localParts(date, timeZone)` uses `Intl.DateTimeFormat`; default timezone is
  `Europe/Zagreb` (`BOT_TIMEZONE` env override).
- `nextBirthday(entry, now, timeZone)` returns the next occurrence and `daysUntil`.
- `tickGuild(guild)` runs every 15 minutes. It:
  1. removes birthday roles that are no longer valid,
  2. waits until `config.birthdays.hour` (default 9),
  3. sends one celebration per member per year (`lastCelebrated`),
  4. optionally adds the birthday role and tracks it in `birthdayRoles`.
- Feb 29 is celebrated on Feb 28 in non-leap years.
- Placeholders: `{user}`, `{username}`, `{server}`, `{age}`, `{date}`, `{memberCount}`.
