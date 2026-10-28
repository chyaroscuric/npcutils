import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AuditLogEvent, Collection } from 'discord.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jaankeza-antinuke-'));
const db = await import('../src/db.js');
const antinuke = await import('../src/features/antinuke.js');
db.load();

function fakeGuild() {
  const calls = [];
  const member = (id) => ({ id, roles: { cache: new Collection() }, kick: async () => calls.push(['kick', id]) });
  const guild = {
    id: 'g1',
    ownerId: 'owner',
    client: { user: { id: 'bot' }, users: { fetch: async (id) => ({ id, username: `user-${id}` }) } },
    members: {
      cache: new Collection([['nuker', member('nuker')], ['admin', member('admin')]]),
      fetch: async (id) => member(id),
      ban: async (id) => calls.push(['ban', id]),
      unban: async (id) => calls.push(['unban', id]),
    },
    roles: { cache: new Collection() },
    channels: { cache: new Collection() },
    fetchOwner: async () => ({ send: async () => calls.push(['dm-owner']) }),
  };
  return { guild, calls };
}

test('config is validated and merged with defaults', () => {
  const cfg = antinuke.saveConfig('g1', { enabled: true, windowSec: 1, rules: { ban: { limit: 999, punishment: 'nope' } } });
  assert.equal(cfg.windowSec, 5);
  assert.equal(cfg.rules.ban.limit, 50);
  assert.equal(cfg.rules.ban.punishment, 'ban');
  assert.equal(cfg.rules.kick.limit, 1);
});

test('mass ban gets punished once and reverted', async () => {
  antinuke.saveConfig('g1', { enabled: true, windowSec: 60, revert: true, rules: { ban: { limit: 1, punishment: 'ban' } } });
  const { guild, calls } = fakeGuild();
  const ban = (target, executorId = 'nuker') => antinuke.onAuditLogEntry({ action: AuditLogEvent.MemberBanAdd, executorId, targetId: target, changes: [] }, guild);
  await ban('v1');
  assert.deepEqual(calls, []);
  await ban('v2');
  assert.deepEqual(calls.filter((c) => c[0] !== 'dm-owner'), [['ban', 'nuker'], ['unban', 'v1'], ['unban', 'v2']]);
  calls.length = 0;
  await ban('v3');
  // already punished: only the new damage is undone
  assert.deepEqual(calls, [['unban', 'v3']]);
  assert.equal(antinuke.incidents('g1')[0].action, 'ban');
});

test('owner, bot and whitelist are exempt; disabled rules do nothing', async () => {
  const { guild, calls } = fakeGuild();
  antinuke.saveConfig('g1', { whitelistUsers: ['admin'], rules: { kick: { limit: 0 } } });
  for (const executorId of ['owner', 'bot', 'admin']) {
    await antinuke.onAuditLogEntry({ action: AuditLogEvent.MemberKick, executorId, targetId: 'x', changes: [] }, guild);
  }
  assert.deepEqual(calls, []);
  antinuke.saveConfig('g1', { rules: { kick: { enabled: false } } });
  await antinuke.onAuditLogEntry({ action: AuditLogEvent.MemberKick, executorId: 'someone', targetId: 'x', changes: [] }, guild);
  assert.deepEqual(calls, []);
});

test('dangerous permission update is instant and reverted', async () => {
  const { guild, calls } = fakeGuild();
  guild.roles.cache.set('r1', { setPermissions: async (p) => calls.push(['setPermissions', p.bitfield]) });
  antinuke.saveConfig('g1', { rules: { dangerousRoleUpdate: { enabled: true, punishment: 'kick' } } });
  await antinuke.onAuditLogEntry(
    { action: AuditLogEvent.RoleUpdate, executorId: 'nuker2', targetId: 'r1', changes: [{ key: 'permissions', old: '0', new: '8' }] },
    guild,
  );
  assert.deepEqual(calls.filter((c) => c[0] !== 'dm-owner'), [['kick', 'nuker2'], ['setPermissions', 0n]]);
});
