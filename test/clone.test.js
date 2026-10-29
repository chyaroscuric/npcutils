import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ChannelType, Collection, OverwriteType } from 'discord.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jaankeza-clone-'));
const db = await import('../src/db.js');
const { cloneServer, plan } = await import('../src/features/clone.js');
db.load();

let nextId = 1000;
const log = [];

function fakeGuild(id, { roles = [], channels = [], members = [] } = {}) {
  const guild = { id, name: `guild-${id}`, features: [], maximumBitrate: 96000, icon: null, description: null, emojis: { cache: new Collection() } };
  const role = (r) => ({
    managed: false,
    editable: true,
    hoist: false,
    mentionable: false,
    colors: { primaryColor: 0xff0000, secondaryColor: null, tertiaryColor: null },
    permissions: { bitfield: 0n },
    delete: async () => { log.push(['deleteRole', id, r.id]); guild.roles.cache.delete(r.id); },
    ...r,
  });
  const channel = (c) => ({
    parentId: null,
    isThread: () => false,
    permissionOverwrites: { cache: new Collection() },
    delete: async () => { log.push(['deleteChannel', id, c.id]); guild.channels.cache.delete(c.id); },
    ...c,
  });
  guild.roles = {
    cache: new Collection([[id, role({ id, name: '@everyone', position: 0 })], ...roles.map((r) => [r.id, role(r)])]),
    create: async (o) => { const r = role({ id: String(nextId++), ...o }); guild.roles.cache.set(r.id, r); log.push(['createRole', id, o.name, o.colors]); return r; },
    setPositions: async (p) => log.push(['setPositions', id, p.length]),
  };
  guild.roles.everyone = { permissions: { bitfield: 0n }, setPermissions: async () => {} };
  guild.channels = {
    cache: new Collection(channels.map((c) => [c.id, channel(c)])),
    create: async (o) => { const c = channel({ id: String(nextId++), ...o, parentId: o.parent }); guild.channels.cache.set(c.id, c); log.push(['createChannel', id, o.name, o.type, o.parent ?? null, o.permissionOverwrites]); return c; },
  };
  guild.members = { cache: new Collection(members.map((m) => [m, { id: m }])) };
  guild.setName = async (n) => log.push(['setName', id, n]);
  guild.setSystemChannel = async (c) => log.push(['system', id, c]);
  return guild;
}

test('clone wipes the target, maps roles/channels/overwrites and copies bot settings', async () => {
  const source = fakeGuild('src', {
    roles: [{ id: 'r-admin', name: 'Admin', position: 2 }, { id: 'r-member', name: 'Member', position: 1 }],
    channels: [
      { id: 'cat', name: 'Chat', type: ChannelType.GuildCategory, rawPosition: 0 },
      {
        id: 'gen', name: 'general', type: ChannelType.GuildText, rawPosition: 1, parentId: 'cat',
        permissionOverwrites: { cache: new Collection([
          ['r-member', { id: 'r-member', type: OverwriteType.Role, allow: { bitfield: 1024n }, deny: { bitfield: 0n } }],
          ['u1', { id: 'u1', type: OverwriteType.Member, allow: { bitfield: 2048n }, deny: { bitfield: 0n } }],
          ['u2', { id: 'u2', type: OverwriteType.Member, allow: { bitfield: 2048n }, deny: { bitfield: 0n } }],
        ]) },
      },
      { id: 'ann', name: 'news', type: ChannelType.GuildAnnouncement, rawPosition: 2, parentId: 'cat' },
    ],
  });
  source.systemChannelId = 'gen';
  const target = fakeGuild('dst', {
    roles: [{ id: 'old-role', name: 'Old', position: 1 }, { id: 'bot-role', name: 'Bot', position: 5, managed: true }],
    channels: [{ id: 'old-1', name: 'x', type: ChannelType.GuildText, rawPosition: 0 }, { id: 'here', name: 'cmd', type: ChannelType.GuildText, rawPosition: 1 }],
    members: ['u1'],
  });
  db.guild('src').config = { welcome: { channelId: 'gen', message: 'Hej' }, autoroles: ['r-member'], tickets: { categoryId: 'cat', supportRoleId: 'r-admin', logChannelId: 'gen' } };
  db.guild('dst').giveaways = { m: {} };

  assert.deepEqual(plan(source, target), { deleteChannels: 2, deleteRoles: 1, createRoles: 2, createChannels: 3, emojis: 0 });
  const result = await cloneServer({ source, target, keepChannelId: 'here', options: { profile: true, emojis: false, botSettings: true }, progress: async () => {} });

  assert.deepEqual(result, { roles: 2, channels: 3, emojis: 0, failed: [] });
  assert.ok(log.some((l) => l[0] === 'deleteChannel' && l[2] === 'old-1'));
  assert.ok(!log.some((l) => l[0] === 'deleteChannel' && l[2] === 'here'), 'channel where the command runs is kept');
  assert.ok(log.some((l) => l[0] === 'deleteRole' && l[2] === 'old-role'));
  assert.ok(!log.some((l) => l[0] === 'deleteRole' && l[2] === 'bot-role'), 'managed roles stay');
  // highest role first, gradient colours stripped on servers without the feature
  const created = log.filter((l) => l[0] === 'createRole');
  assert.deepEqual(created.map((l) => l[2]), ['Admin', 'Member']);
  assert.deepEqual(created[0][3], { primaryColor: 0xff0000 });

  const channels = log.filter((l) => l[0] === 'createChannel');
  const [catCall, genCall, newsCall] = channels;
  assert.equal(catCall[3], ChannelType.GuildCategory);
  const newCat = [...target.channels.cache.values()].find((c) => c.name === 'Chat').id;
  assert.equal(genCall[4], newCat);
  const memberRole = [...target.roles.cache.values()].find((r) => r.name === 'Member').id;
  assert.deepEqual(genCall[5].map((o) => o.id), [memberRole, 'u1'], 'role overwrite mapped, unknown member dropped');
  assert.equal(newsCall[3], ChannelType.GuildText, 'announcement falls back to text without Community');
  assert.ok(log.some((l) => l[0] === 'setName' && l[2] === 'guild-src'));

  const newGeneral = [...target.channels.cache.values()].find((c) => c.name === 'general').id;
  const cfg = db.guild('dst').config;
  assert.equal(cfg.welcome.channelId, newGeneral);
  assert.deepEqual(cfg.autoroles, [memberRole]);
  assert.equal(cfg.tickets.categoryId, newCat);
  assert.deepEqual(db.guild('dst').giveaways, {});
  assert.ok(log.some((l) => l[0] === 'system' && l[2] === newGeneral));
});
