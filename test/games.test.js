import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jaankeza-games-'));
const { COUNTRIES, CONTINENTS } = await import('../src/data/countries.js');
const { WORDS } = await import('../src/data/words.js');
const { isCorrect } = await import('../src/features/games/flags.js');
const { score, validateGuess } = await import('../src/features/games/wordle.js');
const { checkMove } = await import('../src/features/games/kaladont.js');
const { isWord, useWords } = await import('../src/features/games/dictionary.js');
const { shipPercent, shipName } = await import('../src/features/games/ship.js');

test('country data is complete', () => {
  assert.ok(COUNTRIES.length >= 195);
  assert.equal(new Set(COUNTRIES.map((c) => c.iso2)).size, COUNTRIES.length);
  for (const c of COUNTRIES) {
    assert.match(c.iso2, /^[a-z]{2}$/);
    assert.ok(c.hr && c.en && CONTINENTS[c.continent], c.iso2);
  }
});

test('flag answers accept Croatian, English and aliases', () => {
  const find = (iso) => COUNTRIES.find((c) => c.iso2 === iso);
  assert.ok(isCorrect(find('si'), 'Slovenija'));
  assert.ok(isCorrect(find('si'), 'slovenia'));
  assert.ok(isCorrect(find('ba'), 'BiH'));
  assert.ok(isCorrect(find('us'), 'sad'));
  assert.ok(isCorrect(find('cz'), 'ceska'));
  assert.ok(isCorrect(find('hr'), '  HRVATSKA! '));
  assert.ok(!isCorrect(find('si'), 'Slovačka'));
});

test('wordle words are 5 letters', () => {
  for (const w of WORDS) assert.equal(Array.from(w).length, 5, w);
});

test('wordle colouring handles repeated letters', () => {
  assert.deepEqual(score('kakao', 'kokos'), ['correct', 'absent', 'correct', 'absent', 'present']);
  assert.deepEqual(score('ababa', 'baaab'), ['present', 'present', 'correct', 'present', 'present']);
  assert.deepEqual(score('aaaab', 'baaaa'), ['present', 'correct', 'correct', 'correct', 'present']);
  assert.deepEqual(score('aabbb', 'abccc'), ['correct', 'absent', 'present', 'absent', 'absent']);
  assert.deepEqual(score('kuća', 'kuća'), ['correct', 'correct', 'correct', 'correct']);
  assert.equal(validateGuess('abc'), 'Riječ mora imati točno 5 slova.');
});

test('kaladont move rules', () => {
  useWords(new Set(['kokos', 'osoba', 'banana', 'kaladont']));
  const game = { lastWord: 'kokos', lastUserId: '1', used: ['kokos'], streak: 1 };
  assert.match(checkMove(game, '1', 'osoba').title, /Nije tvoj red/);
  assert.match(checkMove(game, '2', 'banana').title, /Krivi početak/);
  assert.match(checkMove(game, '2', 'os').title, /Prekratko/);
  assert.match(checkMove(game, '2', 'osmijeh').title, /Ne poznajem/);
  assert.equal(checkMove(game, '2', 'osoba'), null);
  assert.match(checkMove({ ...game, lastWord: 'osoba', used: ['kokos', 'osoba'] }, '3', 'baobab')?.title ?? '', /Ne poznajem/);
});

test('ship is deterministic', () => {
  assert.equal(shipPercent('1', '2'), shipPercent('2', '1'));
  assert.ok(shipPercent('1', '2') >= 0 && shipPercent('1', '2') <= 100);
  assert.equal(shipName('Ana', 'Marko'), 'Anrko');
});

test('letters without diacritics count as the same letter', () => {
  const find = (iso) => COUNTRIES.find((c) => c.iso2 === iso);
  assert.ok(isCorrect(find('dj'), 'dzibuti'));
  assert.ok(isCorrect(find('cz'), 'ceska republika'));
  assert.deepEqual(score('cekic', 'čekić'), ['correct', 'correct', 'correct', 'correct', 'correct']);
  assert.deepEqual(score('kuca', 'kuća'), ['correct', 'correct', 'correct', 'correct']);

  useWords(new Set(['kuća', 'ćevap', 'đak', 'čaša']));
  const game = { lastWord: 'kuća', lastUserId: '1', used: ['kuća'], streak: 1 };
  assert.equal(checkMove(game, '2', 'casa'), null); // "ća" -> "ca", čaša typed without diacritics
  assert.equal(checkMove({ ...game, lastWord: 'kuca', used: ['kuca'] }, '2', 'čaša'), null);
  assert.match(checkMove({ ...game, used: ['kuća', 'čaša'] }, '2', 'casa').title, /Već iskorišteno/);
  assert.ok(isWord('djak') && isWord('dak') && isWord('cevap'));
  assert.ok(!isWord('kuka'));
});
