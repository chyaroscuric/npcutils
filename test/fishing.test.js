import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'npcutils-fishing-'));
const db = await import('../src/db.js');
const fishing = await import('../src/features/games/fishing.js');
db.load();

test('fish picking covers the whole table', () => {
  assert.equal(fishing.pickFish(() => 0).key, 'cizma');
  assert.equal(fishing.pickFish(() => 0.999999).key, 'kit');
  assert.ok(fishing.FISH.every((fish) => fish.weight > 0));
});

test('fishing levels grow with XP', () => {
  assert.equal(fishing.levelForXp(0), 0);
  assert.equal(fishing.levelForXp(99), 0);
  assert.equal(fishing.levelForXp(100), 1);
  assert.equal(fishing.levelForXp(400), 2);
  assert.equal(fishing.xpForLevel(3), 900);
});

test('catching stores inventory and XP with a cooldown', () => {
  const first = fishing.catchFish('g1', 'u1', { now: 10_000, random: () => 0 });
  assert.equal(first.caught.length, 1);
  assert.equal(first.caught[0].fish.key, 'cizma');
  assert.equal(first.xpGained, 1);
  assert.equal(first.user.inventory.cizma, 1);
  const cooldown = fishing.catchFish('g1', 'u1', { now: 10_500, random: () => 0 });
  assert.ok(cooldown.cooldownMs > 0);
  const second = fishing.catchFish('g1', 'u1', { now: 13_000, random: () => 0.999999 });
  assert.equal(second.caught[0].fish.key, 'kit');
  assert.equal(second.caught[0].count, 3);
  assert.equal(second.user.inventory.kit, 3);
});

test('selling clears the inventory and adds coins', () => {
  const before = fishing.getUser('g1', 'u1');
  const result = fishing.sellAll('g1', 'u1');
  assert.ok(result.earned >= 600);
  assert.equal(result.sold.find((item) => item.fish.key === 'kit').count, 3);
  assert.equal(result.coins, result.earned);
  assert.equal(fishing.inventoryCount(before), 0);
  const empty = fishing.sellAll('g1', 'u1');
  assert.equal(empty.earned, 0);
});
