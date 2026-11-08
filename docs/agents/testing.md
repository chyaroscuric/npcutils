# Testing

Tests use the built-in `node:test` runner and `node:assert/strict`.

```bash
npm test          # node --test test/*.test.js
npm run check     # loads every command, validates builders, checks execute()
```

## Rules

1. **Offline only.** No test may call Discord, YouTube, TikTok, Twitch, DecAPI or any
   other network service. Use fixtures and exported parsers.
2. **Deterministic.** Do not depend on the real clock, random values or host timezone.
   Pass `now`/`timeZone` into date helpers. For randomness, test invariants (range,
   symmetry, membership) rather than exact values.
3. **Isolated data.** Set `process.env.DATA_DIR` to a fresh `mkdtemp` directory *before*
   importing `db.js` or a feature that imports it.
4. **No Discord client.** Mock only the objects a feature uses. See
   `test/antilink.test.js`, `test/counting.test.js`, `test/levels.test.js`.
5. **Test pure helpers.** Export parsers, normalizers and validators from features so
   they can be tested without a gateway connection.

## Test file template

```js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'npcutils-feature-'));
const db = await import('../src/db.js');
const feature = await import('../src/features/feature.js');
db.load();

test('normalizer keeps old data', () => {
  assert.equal(feature.normalize({ old: true }).enabled, false);
});
```

## What to test

- **Parsers/normalizers**: old shapes, defaults, invalid input, URL/colour validation.
- **Business rules**: permissions, limits, duplicate prevention, date math, similarity
  ordering, payload length limits.
- **State transitions**: first check is baseline, second check notifies; birthday sends
  once per year; role cleanup next day.
- **Command loading**: `npm run check` is enough for builder validity.
- **Rendering**: canvas output can be checked for a PNG signature and non-zero length
  without network (`test/welcomeBanner.test.js`).

## Existing tests

| File | Covers |
| --- | --- |
| `antilink.test.js` | link detection, exemptions, deletion |
| `antinuke.test.js` | limits, punishment, revert, whitelist |
| `botSettings.test.js` | presence validation and application |
| `birthdays.test.js` | date validation, leap years, next occurrence, storage, config |
| `clone.test.js` | role/channel mapping, destructive clone |
| `counting.test.js` | correct/wrong numbers, reset |
| `games.test.js` | flags, wordle, kaladont, dictionary, ship |
| `fishing.test.js` | fish table, XP levels, catching, cooldown, selling |
| `freeGames.test.js` | Epic/Steam parsers, new-game detection, config, payload |
| `mafia.test.js` | role distribution and win conditions |
| `members.test.js` | goodbye placeholders, default message, channel send |
| `invites.test.js` | joins/leaves/fakes/bonus |
| `levels.test.js` | XP formula, cooldown, voice, announcements |
| `manager.test.js` | token encryption, bot store |
| `messages.test.js` | payload building, fields, limits, URLs |
| `similarity.test.js` | semantic/lexical scores, labels, guess validation |
| `socialAlerts.test.js` | RSS/live/TikTok/Twitch parsers, config, accounts, payload |
| `stats.test.js` | stats config migration, templates |
| `utils.test.js` | duration, templates, emoji, reply helper |
| `welcomeBanner.test.js` | banner config and PNG rendering |

## Adding a test

1. Pick the smallest exported function that proves the behavior.
2. Add a fixture string in the test file; do not fetch it.
3. Add a regression test for the old stored shape if you change data.
4. Run `npm test` and `npm run check`.
5. Keep tests fast: the whole suite should stay in the low seconds. Canvas rendering is
   ~100ms; avoid rendering many large images.
