import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'npcutils-stats-'));
const db = await import('../src/db.js');
const stats = await import('../src/features/stats.js');
db.load();

test('old stats config is converted to the new shape', () => {
  const cfg = stats.normalizeStatsConfig({ categoryId: 'cat', members: 'm1', bots: 'b1', boosts: 'x1' });
  assert.equal(cfg.categoryId, 'cat');
  assert.equal(cfg.channels.members.channelId, 'm1');
  assert.equal(cfg.channels.members.enabled, true);
  assert.equal(cfg.channels.members.template, '👥 Članovi: {count}');
  assert.equal(cfg.channels.tiktok.enabled, false);
});

test('templates and social accounts are saved and merged', () => {
  stats.saveStatsConfig('g1', {
    categoryName: '  Moja statistika  ',
    channels: {
      members: { enabled: true, template: '👤 Ljudi: {count}' },
      tiktok: { enabled: true, template: 'TT: {count}', account: '@test' },
    },
  });
  const cfg = stats.getStatsConfig('g1');
  assert.equal(cfg.categoryName, 'Moja statistika');
  assert.equal(cfg.channels.members.template, '👤 Ljudi: {count}');
  assert.equal(cfg.channels.tiktok.enabled, true);
  assert.equal(cfg.channels.tiktok.account, '@test');
  assert.equal(cfg.channels.bots.enabled, true);
});

test('channel names replace the count and stay within Discord limits', () => {
  assert.equal(stats.renderStatsName('👥 Članovi: {count}', 63), '👥 Članovi: 63');
  assert.equal(stats.renderStatsName('x{value}y', 1234567), 'x1.234.567y');
  assert.equal(stats.renderStatsName('{count}', null), '?');
  assert.equal(stats.renderStatsName('a'.repeat(200), 1).length, 100);
});
