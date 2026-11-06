import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Collection } from 'discord.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jaankeza-antilink-'));
const db = await import('../src/db.js');
const antilink = await import('../src/features/antilink.js');
db.load();

function fakeMessage(content, { staff = false, roleIds = [], channelId = 'c1', parentId = null } = {}) {
  const calls = [];
  const member = {
    id: 'member',
    guild: null,
    permissions: { has: () => staff },
    roles: { cache: new Collection(roleIds.map((id) => [id, { id }])) },
  };
  const guild = {
    id: 'g1',
    ownerId: 'owner',
    client: { user: { id: 'bot' } },
    members: { me: { id: 'bot' }, fetch: async () => member },
    channels: { cache: new Collection() },
  };
  member.guild = guild;
  const channel = {
    id: channelId,
    parentId,
    send: async () => {
      calls.push(['notice']);
      return { delete: async () => calls.push(['notice-delete']) };
    },
  };
  const message = {
    id: 'm1',
    content,
    guild,
    member,
    channel,
    author: { id: 'member', bot: false },
    inGuild: () => true,
    delete: async () => calls.push(['delete']),
  };
  return { message, calls };
}

test('anti-link is on by default and detects invites and links', () => {
  const cfg = antilink.getConfig('g1');
  assert.equal(cfg.enabled, true);
  const { message } = fakeMessage('evo https://discord.gg/abc123');
  assert.equal(antilink.findBlocked(message), 'invite');
  assert.equal(antilink.findBlocked({ ...message, content: 'pogledajte example.com' }), 'link');
  assert.equal(antilink.findBlocked({ ...message, content: 'bez linka, samo tekst' }), null);
});

test('obfuscated links are still detected', () => {
  const { message } = fakeMessage('');
  for (const content of [
    'discord . gg / abc123',
    'discord[.]gg/abc123',
    'pogledaj example (dot) com',
    'hxxps://example.com',
    'example\u200B.com',
  ]) {
    assert.ok(antilink.findBlocked({ ...message, content }), content);
  }
});

test('config is validated', () => {
  const cfg = antilink.saveConfig('g1', { enabled: false, blockLinks: false, whitelistRoles: ['r1', 'r1'], whitelistChannels: ['c1'] });
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.blockLinks, false);
  assert.deepEqual(cfg.whitelistRoles, ['r1']);
  assert.deepEqual(cfg.whitelistChannels, ['c1']);
  antilink.saveConfig('g1', { enabled: true, blockLinks: true, whitelistRoles: [], whitelistChannels: [] });
});

test('regular member gets the message deleted and a notice', async () => {
  const { message, calls } = fakeMessage('https://example.com');
  assert.equal(await antilink.onMessage(message), true);
  assert.deepEqual(calls, [['delete'], ['notice']]);
});

test('staff, whitelisted roles and whitelisted channels are exempt', async () => {
  antilink.saveConfig('g1', { enabled: true, whitelistRoles: ['trusted'], whitelistChannels: ['allowed'] });
  for (const options of [{ staff: true }, { roleIds: ['trusted'] }, { channelId: 'allowed' }]) {
    const { message, calls } = fakeMessage('https://example.com', options);
    assert.equal(await antilink.onMessage(message), false);
    assert.deepEqual(calls, []);
  }
});

test('disabled protection lets messages through', async () => {
  antilink.saveConfig('g1', { enabled: false });
  const { message, calls } = fakeMessage('https://example.com');
  assert.equal(await antilink.onMessage(message), false);
  assert.deepEqual(calls, []);
  antilink.saveConfig('g1', { enabled: true });
});
