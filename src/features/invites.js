// Invite tracking: compares invite usage before/after a member joins to find out who invited them.
import { PermissionFlagsBits } from 'discord.js';
import * as db from '../db.js';

// Accounts younger than this are counted as "fake" invites.
const FAKE_ACCOUNT_AGE = 7 * 24 * 60 * 60 * 1000;

const cache = new Map(); // guildId -> Map(code -> { uses, inviterId, maxUses, deleted })

function canTrack(guild) {
  return guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild);
}

function toEntry(invite) {
  return { uses: invite.uses ?? 0, inviterId: invite.inviterId ?? invite.inviter?.id ?? null, maxUses: invite.maxUses ?? 0 };
}

export async function cacheGuildInvites(guild) {
  if (!canTrack(guild)) {
    console.warn(`[invites] Nemam "Manage Server" permisiju na ${guild.name}, invite counter neće raditi.`);
    return;
  }
  const invites = await guild.invites.fetch();
  cache.set(guild.id, new Map(invites.map((i) => [i.code, toEntry(i)])));
}

export function onInviteCreate(invite) {
  if (!invite.guild) return;
  if (!cache.has(invite.guild.id)) cache.set(invite.guild.id, new Map());
  cache.get(invite.guild.id).set(invite.code, toEntry(invite));
}

export function onInviteDelete(invite) {
  const entry = invite.guild && cache.get(invite.guild.id)?.get(invite.code);
  if (!entry) return;
  // A single-use invite is deleted right when it is used, sometimes before guildMemberAdd arrives,
  // so keep it around for a bit to still be able to match it.
  entry.deleted = true;
  setTimeout(() => {
    if (cache.get(invite.guild.id)?.get(invite.code) === entry) cache.get(invite.guild.id).delete(invite.code);
  }, 30_000).unref();
}

export function stats(g, userId) {
  const s = g.invites[userId] ?? { regular: 0, left: 0, fake: 0, bonus: 0 };
  return { ...s, total: s.regular - s.left + s.bonus };
}

function bump(g, userId, field, amount = 1) {
  const s = (g.invites[userId] ??= { regular: 0, left: 0, fake: 0, bonus: 0 });
  s[field] += amount;
}

// Returns { inviterId, code } (inviterId can be null if it could not be determined).
export async function onMemberJoin(member) {
  const guild = member.guild;
  if (!canTrack(guild)) return { inviterId: null, code: null };

  const before = cache.get(guild.id);
  const current = await guild.invites.fetch().catch(() => null);
  if (!current) return { inviterId: null, code: null };
  if (!before) {
    // Nothing to compare against yet; start tracking from now on.
    cache.set(guild.id, new Map(current.map((i) => [i.code, toEntry(i)])));
    return { inviterId: null, code: null };
  }

  let used = current.find((inv) => (inv.uses ?? 0) > (before.get(inv.code)?.uses ?? 0));
  let usedEntry = used ? toEntry(used) : null;
  if (!used) {
    // Invite was probably deleted after reaching its max uses.
    const gone = [...before.entries()].filter(
      ([code, e]) => !current.has(code) && e.maxUses > 0 && e.uses + 1 >= e.maxUses,
    );
    if (gone.length === 1) usedEntry = { ...gone[0][1], code: gone[0][0] };
  }

  const fresh = new Map(current.map((i) => [i.code, toEntry(i)]));
  // keep recently deleted entries for matching
  for (const [code, e] of before) if (e.deleted && !fresh.has(code)) fresh.set(code, e);
  cache.set(guild.id, fresh);

  const code = used?.code ?? usedEntry?.code ?? null;
  const inviterId = usedEntry?.inviterId ?? null;
  const g = db.guild(guild.id);
  const fake = Date.now() - member.user.createdTimestamp < FAKE_ACCOUNT_AGE;

  if (inviterId) {
    bump(g, inviterId, fake ? 'fake' : 'regular');
    g.joins[member.id] = { inviterId, code, fake, at: Date.now() };
  } else {
    g.joins[member.id] = { inviterId: null, code: null, fake, at: Date.now() };
  }
  db.save();
  return { inviterId, code };
}

export function onMemberLeave(member) {
  const g = db.guild(member.guild.id);
  const join = g.joins[member.id];
  if (!join) return;
  if (join.inviterId && !join.fake) bump(g, join.inviterId, 'left');
  delete g.joins[member.id];
  db.save();
}

export function addBonus(guildId, userId, amount) {
  const g = db.guild(guildId);
  bump(g, userId, 'bonus', amount);
  db.save();
  return stats(g, userId);
}

export function reset(guildId, userId) {
  const g = db.guild(guildId);
  if (userId) delete g.invites[userId];
  else g.invites = {};
  db.save();
}

export function leaderboard(guildId, limit = 10) {
  const g = db.guild(guildId);
  return Object.keys(g.invites)
    .map((id) => ({ id, ...stats(g, id) }))
    .filter((s) => s.total > 0 || s.regular > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}
