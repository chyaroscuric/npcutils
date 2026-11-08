import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvas } from '@napi-rs/canvas';
import { BANNER_SIZE, normalizeBanner, processBannerImage, renderWelcomeBanner } from '../src/features/welcomeBanner.js';

test('banner config is normalized', () => {
  const banner = normalizeBanner({
    enabled: true,
    backgroundUrl: 'https://example.com/bg.png',
    title: '  Dobrodošao/la kod {server}  ',
    subtitle: '  Novi član  ',
    accentColor: '#f0f',
    nameColor: 'nije-boja',
    overlay: 2,
  });
  assert.equal(banner.enabled, true);
  assert.equal(banner.backgroundUrl, 'https://example.com/bg.png');
  assert.equal(banner.title, 'Dobrodošao/la kod {server}');
  assert.equal(banner.subtitle, 'Novi član');
  assert.equal(banner.accentColor, '#ff00ff');
  assert.equal(banner.nameColor, '#1f2937');
  assert.equal(banner.overlay, 0.8);
});

test('invalid background URLs are ignored', () => {
  assert.equal(normalizeBanner({ backgroundUrl: 'javascript:alert(1)' }).backgroundUrl, '');
  assert.equal(normalizeBanner({ backgroundUrl: 'ftp://example.com/a.png' }).backgroundUrl, '');
});

test('banner defaults can be overridden per message type', () => {
  const banner = normalizeBanner(undefined, { title: 'Dovidenja od {server}', subtitle: 'Ostalo nas je {memberCount}.' });
  assert.equal(banner.title, 'Dovidenja od {server}');
  assert.equal(banner.subtitle, 'Ostalo nas je {memberCount}.');
  assert.equal(banner.enabled, false);
});

test('banner layout positions and sizes are clamped', () => {
  const banner = normalizeBanner({
    avatarX: -1,
    avatarY: 2,
    avatarSize: 5,
    nameX: 0.4,
    nameY: 0.6,
    nameSize: 0.01,
    showTitle: false,
    showSubtitle: false,
  });
  assert.equal(banner.avatarX, 0);
  assert.equal(banner.avatarY, 1);
  assert.equal(banner.avatarSize, 0.4);
  assert.equal(banner.nameX, 0.4);
  assert.equal(banner.nameY, 0.6);
  assert.equal(banner.nameSize, 0.03);
  assert.equal(banner.showTitle, false);
  assert.equal(banner.showSubtitle, false);
});

test('banner renders a PNG without a background or avatar', async () => {
  const buffer = await renderWelcomeBanner({
    name: 'Mario',
    serverName: 'SKY',
    title: 'Dobrodošao/la kod {server}',
    subtitle: 'Novi član · {memberCount}.',
    memberCount: 42,
    avatarUrl: '',
  });
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 1000);
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(BANNER_SIZE.width, 1024);
  assert.equal(BANNER_SIZE.height, 512);
});

test('uploaded images are cropped into a data URL', async () => {
  const source = createCanvas(64, 64);
  const ctx = source.getContext('2d');
  ctx.fillStyle = '#ff00aa';
  ctx.fillRect(0, 0, 64, 64);
  const dataUrl = await processBannerImage(source.toBuffer('image/png'));
  assert.match(dataUrl, /^data:image\/jpeg;base64,/);
  const banner = normalizeBanner({ enabled: true, backgroundUrl: dataUrl });
  assert.equal(banner.backgroundUrl, dataUrl);
  assert.equal(banner.enabled, true);
});
