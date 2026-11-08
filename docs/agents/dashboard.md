# Dashboard

The dashboard is an Express API (`src/dashboard/server.js`) plus a single-page app
(`src/dashboard/public/app.js`, `app.css`, `index.html`). It has no build step.

## Auth modes

### Standalone bot

- `GET /login` redirects to Discord OAuth with `scope=identify`.
- `GET /callback` exchanges the code for a token, fetches `/users/@me`, creates a
  session and sets an HttpOnly `sid` cookie (7 days).
- API middleware reads `sid`, requires a valid session, and sets `req.userId`.
- Non-GET requests must send `X-Dashboard: 1` (the SPA's `api()` helper does).
- Guild access: bot owner (`BOT_OWNER_ID`), guild owner, or a member listed in
  `config.dashboardUsers` who is still on the guild.

### BYOT manager

- The manager authenticates the user and proxies `/b/<botId>/*` to the child bot.
- The bot's API middleware sees `MANAGER_SECRET` and trusts:
  - `X-Manager-Secret` must equal `MANAGER_SECRET`,
  - `X-Discord-User` is the authenticated user ID,
  - non-GET requests still need `X-Dashboard: 1`.
- The child bot's own OAuth session is not used.

`/health` is public and returns `{ bot, online, ping, uptime }` with 200/503.

## API structure

All JSON routes are under `/api`. Every guild route uses `api.param('gid', ...)` to load
`req.guild`, `req.member` and `req.g`.

```js
api.get('/guilds/:gid', (req, res) => { ... });
api.put('/guilds/:gid/welcome', (req, res) => { ... });
```

Use `textChannel(guild, id)` to validate text/announcement channels, `optionalText()`,
`imageUrlOf()`, `roleProblem()` and `ok(res, extra)`.

### Existing route groups

| Prefix | What it does |
| --- | --- |
| `/api/me`, `/api/bot`, `/api/bot/status` | user, guild list, bot info, global presence |
| `/guilds/:gid` | guild snapshot: channels, roles, config summaries, activity |
| `/guilds/:gid/access` | dashboard users |
| `/guilds/:gid/welcome`, `/boost`, `/goodbye` | message config + `/test`; welcome/goodbye accept a `banner` object |
| `/guilds/:gid/banner-upload` | raw image upload, cropped to 1024×512 and returned as a data URL |
| `/guilds/:gid/banner-preview` | rendered PNG preview for the banner designer |
| `/guilds/:gid/autoroles` | autorole IDs |
| `/guilds/:gid/stats` | stats channels snapshot/setup/refresh/remove |
| `/guilds/:gid/counting` | counting setup/reset/disable |
| `/guilds/:gid/levels` | level config, top lists, resets |
| `/guilds/:gid/tickets` | ticket config, panel, open list, close |
| `/guilds/:gid/invites` | leaderboard, bonus, reset, member search |
| `/guilds/:gid/reactionroles` | managed messages and roles |
| `/guilds/:gid/giveaways` | create/end/reroll/delete |
| `/guilds/:gid/antinuke` | config, whitelist, incidents |
| `/guilds/:gid/antilink` | config and whitelists |
| `/guilds/:gid/moderation` | mod log and warnings |
| `/guilds/:gid/games` | active kaladont + toplo-hladno, start/stop |
| `/guilds/:gid/music` | queue and controls |
| `/guilds/:gid/social` | social notification config, accounts, check, test |
| `/guilds/:gid/freegames` | Epic/Steam free game config, cached list, check, test |
| `/guilds/:gid/birthdays` | birthday config, list, remove, test |
| `/guilds/:gid/messages/send` | send a plain message/embed as the bot |

Error middleware maps `UserError` to `400 { error }`; anything else becomes a generic
500 and is logged. Throw `UserError` for validation.

## SPA structure

`app.js` is one IIFE. Important sections:

1. **Utilities** — `esc`, `html` tagged template, `mount`, `api`, `toast`, `run`,
   `openModal`, `confirmAction`, `field`, `selectField`, `formValue`.
2. **State** — `state.me`, `state.guildCache`, `state.page`, `state.navToken`,
   `state.cleanups`.
3. **NAV** — sidebar groups. `PAGE_KEYS` is derived from it.
4. **Router** — `parseRoute()` reads `#/g/<gid>/<page>`, `PAGES[page](ctx)` renders.
5. **Page helpers** — `pageHead`, `skelCard`, `emptyState`, `errorState`, `ctx.load`.
6. **Pages** — `pageOverview`, `pageWelcome`, `pageBirthdays`, `pageStats`,
   `pageTickets`, `pageInvites`, `pageReactionRoles`, `pageGiveaways`, `pageMusic`,
   `pageAntinuke`, `pageAntiLink`, `pageModeration`, `pageGames`, `pageCounting`,
   `pageLevels`, `pageMessages`, `pageSocial`.
7. **Forms/actions/inputs** — delegated handlers registered by key.
8. **Boot** — loads `/api/me`, renders shell, starts the hash router.

### Page pattern

```js
async function pageExample(ctx) {
  ctx.head = pageHead('Naslov', 'Kratki opis');
  mount(ctx.el, html`${ctx.head}<div class="cols">${skelCard(360)}</div>`);
  const res = await ctx.load(() => Promise.all([guildData(ctx.gid), api('GET', g$(ctx.gid, '/example'))]));
  if (!res) return;
  const [g, data] = res;
  Object.assign(state.page, { g, ctx, data });
  drawExample();
}

function drawExample() {
  const { g, ctx, data } = state.page;
  const id = uid('f');
  mount(ctx.el, html`${ctx.head}
    <section class="card">
      <form class="form" data-form="example" novalidate>
        <div class="fields">
          ${field({ name: 'channelId', label: 'Kanal', id, required: true,
            control: selectField({ id, name: 'channelId', options: textChannelOptions(g), value: data.config.channelId || '' }) })}
        </div>
        <div class="form-actions"><button type="submit" class="btn btn-primary">Spremi</button></div>
      </form>
    </section>`);
}

forms.example = async (f, btn) => {
  clearErrors(f);
  const { g } = state.page;
  const body = { channelId: formValue(f, 'channelId') || null };
  if (!body.channelId) return fieldError(f, 'channelId', 'Odaberi kanal.');
  const ok = await run(btn, () => api('PUT', g$(g.id, '/example'), body), 'Spremanje nije uspjelo');
  if (!ok) return;
  invalidateGuild(g.id);
  toast('success', 'Spremljeno');
  router();
};
```

### Forms

- `data-form="key"` is required for delegated submit handling.
- `forms.key = async (form, button) => {}` is called on submit.
- Use `formValue(form, name)` (returns `.checked` for checkboxes), `multiValue()` for
  multi-selects, `clearErrors()` / `fieldError()` for validation.
- `run(button, fn, errorTitle)` handles busy state, disables the button, toasts errors.
- After a save, update local state or `invalidateGuild(gid)` and redraw.

### Actions and inputs

- `data-action="key"` + `actions.key = (button, event) => {}`.
- `data-input` isn't a thing; use `inputs.key = (form) => {}` for live form updates. The
  delegated input handler finds `form[data-form]` and calls `inputs[key]`.
- Use `confirmAction({ title, text, confirmLabel, onConfirm })` for destructive actions.
- Use `toast(type, title, sub)` where type is `success`, `error`, `info`.
- Use `copyBtn`, `idRow`, `statusBadge`, `timeEl`, `avatar`, `count`, `fmtNum`,
  `fmtDur` for consistency.

### Selects and fields

- `field({ name, label, id, required, help, control })` renders label + control + help.
- `selectField({ id, name, options, value, multiple, searchable, placeholder, emptyText })`.
  Options are `{ value, label, group?, lead?, desc?, disabled? }`.
- `textChannelOptions(g)`, `voiceChannelOptions(g)`, `categoryOptions(g)`,
  `roleOptions(g, { assignableOnly })`.
- Use `groupedOptions()` for parent-category grouping.

### Design rules

`design.md` is mandatory. Key points:

- dark-only, one accent colour from CSS tokens,
- no gradients except page background/tab strip,
- cards on `--raise`, radius 16, no borders/shadows,
- one primary (filled accent) button per view,
- icons from one outline set (Tabler classes `ti-*`), no emoji as icons,
- 44px touch targets, focus-visible rings, sentence case Croatian copy,
- every list has empty/loading/error states.

Add new CSS only when the component does not exist. Prefer existing classes:
`card`, `card-head`, `card-title`, `card-desc`, `fields`, `field-row`, `form-actions`,
`plain-list`, `row`, `row-main`, `row-title`, `row-meta`, `row-end`, `badge`,
`callout`, `empty`, `skel`, `savebar`, `tabs`, `chip`, `preview`.

## Static assets and caching

`server.js` serves `index.html` with `__ASSET_VERSION__` replaced by the max mtime of
`app.js`/`app.css`, and sends `no-store`. Static files get `Cache-Control: no-cache`.
The manager injects `<base href="/b/<botId>/">` into HTML responses.

When changing dashboard assets, no build step is needed; restart the bot process (or the
manager) so the version changes.
