import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'npcutils-levels-'));
const db = await import('../src/db.js');
const levels = await import('../src/features/levels.js');
db.load();

function message(authorId) {
  const calls = [];
  return {
    calls,
    guild: { id: 'g1' },
    channel: { send: async (p) => calls.push(p.content) },
    author: { id: authorId, bot: false },
  };
}

test('level formula', () => {
  assert.equal(levels.levelForXp(0), 0);
  assert.equal(levels.levelForXp(99), 0);
  assert.equal(levels.levelForXp(100), 1);
  assert.equal(levels.levelForXp(400), 2);
  assert.equal(levels.levelForXp(900), 3);
  assert.equal(levels.xpForLevel(3), 900);
});

test('messages give XP with cooldown and count messages', async () => {
  levels.saveConfig('g1', { enabled: true, announce: false, xpPerMessage: 20, cooldownSec: 60 });
  const m = message('u1');
  await levels.onMessage(m);
  const first = levels.statsFor('g1', 'u1');
  assert.equal(first.messages, 1);
  assert.equal(first.xp, 20);
  await levels.onMessage(message('u1'));
  const second = levels.statsFor('g1', 'u1');
  assert.equal(second.messages, 2);
  assert.equal(second.xp, 20);
});

test('voice time becomes XP and top lists sort', () => {
  levels.saveConfig('g1', { enabled: true, xpPerMinuteVoice: 5 });
  const guild = { id: 'g1', afkChannelId: 'afk' };
  const member = { id: 'u2', user: { bot: false } };
  const oldState = { guild, member, channelId: null, selfDeaf: false, serverDeaf: false };
  const newState = { guild, member, channelId: 'v1', selfDeaf: false, serverDeaf: false };
  levels.onVoiceStateUpdate(oldState, newState);
  levels.flushVoice(Date.now() + 120_000);
  const stats = levels.statsFor('g1', 'u2');
  assert.ok(stats.voiceMs >= 120_000);
  assert.equal(stats.xp, 10);

  const top = levels.top('g1', 10);
  assert.equal(top.voice[0].userId, 'u2');
  assert.equal(top.text[0].userId, 'u1');
});

test('reset user and all', () => {
  assert.equal(levels.resetUser('g1', 'u1'), true);
  assert.equal(levels.statsFor('g1', 'u1').messages, 0);
  levels.resetAll('g1');
  assert.deepEqual(levels.top('g1', 10), { text: [], voice: [] });
});
