// Member join (autorole + welcome message) and boost messages.
import { EmbedBuilder } from 'discord.js';
import * as db from '../db.mjs';
import { COLOR, COLOR_BOOST, fillTemplate, roleProblem } from '../utils/helpers.mjs';
import * as invites from './invites.mjs';

export const DEFAULT_WELCOME =
  'Dobrodošao/la {user} na **{server}**! 🎉\nTi si naš **{memberCount}.** član.\nPozvao/la te: {inviter}';
export const DEFAULT_BOOST = 'Hvala {user} što je boostao/la **{server}**! 💜\nServer sada ima **{boosts}** boostova (level {level}).';

export async function giveAutoroles(member) {
  const g = db.guild(member.guild.id);
  const roles = (g.config.autoroles ?? [])
    .map((id) => member.guild.roles.cache.get(id))
    .filter((role) => role && !roleProblem(member.guild, role));
  if (roles.length) await member.roles.add(roles, 'Jaankeza Utils autorole');
}

export function welcomePayload(member, inviterId) {
  const g = db.guild(member.guild.id);
  const cfg = g.config.welcome;
  const inviterStats = inviterId ? invites.stats(g, inviterId) : null;
  const text = fillTemplate(cfg?.message || DEFAULT_WELCOME, {
    user: `${member}`,
    username: member.user.username,
    server: member.guild.name,
    memberCount: member.guild.memberCount,
    inviter: inviterId ? `<@${inviterId}>` : 'nepoznato',
    invites: inviterStats?.total ?? 0,
  });
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: member.guild.name, iconURL: member.guild.iconURL() ?? undefined })
    .setTitle('👋 Novi član!')
    .setDescription(text)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setTimestamp();
  return { content: `${member}`, embeds: [embed], allowedMentions: { users: [member.id] } };
}

export async function sendWelcome(member, inviterId) {
  const cfg = db.guild(member.guild.id).config.welcome;
  const channel = cfg?.channelId && member.guild.channels.cache.get(cfg.channelId);
  if (!channel) return;
  await channel.send(welcomePayload(member, inviterId));
}

export function boostPayload(member) {
  const guild = member.guild;
  const cfg = db.guild(guild.id).config.boost;
  const text = fillTemplate(cfg?.message || DEFAULT_BOOST, {
    user: `${member}`,
    username: member.user.username,
    server: guild.name,
    boosts: guild.premiumSubscriptionCount ?? 0,
    level: guild.premiumTier,
  });
  const embed = new EmbedBuilder()
    .setColor(COLOR_BOOST)
    .setTitle('🚀 Novi boost!')
    .setDescription(text)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setTimestamp();
  return { content: `${member}`, embeds: [embed], allowedMentions: { users: [member.id] } };
}

export async function onMemberUpdate(oldMember, newMember) {
  // premiumSince goes from null to a date when someone starts boosting
  if (oldMember.partial || oldMember.premiumSinceTimestamp || !newMember.premiumSinceTimestamp) return;
  const cfg = db.guild(newMember.guild.id).config.boost;
  const channel = cfg?.channelId && newMember.guild.channels.cache.get(cfg.channelId);
  if (!channel) return;
  // boost count on the guild object updates slightly later than the member update
  await new Promise((r) => setTimeout(r, 3000));
  await channel.send(boostPayload(newMember));
}
