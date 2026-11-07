# Commands

Commands live in `src/commands/*.js` and are loaded alphabetically by
`src/loadCommands.js`.

## Module shapes

Single command:

```js
import { SlashCommandBuilder, InteractionContextType } from 'discord.js';

export const deferEphemeral = true; // optional
export const data = new SlashCommandBuilder()
  .setName('example')
  .setDescription('...')
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) { ... }
```

Multiple commands from one file:

```js
export const commands = [
  { data: dataA, execute: executeA, deferEphemeral: true },
  { data: dataB, execute: executeB },
];
```

`npm run check` calls `toJSON()` on every builder, so invalid option names, lengths or
contexts fail fast.

## Conventions

- Names are lowercase, no spaces, max 32 characters. Prefer one word: `/rank`, `/top`,
  `/ship`, `/posalji`, `/toplohladno`.
- Descriptions are Croatian, sentence case, no trailing period.
- Use `setContexts(InteractionContextType.Guild)` for guild-only commands.
- Use `setDefaultMemberPermissions(...)` for commands that need permissions. The bot also
  checks permissions at runtime where the action is dangerous.
- Common options: `korisnik` (user), `kanal` (channel), `rola` (role), `broj` (integer),
  `trajanje` (duration string), `poruka` (string), `ukljuceno` (boolean).
- Channel options should restrict types:
  `.addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)`.
- Mark required options with `.setRequired(true)`; set sensible min/max values.
- Use `deferEphemeral = true` when the command may take more than ~2 seconds (network,
  image rendering, Discord writes). The handler then calls `interaction.editReply()`.
- `reply(interaction, text, { ok })` handles deferred vs. fresh replies. `fail()` prefixes
  `❌`. Throw `UserError` for user-facing validation errors.
- Do not call `interaction.reply()` after a defer; use `editReply()` or `followUp()`.

## Permissions

- `ManageGuild` (Manage Server): configuration commands (welcome, boost, autorole,
  stats setup, tickets setup, levels, counting, antinuke, antilink, birthdays, `/posalji`).
- `ManageChannels`: starting/stopping chat games (`/kaladont`, `/toplohladno`).
- `ManageRoles`: reaction roles.
- Moderation commands check the moderator's role position against the target; never
  punish the owner or someone with an equal/higher role.
- The bot needs its own role above roles it assigns (autorole, reaction roles, birthday
  role) and `Manage Roles` permission. `roleProblem()` explains the problem.

## Current commands

| Area | Commands |
| --- | --- |
| Stats | `/stats server`, `/stats tiktok`, `/stats youtube`, `/stats twitch`, `/stats setup`, `/stats refresh`, `/stats remove` |
| Tickets | `/ticket setup`, `/ticket panel`, `/ticket close`, `/ticket add`, `/ticket remove` |
| Invites | `/invites`, `/leaderboard`, `/invitesadmin bonus`, `/invitesadmin reset` |
| Welcome/boost | `/welcome set`, `/welcome test`, `/welcome off`, `/goodbye set`, `/goodbye test`, `/goodbye off`, `/boost set`, `/boost test`, `/boost off` |
| Autorole | `/autorole add`, `/autorole remove`, `/autorole list` |
| Birthdays | `/birthday postavi`, `/birthday ukloni`, `/birthday sljedeci`, `/birthday postavke`, `/birthday test`, `/birthday iskljuci` |
| Reaction roles | `/reactionrole create`, `/reactionrole add`, `/reactionrole remove`, `/reactionrole list` |
| Giveaways | `/giveaway start`, `/giveaway end`, `/giveaway reroll`, `/giveaway list`, `/giveaway delete` |
| Music | `/play`, `/skip`, `/pause`, `/resume`, `/stop`, `/queue`, `/loop`, `/shuffle`, `/remove` |
| Games | `/zastava`, `/wordle`, `/kaladont start\|stop`, `/toplohladno start\|stop`, `/mafia start\|stop\|stats`, `/fish`, `/ship`, `/counting ...` |
| Levels | `/rank`, `/top`, `/levels status\|ukljuci\|postavke\|reset` |
| Messaging | `/posalji` |
| Moderation | `/purge`, `/ban`, `/unban`, `/kick`, `/timeout`, `/untimeout`, `/warn`, `/warnings`, `/clearwarns`, `/slowmode`, `/lock`, `/unlock`, `/modlog` |
| Clone | `/klon izvor`, `/klon cilj`, `/klon status`, `/klon pokreni` |
| Anti-nuke | `/antinuke status\|ukljuci\|pravilo\|postavke\|whitelist` |
| Anti-link | `/antilink status\|ukljuci\|pravilo\|obavijest\|whitelist` |
| Help | `/help` |

Social notification accounts are configured on the dashboard only. If you add a command
for them, follow the `/antilink` subcommand style and update `/help`.

## Adding a command checklist

1. Create the file; export `data` + `execute` or `commands`.
2. Validate options and permissions; throw `UserError` for user mistakes.
3. Call a feature function; keep Discord API calls out of reusable logic.
4. Use `deferEphemeral` for slow work.
5. Add the command to `src/commands/help.js`.
6. Run `npm run check` and `npm test`.
