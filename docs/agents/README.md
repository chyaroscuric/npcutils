# Agent documentation

Start with [AGENTS.md](../../AGENTS.md). These pages go deeper:

| Page | Read it when you need to... |
| --- | --- |
| [architecture.md](architecture.md) | understand process model, events, schedulers and external services |
| [data-model.md](data-model.md) | change `db.json`, add a config key or migrate an old shape |
| [features.md](features.md) | find which module owns a behavior |
| [commands.md](commands.md) | add or change a slash command |
| [dashboard.md](dashboard.md) | add an API route or a dashboard page |
| [testing.md](testing.md) | add offline tests and fixtures |
| [operations.md](operations.md) | deploy, configure env vars, back up or debug |
| [recipes.md](recipes.md) | copy a starting point for a new feature |

## Quick orientation

- Entry points: `src/index.js` → `src/bot.js` or `src/manager/index.js`.
- Business logic: `src/features/`.
- Slash commands: `src/commands/` (thin wrappers).
- Dashboard API: `src/dashboard/server.js`.
- Dashboard SPA: `src/dashboard/public/app.js` + `app.css`.
- Data: `db.guild(guildId)` in `src/db.js`.
- Design rules: `design.md` at the repo root.
- Tests: `npm test`; command validation: `npm run check`.
