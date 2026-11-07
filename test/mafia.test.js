import assert from 'node:assert/strict';
import test from 'node:test';
import { roleDistribution, winnerFor } from '../src/features/games/mafia.js';

test('mafia role distribution grows with player count', () => {
  assert.deepEqual(roleDistribution(4), ['mafia', 'detective', 'doctor', 'citizen']);
  assert.deepEqual(roleDistribution(6), ['mafia', 'mafia', 'detective', 'doctor', 'dama', 'citizen']);
  assert.deepEqual(roleDistribution(9), ['mafia', 'mafia', 'mafia', 'detective', 'doctor', 'dama', 'citizen', 'citizen', 'citizen']);
  assert.equal(roleDistribution(15).length, 15);
  assert.equal(roleDistribution(15).filter((r) => r === 'mafia').length, 3);
});

test('mafia win conditions', () => {
  const p = (role, alive = true) => ({ role, alive });
  assert.equal(winnerFor([p('mafia'), p('citizen')]), 'mafia');
  assert.equal(winnerFor([p('mafia'), p('citizen'), p('citizen')]), null);
  assert.equal(winnerFor([p('mafia'), p('citizen'), p('doctor')]), null);
  assert.equal(winnerFor([p('mafia', false), p('citizen')]), 'town');
  assert.equal(winnerFor([p('mafia', false), p('mafia', false), p('citizen')]), 'town');
});
