import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'npcutils-members-'));
const db = await import('../src/db.js');
const members = await import('../src/features/members.js');
db.load();

function fakeMember() {
  return {
    id: 'u1',
    joinedTimestamp: Date.parse('2026-01-02T12:00:00Z'),
    user: {
      username: 'Mario',
      displayAvatarURL: () => 'https://example.com/avatar.png',
    },
    guild: {
      id: 'g1',
      name: 'SKY',
      memberCount: 42,
      iconURL: () => null,
      channels: { cache: new Map() },
    },
  };
}

test('goodbye payload uses placeholders and does not ping the member', () => {
  db.guild('g1').config.goodbye = { channelId: 'c1', message: '👋 {user} ({username}) je otišao/la s {server}. Ostalo: {memberCount}. Član od {joined}.' };
  const payload = members.goodbyePayload(fakeMember());
  const embed = payload.embeds[0].toJSON();
  assert.match(embed.description, /Mario \(Mario\) je otišao\/la s SKY\. Ostalo: 42\./);
  assert.match(embed.description, /<t:\d+:R>/);
  assert.equal(payload.content, undefined);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test('default goodbye message works', () => {
  delete db.guild('g1').config.goodbye;
  const payload = members.goodbyePayload(fakeMember());
  const embed = payload.embeds[0].toJSON();
  assert.match(embed.description, /Mario/);
  assert.match(embed.description, /42/);
});

test('goodbye payload can attach a generated banner', () => {
  db.guild('g1').config.goodbye = { channelId: 'c1', message: 'Bok {username}' };
  const payload = members.goodbyePayload(fakeMember(), { banner: Buffer.from('fake-png') });
  const embed = payload.embeds[0].toJSON();
  assert.equal(embed.image.url, 'attachment://goodbye.png');
  assert.equal(payload.files.length, 1);
});

test('banner-only mode sends just the image attachment', () => {
  db.guild('g1').config.goodbye = {
    channelId: 'c1',
    banner: { enabled: true, onlyImage: true, backgroundUrl: 'https://example.com/bg.png' },
  };
  const payload = members.goodbyePayload(fakeMember(), { banner: Buffer.from('fake-png') });
  assert.equal(payload.embeds, undefined);
  assert.equal(payload.content, undefined);
  assert.equal(payload.files.length, 1);
});

test('sendGoodbye sends to the configured channel', async () => {
  const sent = [];
  const member = fakeMember();
  member.guild.channels.cache.set('c1', { send: async (payload) => sent.push(payload) });
  db.guild('g1').config.goodbye = { channelId: 'c1', message: 'Bok {username}' };
  await members.sendGoodbye(member);
  assert.equal(sent.length, 1);
  assert.match(sent[0].embeds[0].toJSON().description, /Bok Mario/);
});
