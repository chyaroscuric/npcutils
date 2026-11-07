import assert from 'node:assert/strict';
import test from 'node:test';
import { BANNER_SIZE, normalizeBanner, renderWelcomeBanner } from '../src/features/welcomeBanner.js';

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
