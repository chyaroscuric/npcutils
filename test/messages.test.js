import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMessagePayload, normalizeFields, parseColor } from '../src/features/messages.js';

test('color parsing accepts hex with and without #', () => {
  assert.equal(parseColor('#5865f2'), 0x5865f2);
  assert.equal(parseColor('5865f2'), 0x5865f2);
  assert.equal(parseColor(''), 0x5865f2);
  assert.throws(() => parseColor('plava'), /heksadecimalna/);
});

test('plain content message', () => {
  const payload = buildMessagePayload({ content: '  Bok svima!  ' });
  assert.equal(payload.content, 'Bok svima!');
  assert.equal(payload.embeds, undefined);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

test('embed fields are trimmed, filtered and capped', () => {
  const fields = normalizeFields([
    { name: '  Pravilo  ', value: '  Budi pristojan.  ', inline: true },
    { name: '', value: 'bez naziva' },
    { name: 'Bez vrijednosti', value: '   ' },
  ]);
  assert.deepEqual(fields, [{ name: 'Pravilo', value: 'Budi pristojan.', inline: true }]);
});

test('embed payload contains title, description, fields and images', () => {
  const payload = buildMessagePayload({
    content: 'Obavijest',
    embed: {
      enabled: true,
      title: 'Dobrodošli',
      description: 'Pročitaj pravila.',
      color: '#22c55e',
      author: 'Staff',
      footer: 'NPC Utils',
      imageUrl: 'https://example.com/slika.png',
      thumbnailUrl: 'https://example.com/ikona.png',
      url: 'https://example.com',
      timestamp: true,
      fields: [{ name: 'Pravilo 1', value: 'Budi pristojan.', inline: true }],
    },
  });
  assert.equal(payload.content, 'Obavijest');
  const embed = payload.embeds[0].toJSON();
  assert.equal(embed.title, 'Dobrodošli');
  assert.equal(embed.description, 'Pročitaj pravila.');
  assert.equal(embed.color, 0x22c55e);
  assert.equal(embed.fields[0].name, 'Pravilo 1');
  assert.equal(embed.image.url, 'https://example.com/slika.png');
  assert.equal(embed.thumbnail.url, 'https://example.com/ikona.png');
  assert.ok(embed.timestamp);
});

test('empty messages and invalid URLs are rejected', () => {
  assert.throws(() => buildMessagePayload({ content: '' }), /Upiši tekst/);
  assert.throws(() => buildMessagePayload({ embed: { enabled: true, title: 'Samo naslov', imageUrl: 'nije-url' } }), /http/);
  assert.throws(() => buildMessagePayload({ embed: { enabled: true } }), /barem naslov/);
});

test('too many fields are capped and oversized embeds rejected', () => {
  const fields = Array.from({ length: 30 }, (_, i) => ({ name: `Polje ${i}`, value: 'x' }));
  const payload = buildMessagePayload({ embed: { enabled: true, title: 'Veliki', fields } });
  assert.equal(payload.embeds[0].toJSON().fields.length, 25);
  assert.throws(() => buildMessagePayload({
    embed: { enabled: true, description: 'x'.repeat(4096), fields: [{ name: 'a', value: 'y'.repeat(1024) }, { name: 'b', value: 'z'.repeat(1024) }] },
  }), /predugačak/);
});
