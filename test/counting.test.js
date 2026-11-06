import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'npcutils-counting-'));
const db = await import('../src/db.js');
const counting = await import('../src/features/counting.js');
db.load();

function message(content, author = 'u1') {
  const calls = [];
  return {
    calls,
    guild: { id: 'g1' },
    channelId: 'c1',
    content,
    author: { id: author, bot: false },
    react: async (e) => calls.push(['react', e]),
    channel: { send: async (p) => calls.push(['send', p.content]) },
  };
}

test('correct numbers advance and wrong numbers reset', async () => {
  counting.setup('g1', 'c1');
  let m = message('1');
  assert.equal(await counting.onMessage(m), true);
  assert.equal(counting.getConfig('g1').current, 1);
  assert.deepEqual(m.calls, [['react', '✅']]);

  m = message('2', 'u2');
  await counting.onMessage(m);
  assert.equal(counting.getConfig('g1').current, 2);
  assert.equal(counting.getConfig('g1').best, 2);

  m = message('9', 'u3');
  await counting.onMessage(m);
  assert.equal(counting.getConfig('g1').current, 0);
  assert.equal(m.calls[0][0], 'react');
  assert.match(m.calls[1][1], /POKVARIO\/LA SI NA 2/);
});

test('other channels and non-numbers are ignored', async () => {
  counting.setup('g1', 'c1');
  const other = { ...message('1'), channelId: 'c2' };
  assert.equal(await counting.onMessage(other), false);
  const text = message('hej');
  assert.equal(await counting.onMessage(text), true);
  assert.equal(counting.getConfig('g1').current, 0);
  assert.deepEqual(text.calls, []);
});

test('reset and disable', () => {
  counting.setup('g1', 'c1');
  counting.reset('g1');
  assert.equal(counting.getConfig('g1').current, 0);
  counting.disable('g1');
  assert.equal(counting.getConfig('g1'), null);
});
