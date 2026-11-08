# Data model

The database is a single JSON file: `<DATA_DIR>/db.json` (default `data/db.json`).
`db.load()` reads it once; `db.save()` schedules an atomic write after 1 second.

Top-level shape:

```json
{
  "bot": { "status": { "text": "", "type": "custom", "state": "online" } },
  "guilds": {
    "<guildId>": { "...": "per-guild state" }
  }
}
```

## The guild object

`db.guild(id)` lazily creates these keys:

```js
{
  config: {
    dashboardUsers: [],        // user IDs allowed into the dashboard
    welcome: { channelId, message, imageUrl, banner }, // optional
    boost: { channelId, message, imageUrl },           // optional
    autoroles: [],             // role IDs
    stats: { ... },            // normalized by features/stats.js
    tickets: { categoryId, supportRoleId, logChannelId }, // optional
    modLogChannelId: null,
    antinuke: { ... },         // normalized by features/antinuke.js
    antilink: { ... },         // normalized by features/antilink.js
    levels: { ... },           // normalized by features/levels.js
    birthdays: { ... },        // normalized by features/birthdays.js
    socialAlerts: { ... },     // normalized by features/socialAlerts.js
  },
  invites: {},                 // inviterId -> { regular, left, fake, bonus }
  joins: {},                   // memberId -> { inviterId, code, fake, at }
  tickets: { counter: 0, open: {} }, // open: channelId -> { ownerId, number, createdAt, reason }
  reactionRoles: {},           // messageId -> { channelId, roles, managed, ... }
  giveaways: {},               // messageId -> giveaway state
}
```

Features add their own keys on first use. Do not assume a key exists; use `??=` or a
normalizer.

## Feature keys

| Key | Owner | Shape / notes |
| --- | --- | --- |
| `config.welcome` | `features/members.js` | `{ channelId, message, imageUrl, banner }`; `banner` is normalized by `features/welcomeBanner.js`: `{ enabled, backgroundUrl, title, subtitle, accentColor, nameColor, overlay }` |
| `config.boost` | `features/members.js` | `{ channelId, message, imageUrl }` |
| `config.goodbye` | `features/members.js` | `{ channelId, message, imageUrl }`; sent when a member leaves |
| `config.autoroles` | `features/members.js` | array of role IDs |
| `config.stats` | `features/stats.js` | `{ categoryId, categoryName, channels: { members, bots, boosts, tiktok, youtube, twitch } }`; each channel `{ enabled, channelId, template, account }` |
| `config.tickets` | `features/tickets.js` | `{ categoryId, supportRoleId, logChannelId }` |
| `tickets.open` | `features/tickets.js` | channelId -> `{ ownerId, number, createdAt, reason }` |
| `config.antinuke` | `features/antinuke.js` | `{ enabled, logChannelId, windowSec, revert, whitelistUsers, whitelistRoles, rules }` |
| `config.antilink` | `features/antilink.js` | `{ enabled, blockLinks, blockInvites, notify, whitelistRoles, whitelistChannels }` |
| `config.levels` | `features/levels.js` | `{ enabled, announce, channelId, xpPerMessage, xpPerMinuteVoice, cooldownSec }` |
| `levelUsers` | `features/levels.js` | userId -> `{ messages, voiceMs, messageXp, lastXpAt }` |
| `counting` | `features/counting.js` | `{ channelId, current, lastUserId, best }` |
| `warns` | `features/moderation.js` | userId -> array of `{ id, reason, at, by }` |
| `activity` | `features/activity.js` | last 30 `{ type, text, at }` |
| `kaladont` | `features/games/kaladont.js` | channelId -> `{ lastWord, lastUserId, used, streak }` |
| `toplo` | `features/games/toplo.js` | channelId -> `{ secret, startedAt, guesses: [{ word, percent, userId, at }], best }` |
| `mafiaScores` | `features/games/mafia.js` | userId -> `{ points, wins, games }`; running games are in memory only |
| `fishing` | `features/games/fishing.js` | `{ users: { userId: { xp, coins, inventory, casts, best, lastCastAt } } }` |
| `config.birthdays` | `features/birthdays.js` | `{ enabled, channelId, roleId, hour, message, timezone }` |
| `birthdays` | `features/birthdays.js` | userId -> `{ day, month, year, setAt, lastCelebrated }` |
| `birthdayRoles` | `features/birthdays.js` | userId -> `{ year, roleId }` (active birthday role) |
| `config.socialAlerts` | `features/socialAlerts.js` | `{ enabled, channelId, roleId, message, channels, accounts: [...] }`; `channels` maps `platform:event` to a channel ID override |
| `config.freeGames` | `features/freeGames.js` | `{ enabled, channelId, roleId, epic, steam, message, lastEpic, lastSteam, lastCheckedAt, lastError }` |

### Social alert account shape

```js
{
  id: "uuid",
  platform: "youtube" | "twitch" | "tiktok",
  account: "handle",
  label: "Display name",
  events: { upload: true, live: true }, // twitch has only live
  state: {
    lastVideoId, lastVideoTitle, lastVideoAt,
    videoCount, live, liveVideoId, lastLiveAt,
    lastCheckedAt, lastError,
    channelId, name, avatarUrl, followers, title, game
  }
}
```

`state` is persisted so a restart does not repeat an alert. `lastCheckedAt == null` means
"baseline not taken yet"; the next check stores state and sends nothing.

### Birthday shape

```js
{ day: 14, month: 2, year: 2001, setAt: 1710000000000, lastCelebrated: 2026 }
```

`year` is optional. `lastCelebrated` is the year of the last sent message and prevents
duplicates. `birthdayRoles` tracks roles that must be removed the next day.

## Migration rules

There is no migration runner. When changing a stored shape:

1. Keep reading the old shape in a `normalize*` function.
2. Fill missing fields from defaults.
3. Write only the new shape on the next save.
4. Add a test for the old shape (see `test/stats.test.js` for an example).

Do not delete user data silently. Prefer leaving unknown keys untouched.
