import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'npcutils-manager-'));
process.env.MANAGER_DATA_DIR = dir;
delete process.env.TOKEN_ENCRYPTION_KEY;
const store = await import('../src/manager/store.js');

test('bot tokens are encrypted at rest and can be decrypted', () => {
  store.load();
  const token = 'MTIzNDU2Nzg5MDEyMzQ1Njc4.Gabcde.abcdefghijklmnopqrstuvwxyz';
  const enc = store.encrypt(token);
  assert.notEqual(enc, token);
  assert.equal(store.decrypt(enc), token);
  store.add({ id: 'bot1', name: 'Test', ownerId: 'owner', token: enc, createdAt: Date.now(), autoStart: true });
  const raw = fs.readFileSync(path.join(dir, 'manager', 'bots.json'), 'utf8');
  assert.equal(raw.includes(token), false);
  assert.equal(store.tokenOf('bot1'), token);
  assert.equal(store.get('bot1').ownerId, 'owner');
});

test('bots can be updated and removed', () => {
  store.update('bot1', { name: 'Novo ime' });
  assert.equal(store.get('bot1').name, 'Novo ime');
  assert.equal(store.remove('bot1'), true);
  assert.equal(store.get('bot1'), null);
});
