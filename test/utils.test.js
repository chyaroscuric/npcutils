import assert from 'node:assert/strict';
import test from 'node:test';
import { parseDuration } from '../src/utils/duration.js';
import { fillTemplate } from '../src/utils/helpers.js';
import { emojiKey, parseEmoji } from '../src/features/reactionRoles.js';

test('parseDuration', () => {
  assert.equal(parseDuration('10s'), 10_000);
  assert.equal(parseDuration('30m'), 30 * 60_000);
  assert.equal(parseDuration('1d 12h'), 36 * 3600_000);
  assert.equal(parseDuration('1w'), 7 * 24 * 3600_000);
  assert.equal(parseDuration('abc'), null);
  assert.equal(parseDuration('10'), null);
  assert.equal(parseDuration('0m'), null);
});

test('fillTemplate', () => {
  assert.equal(fillTemplate('Hej {user} na {server}!\\n{nope}', { user: '<@1>', server: 'NPC' }), 'Hej <@1> na NPC!\n{nope}');
});

test('parseEmoji', () => {
  assert.deepEqual(parseEmoji('<:pepe:123456789012345678>'), {
    key: '123456789012345678',
    react: '123456789012345678',
    display: '<:pepe:123456789012345678>',
  });
  assert.equal(parseEmoji('❤️').key, emojiKey({ id: null, name: '❤' }));
  assert.equal(parseEmoji('🎮').key, '🎮');
  assert.equal(parseEmoji('hello'), null);
  assert.equal(parseEmoji(''), null);
});
