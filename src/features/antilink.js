// Anti-link: deletes messages with links or Discord invites from regular members.
// Moderators, the owner, whitelisted roles and whitelisted channels are exempt.
import { PermissionFlagsBits } from 'discord.js';
import * as db from '../db.js';
import { modLog } from './moderation.js';

const EXEMPT_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
].reduce((all, bit) => all | bit, 0n);

// discord.gg/..., discord.com/invite/..., dsc.gg/... and similar invite links
const INVITE_RE = /(?:https?:\/\/)?(?:www\.)?(?:discord\.(?:gg|io|me|li)|discord(?:app)?\.com\/(?:invite|servers)|dsc\.gg|invite\.gg)\/[^\s<>()]+/i;
// http(s):// links, www. links and bare domains with a common TLD
const LINK_RE = /(?:https?:\/\/|www\.)[^\s<>()]+|\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|gg|me|rs|hr|ba|info|xyz|dev|app|co|uk|de|fr|eu|tv|ly|to|link|site|online|store|club|shop|live|pro|art|fun|space|website|tech|ai|edu|gov|mil|cloud|page)\b(?:[/?#][^\s<>()]*)?/i;

const NOTICE_MS = 6000;

export function defaultConfig() {
  return {
    enabled: true,
    blockLinks: true,
    blockInvites: true,
    notify: true,
    whitelistRoles: [],
    whitelistChannels: [],
  };
}

// Stored config merged over defaults, so new options get sane values.
export function getConfig(guildId) {
  return { ...defaultConfig(), ...(db.guild(guildId).config.antilink ?? {}) };
}

// Validates and stores a (partial) config coming from the dashboard or a command.
export function saveConfig(guildId, input) {
  const next = getConfig(guildId);
  for (const key of ['enabled', 'blockLinks', 'blockInvites', 'notify']) {
    if (key in input) next[key] = Boolean(input[key]);
  }
  if (Array.isArray(input.whitelistRoles)) next.whitelistRoles = [...new Set(input.whitelistRoles.map(String))].slice(0, 100);
  if (Array.isArray(input.whitelistChannels)) next.whitelistChannels = [...new Set(input.whitelistChannels.map(String))].slice(0, 100);
  db.guild(guildId).config.antilink = next;
  db.save();
  return next;
}

// Which rule the message breaks, or null when it is allowed.
export function findBlocked(message, cfg = getConfig(message.guild.id)) {
  if (!cfg.enabled) return null;
  const content = message.content ?? '';
  if (!content) return null;
  if (cfg.blockInvites && INVITE_RE.test(content)) return 'invite';
  if (cfg.blockLinks && LINK_RE.test(content)) return 'link';
  return null;
}

export function isExempt(member, channel, cfg) {
  const guild = member.guild;
  if (!guild || member.id === guild.ownerId || member.id === guild.client.user.id) return true;
  if (member.permissions.has(EXEMPT_PERMISSIONS)) return true;
  if (cfg.whitelistRoles.some((id) => member.roles.cache.has(id))) return true;
  const channelIds = [channel?.id, channel?.parentId].filter(Boolean);
  return channelIds.some((id) => cfg.whitelistChannels.includes(id));
}

export async function onMessage(message) {
  if (!message.inGuild() || message.author.bot) return false;
  const cfg = getConfig(message.guild.id);
  const reason = findBlocked(message, cfg);
  if (!reason) return false;
  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (!member || isExempt(member, message.channel, cfg)) return false;

  try {
    await message.delete();
  } catch (err) {
    console.warn('[antilink] Ne mogu obrisati poruku:', err.message);
    return false;
  }

  const what = reason === 'invite' ? 'Discord pozivnica' : 'link';
  await modLog(message.guild, {
    action: 'Obrisan link',
    target: member,
    moderator: message.guild.members.me,
    reason: `${what} nije dopušten/a članovima bez moderatorskih dozvola.`,
    extra: String(message.content ?? '').slice(0, 200) || null,
  });

  if (cfg.notify) {
    const notice = await message.channel
      .send({
        content: `<@${member.id}> ${what} nije dopušten/a na ovom serveru, pa je poruka obrisana.`,
        allowedMentions: { users: [member.id] },
      })
      .catch(() => null);
    if (notice) setTimeout(() => notice.delete().catch(() => {}), NOTICE_MS).unref();
  }
  return true;
}
