import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'npcutils-social-'));
const db = await import('../src/db.js');
const s = await import('../src/features/socialAlerts.js');
const { cleanAccount } = await import('../src/features/socialStats.js');
db.load();

test('account names are cleaned from @ and profile URLs', () => {
  assert.equal(cleanAccount('@Test'), 'Test');
  assert.equal(cleanAccount('https://www.tiktok.com/@test'), 'test');
  assert.equal(cleanAccount('https://youtube.com/@MrBeast'), 'MrBeast');
  assert.equal(cleanAccount('https://twitch.tv/xqc'), 'xqc');
});

const YOUTUBE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns:media="http://search.yahoo.com/mrss/" xmlns="http://www.w3.org/2005/Atom">
 <title>Test Channel</title>
 <entry>
  <id>yt:video:abc123</id>
  <yt:videoId>abc123</yt:videoId>
  <title>Novi &amp; sjajan video</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=abc123"/>
  <published>2026-11-07T10:00:00+00:00</published>
  <media:group><media:thumbnail url="https://i.ytimg.com/vi/abc123/hqdefault.jpg"/></media:group>
 </entry>
</feed>`;

const YOUTUBE_LIVE = `<html><script>var ytInitialPlayerResponse = {"videoDetails":{"videoId":"live123","title":"LIVE test","isLive":true}};</script></html>`;

const TIKTOK_HTML = `<html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
  __DEFAULT_SCOPE__: {
    'webapp.user-detail': {
      userInfo: {
        user: { uniqueId: 'test', nickname: 'Test', signature: 'Bok', roomId: '', avatarLarger: 'https://example.com/a.jpg' },
        statsV2: { followerCount: '1234', videoCount: '56' },
      },
    },
  },
})}</script></html>`;

test('YouTube RSS parsing', () => {
  const feed = s.parseYouTubeFeed(YOUTUBE_FEED);
  assert.equal(feed.channelTitle, 'Test Channel');
  assert.equal(feed.latest.videoId, 'abc123');
  assert.equal(feed.latest.title, 'Novi & sjajan video');
  assert.equal(feed.latest.publishedAt, Date.parse('2026-11-07T10:00:00+00:00'));
  assert.match(feed.latest.thumbnail, /abc123/);
});

test('YouTube live parsing', () => {
  const live = s.parseYouTubeLive(YOUTUBE_LIVE);
  assert.equal(live.live, true);
  assert.equal(live.videoId, 'live123');
  assert.equal(live.title, 'LIVE test');
  assert.equal(s.parseYouTubeLive('<html></html>').live, false);
});

test('TikTok profile parsing', () => {
  const data = s.parseTikTokProfile(TIKTOK_HTML);
  assert.equal(data.account, 'test');
  assert.equal(data.name, 'Test');
  assert.equal(data.followers, 1234);
  assert.equal(data.videos, 56);
  assert.equal(data.live, false);
  const live = s.parseTikTokProfile(TIKTOK_HTML.replace('"roomId":""', '"roomId":"123"'));
  assert.equal(live.live, true);
});

test('Twitch uptime parsing', () => {
  assert.equal(s.parseTwitchUptime('xqc is offline').live, false);
  assert.equal(s.parseTwitchUptime('xqc has been live for 2 hours').live, true);
  assert.equal(s.parseTwitchUptime('user not found').live, false);
});

test('config normalizes accounts and deduplicates them', () => {
  const cfg = s.normalizeConfig({
    enabled: true,
    channelId: 'c1',
    accounts: [
      { platform: 'youtube', account: '@Test', events: { live: false } },
      { platform: 'youtube', account: 'test' },
      { platform: 'twitch', account: 'xqc' },
      { platform: 'nope', account: 'x' },
    ],
  });
  assert.equal(cfg.accounts.length, 2);
  assert.equal(cfg.accounts[0].account, 'Test');
  assert.equal(cfg.accounts[0].events.upload, true);
  assert.equal(cfg.accounts[0].events.live, false);
  assert.deepEqual(cfg.accounts[1].events, { live: true });
});

test('per-platform channels are normalized and fall back to the main channel', () => {
  const cfg = s.normalizeConfig({
    enabled: true,
    channelId: 'main',
    channels: {
      'youtube:upload': 'yt-videos',
      'twitch:live': 'twitch-live',
      'nope:event': 'ignored',
    },
  });
  assert.equal(cfg.channels['youtube:upload'], 'yt-videos');
  assert.equal(cfg.channels['twitch:live'], 'twitch-live');
  assert.equal(cfg.channels['nope:event'], undefined);
  assert.equal(s.channelFor(cfg, 'youtube', 'upload'), 'yt-videos');
  assert.equal(s.channelFor(cfg, 'tiktok', 'live'), 'main');
  assert.equal(s.hasChannel(cfg), true);
  assert.equal(s.hasChannel(s.normalizeConfig({ channels: { 'youtube:live': 'only' } })), true);
  assert.equal(s.hasChannel(s.normalizeConfig({})), false);
});

test('route channels can be saved and cleared', () => {
  s.saveConfig('g2', { channelId: 'main', channels: { 'youtube:upload': 'a', 'tiktok:live': 'b' } });
  let cfg = s.getConfig('g2');
  assert.equal(cfg.channels['youtube:upload'], 'a');
  assert.equal(cfg.channels['tiktok:live'], 'b');
  s.saveConfig('g2', { channels: { 'youtube:upload': null } });
  cfg = s.getConfig('g2');
  assert.equal(cfg.channels['youtube:upload'], undefined);
  assert.equal(cfg.channels['tiktok:live'], 'b');
  const guild = { channels: { cache: new Map([['main', { id: 'main' }], ['b', { id: 'b' }]]) } };
  assert.equal(s.targetChannel(guild, cfg, 'tiktok', 'live').id, 'b');
  assert.equal(s.targetChannel(guild, cfg, 'youtube', 'upload').id, 'main');
});
test('accounts can be added, updated and removed', () => {
  const account = s.addAccount('g1', { platform: 'youtube', account: '@test' });
  assert.equal(account.account, 'test');
  assert.throws(() => s.addAccount('g1', { platform: 'youtube', account: 'test' }), /već pratiš/);
  const updated = s.updateAccount('g1', account.id, { label: 'Moj kanal', events: { live: false } });
  assert.equal(updated.label, 'Moj kanal');
  assert.equal(updated.events.live, false);
  assert.equal(s.removeAccount('g1', account.id), true);
  assert.equal(s.removeAccount('g1', account.id), false);
});

test('notification payload is a card with mention, author, image and link buttons', () => {
  const account = { platform: 'twitch', account: 'xqc', label: 'xQc', events: { live: true }, state: {} };
  const payload = s.buildNotification({ roleId: 'r1', message: '' }, account, 'live', {
    title: 'Ranked',
    url: 'https://twitch.tv/xqc',
    game: 'Just Chatting',
    avatarUrl: 'https://example.com/a.jpg',
    thumbnail: s.twitchPreview('xQc', 0),
  });
  assert.equal(payload.content, '<@&r1>\n**xQc** je počeo/la stream, brzo da svi pogledate!');
  assert.deepEqual(payload.allowedMentions, { roles: ['r1'] });
  const embed = payload.embeds[0].toJSON();
  assert.equal(embed.title, 'Ranked');
  assert.equal(embed.url, 'https://twitch.tv/xqc');
  assert.equal(embed.author.name, 'xQc');
  assert.equal(embed.author.icon_url, 'https://example.com/a.jpg');
  assert.match(embed.image.url, /live_user_xqc-1280x720/);
  assert.match(embed.description, /Just Chatting/);
  const buttons = payload.components[0].toJSON().components;
  assert.equal(buttons[0].label, 'Gledaj stream');
  assert.equal(buttons[0].url, 'https://twitch.tv/xqc');
  assert.equal(buttons[1].url, 'https://www.twitch.tv/xqc');
});

test('notification supports @everyone and keeps custom links from previewing twice', () => {
  const account = { platform: 'tiktok', account: 'antea', label: 'Antea', events: { upload: true }, state: {} };
  const url = 'https://www.tiktok.com/@antea/video/7704834703446117662';
  const payload = s.buildNotification({ roleId: 'everyone', message: '{account}: {title}\\n{url}' }, account, 'upload', {
    title: 'andja napada',
    url,
    thumbnail: 'https://example.com/cover.jpg',
  });
  assert.equal(payload.content, `@everyone\nAntea: andja napada\n<${url}>`);
  assert.deepEqual(payload.allowedMentions, { parse: ['everyone'] });
  const embed = payload.embeds[0].toJSON();
  assert.equal(embed.image.url, 'https://example.com/cover.jpg');
  assert.equal(payload.components[0].toJSON().components[0].label, 'Pogledaj video');
  const plain = s.buildNotification({ message: '' }, account, 'upload', {});
  assert.deepEqual(plain.allowedMentions, { parse: [] });
  assert.equal(plain.embeds[0].toJSON().url, 'https://www.tiktok.com/@antea');
  assert.equal(plain.components[0].toJSON().components.length, 1);
});

const TIKTOK_EMBED = `<html><script id="__FRONTITY_CONNECT_STATE__" type="application/json">${JSON.stringify({
  source: {
    data: {
      '/embed/@antea': {
        videoList: [
          { id: '7600000000000000000', desc: 'Prikvačeni', coverUrl: 'https://example.com/old.jpg', authorUniqueId: 'antea' },
          { id: '7704834703446117662', desc: 'andja opasno napala japanca', coverUrl: 'https://example.com/new.jpg', authorUniqueId: 'antea' },
          { id: '7700000000000000000', desc: 'Stariji', coverUrl: 'https://example.com/mid.jpg', authorUniqueId: 'antea' },
        ],
      },
    },
  },
})}</script></html>`;

test('TikTok embed parsing picks the newest video, not the pinned one', () => {
  const { latest } = s.parseTikTokEmbed(TIKTOK_EMBED);
  assert.equal(latest.videoId, '7704834703446117662');
  assert.equal(latest.title, 'andja opasno napala japanca');
  assert.equal(latest.url, 'https://www.tiktok.com/@antea/video/7704834703446117662');
  assert.equal(latest.thumbnail, 'https://example.com/new.jpg');
  assert.ok(latest.publishedAt > Date.parse('2020-01-01'));
  assert.equal(s.parseTikTokEmbed('<html></html>').latest, null);
  assert.equal(s.isNewerId('7704834703446117662', '7700000000000000000'), true);
  assert.equal(s.isNewerId('7700000000000000000', '7704834703446117662'), false);
});

test('YouTube avatar is read from channel pages', () => {
  const html = '{"avatar":{"thumbnails":[{"url":"https://yt3.ggpht.com/abc-DEF_1=s48-c-k-c0x00ffffff-no-rj"}]}}';
  assert.equal(s.parseYouTubeAvatar(html), 'https://yt3.ggpht.com/abc-DEF_1=s176-c-k-c0x00ffffff-no-rj');
  assert.equal(s.parseYouTubeAvatar('<html></html>'), null);
});
