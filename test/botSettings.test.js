import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'npcutils-settings-'));
const db = await import('../src/db.js');
const settings = await import('../src/features/botSettings.js');
db.load();

test('status defaults and validation', () => {
  assert.deepEqual(settings.getSettings().status, { text: '', type: 'custom', state: 'online' });
  const saved = settings.saveSettings({ status: { text: '  Pozdrav  ', type: 'playing', state: 'idle' } });
  assert.deepEqual(saved.status, { text: 'Pozdrav', type: 'playing', state: 'idle' });
  const fallback = settings.saveSettings({ status: { text: 'x', type: 'nepostoji', state: 'nepostoji' } });
  assert.equal(fallback.status.type, 'custom');
  assert.equal(fallback.status.state, 'online');
  assert.equal(settings.saveSettings({ status: { text: 'a'.repeat(200) } }).status.text.length, 128);
});

test('bot owner can edit global status', () => {
  const client = { application: { owner: { id: 'owner-1' } } };
  assert.equal(settings.canEdit(client, 'owner-1'), true);
  assert.equal(settings.canEdit(client, 'someone'), false);
  const team = { application: { owner: { ownerId: 'team-owner', members: new Map([['1', { user: { id: 'member-1' } }]]) } } };
  assert.equal(settings.canEdit(team, 'team-owner'), true);
  assert.equal(settings.canEdit(team, 'member-1'), true);
});

test('applyStatus sets the configured presence', async () => {
  settings.saveSettings({ status: { text: 'Test status', type: 'watching', state: 'dnd' } });
  const calls = [];
  const client = { user: { setPresence: async (p) => calls.push(p) } };
  await settings.applyStatus(client);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, 'dnd');
  assert.equal(calls[0].activities[0].name, 'Test status');
  assert.equal(calls[0].activities[0].type, 3);
});
