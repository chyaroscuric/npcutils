import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'npcutils-birthdays-'));
const db = await import('../src/db.js');
const b = await import('../src/features/birthdays.js');
db.load();

test('birthday validation accepts real dates and rejects impossible ones', () => {
  assert.deepEqual(b.validateBirthday({ day: 14, month: 2, year: 2001 }), { day: 14, month: 2, year: 2001 });
  assert.deepEqual(b.validateBirthday({ day: 29, month: 2, year: 2024 }), { day: 29, month: 2, year: 2024 });
  assert.throws(() => b.validateBirthday({ day: 31, month: 4 }), /ne postoji/);
  assert.throws(() => b.validateBirthday({ day: 0, month: 1 }), /Dan/);
  assert.throws(() => b.validateBirthday({ day: 1, month: 13 }), /Mjesec/);
  assert.throws(() => b.validateBirthday({ day: 1, month: 1, year: 1800 }), /Godina/);
});

test('Feb 29 is celebrated on Feb 28 in non-leap years', () => {
  assert.equal(b.effectiveDay(2024, 2, 29), 29);
  assert.equal(b.effectiveDay(2025, 2, 29), 28);
  assert.equal(b.isBirthdayToday({ day: 29, month: 2 }, { year: 2025, month: 2, day: 28, hour: 9 }), true);
  assert.equal(b.isBirthdayToday({ day: 29, month: 2 }, { year: 2024, month: 2, day: 28, hour: 9 }), false);
});

test('next birthday handles today and next year', () => {
  const entry = { day: 10, month: 6 };
  const before = b.nextBirthday(entry, new Date('2026-06-09T12:00:00Z'), 'Europe/Zagreb');
  assert.equal(before.daysUntil, 1);
  assert.equal(before.year, 2026);
  const after = b.nextBirthday(entry, new Date('2026-06-11T12:00:00Z'), 'Europe/Zagreb');
  assert.equal(after.year, 2027);
  const today = b.nextBirthday(entry, new Date('2026-06-10T12:00:00Z'), 'Europe/Zagreb');
  assert.equal(today.daysUntil, 0);
});

test('birthdays are stored, listed and removed per guild', () => {
  b.setBirthday('g1', 'u1', { day: 1, month: 12, year: 1990 });
  b.setBirthday('g1', 'u2', { day: 5, month: 1 });
  b.setBirthday('g2', 'u1', { day: 2, month: 3 });
  const list = b.listBirthdays('g1', { now: new Date('2026-11-07T12:00:00Z'), timeZone: 'Europe/Zagreb' });
  assert.equal(list.length, 2);
  assert.equal(list[0].userId, 'u1');
  assert.equal(list[0].next.daysUntil, 24);
  assert.equal(b.getBirthday('g2', 'u1').month, 3);
  assert.equal(b.removeBirthday('g1', 'u1'), true);
  assert.equal(b.getBirthday('g1', 'u1'), null);
  assert.equal(b.removeBirthday('g1', 'u1'), false);
});

test('birthday config defaults and merges', () => {
  const cfg = b.getConfig('g1');
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.hour, 9);
  const saved = b.saveConfig('g1', { enabled: true, channelId: 'c1', hour: 7, message: 'Hej {user}' });
  assert.equal(saved.enabled, true);
  assert.equal(saved.channelId, 'c1');
  assert.equal(saved.hour, 7);
  assert.equal(saved.message, 'Hej {user}');
  assert.equal(b.getConfig('g1').timezone, b.DEFAULT_TIMEZONE);
});

test('celebration is sent once per year', async () => {
  b.saveConfig('g3', { enabled: true, channelId: 'c1', hour: 0 });
  const now = new Date('2026-11-07T12:00:00Z');
  const today = b.localParts(now, 'Europe/Zagreb');
  b.setBirthday('g3', 'u1', { day: today.day, month: today.month });
  const sent = [];
  const member = {
    id: 'u1',
    user: { username: 'Mario', displayAvatarURL: () => 'https://example.com/a.png' },
    roles: { cache: { has: () => false }, add: async () => {} },
  };
  const guild = {
    id: 'g3',
    name: 'Test',
    memberCount: 10,
    client: { user: { username: 'Bot' } },
    members: { cache: new Map([['u1', member]]), fetch: async () => member },
    channels: { cache: new Map([['c1', { send: async (payload) => sent.push(payload) }]]) },
    roles: { cache: new Map() },
  };
  assert.equal((await b.tickGuild(guild, { now })).sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(b.getBirthday('g3', 'u1').lastCelebrated, 2026);
  assert.equal((await b.tickGuild(guild, { now })).sent, 0);
  assert.equal(sent.length, 1);
});
