import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'npcutils-similarity-'));
const { similarity, similarityLabel, lexicalScore, SECRET_WORDS } = await import('../src/features/games/similarity.js');
const { validateGuess } = await import('../src/features/games/toplo.js');

test('exact word is 100%', () => {
  assert.equal(similarity('škola', 'skola'), 100);
  assert.equal(similarity('učenik', 'ucenik'), 100);
});

test('related words are warmer than unrelated words', () => {
  const related = similarity('škola', 'učenik');
  const unrelated = similarity('škola', 'more');
  assert.ok(related >= 55, `related=${related}`);
  assert.ok(unrelated < 20, `unrelated=${unrelated}`);
  assert.ok(related > unrelated);
});

test('similarity is symmetric and bounded', () => {
  for (const [a, b] of [['škola', 'učenik'], ['more', 'plaža'], ['pas', 'mačka'], ['auto', 'cesta']]) {
    assert.equal(similarity(a, b), similarity(b, a));
    assert.ok(similarity(a, b) >= 0 && similarity(a, b) <= 100);
  }
});

test('lexical closeness helps unknown words', () => {
  assert.ok(lexicalScore('škola', 'škole') > lexicalScore('škola', 'more'));
  assert.ok(similarity('škola', 'škole') > similarity('škola', 'more'));
});

test('labels describe the temperature', () => {
  assert.match(similarityLabel(100), /vruće/);
  assert.match(similarityLabel(80), /toplo/);
  assert.match(similarityLabel(55), /mlako/);
  assert.match(similarityLabel(30), /hladno/);
  assert.match(similarityLabel(0), /ledeno/);
});

test('secret words are usable', () => {
  assert.ok(SECRET_WORDS.length > 100);
  assert.ok(SECRET_WORDS.every((word) => word.length >= 4 && word.length <= 12));
});

test('guess validation rejects duplicates and invalid words', () => {
  const game = { secret: 'škola', guesses: [{ word: 'učenik', percent: 60 }] };
  assert.match(validateGuess(game, 'učenik'), /već/);
  assert.match(validateGuess(game, 'a'), /barem/);
  assert.match(validateGuess(game, '123'), /samo slova/);
  assert.equal(validateGuess(game, 'razred'), null);
});
