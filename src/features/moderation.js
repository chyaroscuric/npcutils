// Basic moderation: hierarchy checks, warnings and the moderation log.
import { EmbedBuilder } from 'discord.js';
import * as db from '../db.js';
import { UserError } from '../utils/helpers.js';
import { logActivity } from './activity.js';

const COLOR_MOD = 0xfee75c;

// Throws when `moderator` (or the bot) may not act on `target`.
export function assertCanModerate(moderator, target, action) {
  const guild = moderator.guild;
  if (!target) return;
  if (target.id === moderator.id) throw new UserError(`Ne možeš ${action} samog/samu sebe.`);
  if (target.id === guild.ownerId) throw new UserError(`Ne možeš ${action} vlasnika servera.`);
  if (target.id === guild.members.me.id) throw new UserError('Ne mogu to napraviti samom sebi.');
  if (moderator.id !== guild.ownerId && moderator.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    throw new UserError(`${target} ima jednaku ili višu rolu od tebe.`);
  }
  if (guild.members.me.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    throw new UserError(`${target} ima jednaku ili višu rolu od mene. Pomakni moju rolu više.`);
  }
}

export function warns(guildId, userId) {
  return db.guild(guildId).warns?.[userId] ?? [];
}

export function addWarn(guildId, userId, moderatorId, reason) {
  const g = db.guild(guildId);
  g.warns ??= {};
  const list = (g.warns[userId] ??= []);
  list.push({ id: (list.at(-1)?.id ?? 0) + 1, by: moderatorId, reason, at: Date.now() });
  db.save();
  return list;
}

export function clearWarns(guildId, userId, warnId) {
  const g = db.guild(guildId);
  const list = g.warns?.[userId] ?? [];
  const next = warnId ? list.filter((w) => w.id !== warnId) : [];
  if (next.length === list.length && list.length) throw new UserError(`Upozorenje #${warnId} ne postoji.`);
  g.warns ??= {};
  if (next.length) g.warns[userId] = next;
  else delete g.warns[userId];
  db.save();
  return list.length - next.length;
}

// Posts to the moderation log channel (if set) and the dashboard activity feed.
export async function modLog(guild, { action, target, moderator, reason, extra }) {
  logActivity(guild.id, 'moderation', `${moderator.username ?? moderator.user?.username}: ${action} ${target?.username ?? target?.user?.username ?? ''}`.trim());
  const channelId = db.guild(guild.id).config.modLogChannelId;
  const channel = channelId && guild.channels.cache.get(channelId);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setColor(COLOR_MOD)
    .setTitle(`🔨 ${action}`)
    .addFields(
      ...(target ? [{ name: 'Korisnik', value: `<@${target.id}> (${target.user?.username ?? target.username ?? target.id})`, inline: true }] : []),
      { name: 'Moderator', value: `<@${moderator.id}>`, inline: true },
      ...(extra ? [{ name: 'Detalji', value: extra, inline: true }] : []),
      { name: 'Razlog', value: reason || 'Nije naveden' },
    )
    .setTimestamp();
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
}
