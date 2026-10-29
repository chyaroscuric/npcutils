import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Collection } from 'discord.js';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'jaankeza-utils-'));
const db = await import('../src/db.js');
const invites = await import('../src/features/invites.js');
db.load();

function fakeGuild(list) {
  const guild = {
    id: 'g1',
    name: 'Test',
    members: { me: { permissions: { has: () => true } } },
    invites: { fetch: async () => new Collection(list().map((i) => [i.code, i])) },
  };
  return guild;
}
const member = (id, guild, ageDays = 100) => ({
  id,
  guild,
  user: { createdTimestamp: Date.now() - ageDays * 864e5 },
});

test('credits the inviter, counts leaves and fakes', async () => {
  let state = [
    { code: 'aaa', uses: 3, inviterId: 'alice', maxUses: 0 },
    { code: 'bbb', uses: 0, inviterId: 'bob', maxUses: 1 },
  ];
  const guild = fakeGuild(() => state);
  await invites.cacheGuildInvites(guild);

  state = [{ ...state[0], uses: 4 }, state[1]];
  assert.deepEqual(await invites.onMemberJoin(member('m1', guild)), { inviterId: 'alice', code: 'aaa' });

  // single-use invite disappears after being used
  invites.onInviteDelete({ guild, code: 'bbb' });
  state = [state[0]];
  assert.equal((await invites.onMemberJoin(member('m2', guild))).inviterId, 'bob');

  state = [{ ...state[0], uses: 5 }];
  await invites.onMemberJoin(member('m3', guild, 1)); // brand new account -> fake

  invites.onMemberLeave(member('m1', guild));
  const g = db.guild('g1');
  assert.deepEqual(invites.stats(g, 'alice'), { regular: 1, left: 1, fake: 1, bonus: 0, total: 0 });
  assert.equal(invites.stats(g, 'bob').total, 1);
  assert.equal(invites.addBonus('g1', 'alice', 5).total, 5);
  assert.deepEqual(invites.leaderboard('g1').map((s) => s.id), ['alice', 'bob']);
  db.flush();
});
