# Recipes

Copy-paste starting points for common changes. Always run `npm test` and
`npm run check` afterwards.

## 1. Add a feature module

`src/features/example.js`:

```js
import * as db from '../db.js';

export function defaultConfig() {
  return { enabled: false, channelId: null, limit: 10 };
}

export function getConfig(guildId) {
  return { ...defaultConfig(), ...(db.guild(guildId).config.example ?? {}) };
}

export function saveConfig(guildId, input = {}) {
  const next = getConfig(guildId);
  if ('enabled' in input) next.enabled = Boolean(input.enabled);
  if ('channelId' in input) next.channelId = input.channelId || null;
  if ('limit' in input) next.limit = Math.min(100, Math.max(1, Number(input.limit) || 10));
  db.guild(guildId).config.example = next;
  db.save();
  return next;
}

let timer = null;
export function start(client) {
  stop();
  timer = setInterval(() => tick(client), 60_000);
  timer.unref?.();
}
export function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}
async function tick(client) {
  for (const guild of client.guilds.cache.values()) {
    try { /* work */ } catch (err) { console.error('[example]', guild.name, err); }
  }
}
```

Wire it in `src/bot.js`:

```js
import * as example from './features/example.js';
// ClientReady:
example.start(client);
// shutdown():
example.stop();
```

## 2. Add a slash command

`src/commands/example.js`:

```js
import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as example from '../features/example.js';
import { UserError, reply } from '../utils/helpers.js';

export const deferEphemeral = true;

export const data = new SlashCommandBuilder()
  .setName('example')
  .setDescription('Kratki opis')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addChannelOption((o) =>
    o.setName('kanal').setDescription('Kanal').setRequired(true)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  );

export async function execute(interaction) {
  const channel = interaction.options.getChannel('kanal', true);
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    throw new UserError('Trebaš permisiju **Manage Server**.');
  }
  const cfg = example.saveConfig(interaction.guild.id, { channelId: channel.id, enabled: true });
  return reply(interaction, `✅ Uključeno u ${channel}. Limit: ${cfg.limit}.`);
}
```

Add it to `/help` and run `npm run check`.

## 3. Add a dashboard page

1. Add to `NAV`:

```js
{ key: 'example', label: 'Primjer', icon: 'ti-sparkles' },
```

2. Add the page function and `PAGES.example = pageExample`.
3. Use the pattern from `docs/agents/dashboard.md`:

```js
async function pageExample(ctx) {
  ctx.head = pageHead('Primjer', 'Kratki opis');
  mount(ctx.el, html`${ctx.head}<div class="cols cols-form-right">${skelCard(360)}${skelCard(240)}</div>`);
  const res = await ctx.load(() => Promise.all([guildData(ctx.gid), api('GET', g$(ctx.gid, '/example'))]));
  if (!res) return;
  const [g, data] = res;
  Object.assign(state.page, { g, ctx, data });
  drawExample();
}
```

4. Add `forms.example` / `actions['example-save']` handlers.
5. Add the API routes (next recipe).
6. `invalidateGuild(g.id)` after writes and redraw.

## 4. Add an API route group

In `src/dashboard/server.js`, after the guild middleware:

```js
api.get('/guilds/:gid/example', (req, res) => {
  res.json({ config: example.getConfig(req.guild.id) });
});

api.put('/guilds/:gid/example', (req, res) => {
  const body = req.body ?? {};
  const channel = body.channelId ? textChannel(req.guild, body.channelId) : null;
  if (body.enabled && !channel) throw new UserError('Odaberi kanal.');
  ok(res, { config: example.saveConfig(req.guild.id, { ...body, channelId: channel?.id ?? null }) });
});
```

Throw `UserError` for user mistakes. Wrap feature `Error`s in `UserError` if the message
is safe to show.

## 5. Add a test

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'npcutils-example-'));
const db = await import('../src/db.js');
const example = await import('../src/features/example.js');
db.load();

test('config merges defaults and clamps limit', () => {
  const cfg = example.saveConfig('g1', { enabled: true, limit: 999 });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.limit, 100);
});
```

## 6. Add a social platform or event

1. Add the platform to `PLATFORMS` in `src/features/socialAlerts.js`:
   `{ label, color, events: ['upload', 'live'] }`.
2. Add a fetcher and a branch in `checkAccount()`.
3. Export a pure parser for tests.
4. Update `docs/agents/features.md` and the dashboard platform icons.
5. Add fixtures to `test/socialAlerts.test.js`; never fetch in tests.

## 7. Make toplo-hladno smarter

- Add words to an existing group in `src/data/semantic.js`, or add a new group.
- Add strong pairs to `RELATED_PAIRS` (e.g. `['more', 'plaža']`).
- Run `node --test test/similarity.test.js` and check:
  - related > unrelated,
  - exact = 100,
  - symmetry.
- Keep `SECRET_WORDS` between 4 and 12 characters; the game filters automatically.

## 8. Change the welcome banner

- Rendering: `src/features/welcomeBanner.js`.
- Config/validation: `normalizeBanner()` in the same file.
- Discord payload: `buildWelcomePayload()` in `src/features/members.js`.
- Dashboard fields: `messagePanel()` in `app.js` (welcome tab only).
- API: `PUT /guilds/:gid/welcome` accepts a `banner` object.
- Test: `test/welcomeBanner.test.js` (PNG signature, colour/URL normalization).

## 9. Change birthday behavior

- Date math: `localParts`, `nextBirthday`, `effectiveDay`, `isBirthdayToday`.
- Scheduler: `tickGuild` / `start`.
- Role cleanup: `cleanupRoles`.
- Command: `src/commands/birthday.js`.
- Dashboard: `pageBirthdays` in `app.js`.
- Tests: `test/birthdays.test.js` (fixed `now`, explicit timezone).

## 10. Send a message as the bot

Use `src/features/messages.js`:

```js
import { sendMessage } from '../features/messages.js';

await sendMessage(channel, {
  content: 'Obavijest',
  embed: {
    enabled: true,
    title: 'Naslov',
    description: 'Opis',
    color: '#5865f2',
    fields: [{ name: 'Polje', value: 'Vrijednost', inline: true }],
  },
});
```

`buildMessagePayload()` throws a plain `Error` with a Croatian message for invalid input;
the dashboard route wraps it in `UserError`.
