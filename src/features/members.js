// Member join (autorole + welcome message) and boost messages.
import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import * as db from '../db.js';
import { COLOR, COLOR_BOOST, fillTemplate, roleProblem } from '../utils/helpers.js';
import * as invites from './invites.js';
import { normalizeBanner, renderWelcomeBanner } from './welcomeBanner.js';

export const DEFAULT_WELCOME =
  'Dobrodošao/la {user} na **{server}**! 🎉\nTi si naš **{memberCount}.** član.\nPozvao/la te: {inviter}';
export const DEFAULT_BOOST = 'Hvala {user} što je boostao/la **{server}**! 💜\nServer sada ima **{boosts}** boostova (level {level}).';
export const DEFAULT_GOODBYE = '👋 **{username}** je napustio/la **{server}**.\nOstalo nas je **{memberCount}**.';
export const GOODBYE_BANNER = { title: 'Dovidenja od {server}', subtitle: 'Ostalo nas je {memberCount}.' };

export async function giveAutoroles(member) {
  const g = db.guild(member.guild.id);
  const roles = (g.config.autoroles ?? [])
    .map((id) => member.guild.roles.cache.get(id))
    .filter((role) => role && !roleProblem(member.guild, role));
  if (roles.length) await member.roles.add(roles, `${member.guild.client.user.username}: autorole`);
}

export function welcomePayload(member, inviterId, { banner = null } = {}) {
  const g = db.guild(member.guild.id);
  const cfg = g.config.welcome;
  if (banner && normalizeBanner(cfg?.banner).onlyImage) {
    return { files: [new AttachmentBuilder(banner, { name: 'welcome.png' })] };
  }
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
  if (cfg?.imageUrl) embed.setImage(cfg.imageUrl);
  const payload = { content: `${member}`, embeds: [embed], allowedMentions: { users: [member.id] } };
  if (banner) {
    embed.setImage('attachment://welcome.png');
    payload.files = [new AttachmentBuilder(banner, { name: 'welcome.png' })];
  }
  return payload;
}

// Adds the generated banner when the server enabled one; falls back to the
// normal embed if the background or avatar cannot be downloaded.
export async function buildWelcomePayload(member, inviterId) {
  const cfg = db.guild(member.guild.id).config.welcome;
  const bannerCfg = normalizeBanner(cfg?.banner);
  if (!bannerCfg.enabled || !bannerCfg.backgroundUrl) return welcomePayload(member, inviterId);
  try {
    const banner = await renderWelcomeBanner({
      backgroundUrl: bannerCfg.backgroundUrl,
      avatarUrl: member.user.displayAvatarURL({ extension: 'png', size: 512 }),
      name: member.displayName ?? member.user.username,
      serverName: member.guild.name,
      title: bannerCfg.title,
      subtitle: bannerCfg.subtitle,
      accentColor: bannerCfg.accentColor,
      nameColor: bannerCfg.nameColor,
      overlay: bannerCfg.overlay,
      showTitle: bannerCfg.showTitle,
      showSubtitle: bannerCfg.showSubtitle,
      avatarX: bannerCfg.avatarX,
      avatarY: bannerCfg.avatarY,
      avatarSize: bannerCfg.avatarSize,
      nameX: bannerCfg.nameX,
      nameY: bannerCfg.nameY,
      nameSize: bannerCfg.nameSize,
      nameWidth: bannerCfg.nameWidth,
      memberCount: member.guild.memberCount,
    });
    return welcomePayload(member, inviterId, { banner });
  } catch (err) {
    console.warn('[welcome] banner:', err.message);
    return welcomePayload(member, inviterId);
  }
}

export async function sendWelcome(member, inviterId) {
  const cfg = db.guild(member.guild.id).config.welcome;
  const channel = cfg?.channelId && member.guild.channels.cache.get(cfg.channelId);
  if (!channel) return;
  await channel.send(await buildWelcomePayload(member, inviterId));
}

export function goodbyePayload(member, { banner = null } = {}) {
  const g = db.guild(member.guild.id);
  const cfg = g.config.goodbye;
  if (banner && normalizeBanner(cfg?.banner, GOODBYE_BANNER).onlyImage) {
    return { files: [new AttachmentBuilder(banner, { name: 'goodbye.png' })] };
  }
  const inviterId = g.joins[member.id]?.inviterId ?? null;
  const inviterStats = inviterId ? invites.stats(g, inviterId) : null;
  const username = member.user?.username ?? 'Nepoznat član';
  const joined = member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'nepoznato';
  const text = fillTemplate(cfg?.message || DEFAULT_GOODBYE, {
    user: username,
    username,
    server: member.guild.name,
    memberCount: member.guild.memberCount,
    inviter: inviterId ? `<@${inviterId}>` : 'nepoznato',
    invites: inviterStats?.total ?? 0,
    joined,
  });
  const embed = new EmbedBuilder()
    .setColor(0x747f8d)
    .setAuthor({ name: member.guild.name, iconURL: member.guild.iconURL() ?? undefined })
    .setTitle('👋 Član je otišao')
    .setDescription(text)
    .setTimestamp();
  if (member.user?.displayAvatarURL) embed.setThumbnail(member.user.displayAvatarURL({ size: 256 }));
  if (cfg?.imageUrl) embed.setImage(cfg.imageUrl);
  const payload = { embeds: [embed], allowedMentions: { parse: [] } };
  if (banner) {
    embed.setImage('attachment://goodbye.png');
    payload.files = [new AttachmentBuilder(banner, { name: 'goodbye.png' })];
  }
  return payload;
}

export async function buildGoodbyePayload(member) {
  const cfg = db.guild(member.guild.id).config.goodbye;
  const bannerCfg = normalizeBanner(cfg?.banner, GOODBYE_BANNER);
  if (!bannerCfg.enabled || !bannerCfg.backgroundUrl) return goodbyePayload(member);
  try {
    const banner = await renderWelcomeBanner({
      backgroundUrl: bannerCfg.backgroundUrl,
      avatarUrl: member.user.displayAvatarURL({ extension: 'png', size: 512 }),
      name: member.displayName ?? member.user.username,
      serverName: member.guild.name,
      title: bannerCfg.title,
      subtitle: bannerCfg.subtitle,
      accentColor: bannerCfg.accentColor,
      nameColor: bannerCfg.nameColor,
      overlay: bannerCfg.overlay,
      showTitle: bannerCfg.showTitle,
      showSubtitle: bannerCfg.showSubtitle,
      avatarX: bannerCfg.avatarX,
      avatarY: bannerCfg.avatarY,
      avatarSize: bannerCfg.avatarSize,
      nameX: bannerCfg.nameX,
      nameY: bannerCfg.nameY,
      nameSize: bannerCfg.nameSize,
      nameWidth: bannerCfg.nameWidth,
      memberCount: member.guild.memberCount,
    });
    return goodbyePayload(member, { banner });
  } catch (err) {
    console.warn('[goodbye] banner:', err.message);
    return goodbyePayload(member);
  }
}

export async function sendGoodbye(member) {
  const cfg = db.guild(member.guild.id).config.goodbye;
  const channel = cfg?.channelId && member.guild.channels.cache.get(cfg.channelId);
  if (!channel) return;
  await channel.send(await buildGoodbyePayload(member));
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
  if (cfg?.imageUrl) embed.setImage(cfg.imageUrl);
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
