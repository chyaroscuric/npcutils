import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'npcutils-freegames-'));
const db = await import('../src/db.js');
const fg = await import('../src/features/freeGames.js');
db.load();

const EPIC = {
  data: {
    Catalog: {
      searchStore: {
        elements: [
          {
            id: 'free1',
            title: 'Free Game',
            description: 'Besplatna igra',
            productSlug: 'free-game',
            price: { totalPrice: { discountPrice: 0, originalPrice: 1999 } },
            promotions: { promotionalOffers: [{ promotionalOffers: [{ startDate: '2026-11-01T00:00:00Z', endDate: '2026-11-08T00:00:00Z' }] }] },
            keyImages: [{ type: 'Thumbnail', url: 'https://example.com/free.jpg' }],
          },
          {
            id: 'paid1',
            title: 'Paid Game',
            price: { totalPrice: { discountPrice: 999, originalPrice: 1999 } },
            promotions: { promotionalOffers: [{ promotionalOffers: [{ endDate: '2026-11-08T00:00:00Z' }] }] },
          },
          {
            id: 'f2p',
            title: 'Free to Play',
            price: { totalPrice: { discountPrice: 0, originalPrice: 0 } },
            promotions: { promotionalOffers: [{ promotionalOffers: [{ endDate: '2026-11-08T00:00:00Z' }] }] },
          },
        ],
      },
    },
  },
};

const STEAM = [
  { id: 1, title: 'Free Steam Game', type: 'Game', status: 'Active', description: 'Opis', open_giveaway_url: 'https://example.com/1', end_date: '2026-11-12 23:59:00', worth: '$9.99' },
  { id: 2, title: 'Free DLC', type: 'DLC', status: 'Active', open_giveaway_url: 'https://example.com/2' },
  { id: 3, title: 'Expired Game', type: 'Game', status: 'Expired', open_giveaway_url: 'https://example.com/3' },
  { id: 4, title: 'Early Access Game', type: 'Early Access', status: 'Active', worth: '$9.99', open_giveaway_url: 'https://example.com/4' },
  { id: 5, title: 'Playtest', type: 'Early Access', status: 'Active', worth: 'N/A', open_giveaway_url: 'https://example.com/5' },
];

test('Epic parser keeps only currently free paid games', () => {
  const games = fg.parseEpicFreeGames(EPIC);
  assert.equal(games.length, 1);
  assert.equal(games[0].title, 'Free Game');
  assert.equal(games[0].url, 'https://store.epicgames.com/en-US/p/free-game');
  assert.equal(games[0].worth, '$19.99');
  assert.match(games[0].endText, /^<t:\d+:R>$/);
});

test('Steam parser keeps active games and early access, not DLC or expired', () => {
  const games = fg.parseSteamGiveaways(STEAM);
  assert.deepEqual(games.map((g) => g.title), ['Free Steam Game', 'Early Access Game']);
  assert.equal(games[0].id, 'steam:1');
  assert.match(games[0].endText, /^<t:\d+:R>$/);
});

test('newSince returns only unseen IDs', () => {
  const current = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.deepEqual(fg.newSince(current, ['a', 'c']).map((g) => g.id), ['b']);
  assert.deepEqual(fg.newSince(current, []).map((g) => g.id), ['a', 'b', 'c']);
});

test('free game config normalizes and saves', () => {
  const cfg = fg.normalizeConfig({ enabled: true, channelId: 'c1', epic: false, lastEpic: ['a', 'a'] });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.epic, false);
  assert.equal(cfg.steam, true);
  assert.deepEqual(cfg.lastEpic, ['a']);
  const saved = fg.saveConfig('g1', { enabled: true, channelId: 'c1', steam: false, message: 'Novo!' });
  assert.equal(saved.channelId, 'c1');
  assert.equal(saved.steam, false);
  assert.equal(fg.getConfig('g1').message, 'Novo!');
});

test('payload includes enabled platforms and links', () => {
  const payload = fg.buildFreeGamesPayload(
    { epic: true, steam: true, roleId: 'r1', message: 'Novo na serveru!' },
    { epic: fg.parseEpicFreeGames(EPIC), steam: fg.parseSteamGiveaways(STEAM) },
  );
  assert.equal(payload.content, '<@&r1>');
  const embed = payload.embeds[0].toJSON();
  assert.match(embed.description, /Novo na serveru/);
  assert.equal(embed.fields.length, 2);
  assert.match(embed.fields[0].value, /Free Game/);
  assert.match(embed.fields[1].value, /Free Steam Game/);
});
