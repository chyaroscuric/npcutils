// Anti-nuke: watches the audit log for mass bans/kicks/deletes and other dangerous actions,
// punishes whoever did them and (optionally) undoes the damage.
import { AuditLogEvent, EmbedBuilder, PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import * as db from '../db.mjs';
import { logActivity } from './activity.mjs';

const COLOR_ALERT = 0xed4245;
const MAX_INCIDENTS = 30;
const SNAPSHOT_TTL = 5 * 60 * 1000;
const TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000; // Discord's maximum timeout

export const RULES = {
  ban: { label: 'Anti ban', limited: true },
  kick: { label: 'Anti kick', limited: true },
  roleCreate: { label: 'Anti role create', limited: true },
  roleDelete: { label: 'Anti role delete', limited: true },
  channelCreate: { label: 'Anti channel create', limited: true },
  channelDelete: { label: 'Anti channel delete', limited: true },
  mention: { label: 'Anti mention (@everyone/@here)', limited: true },
  botAdd: { label: 'Anti bot add', limited: false },
  prune: { label: 'Anti prune', limited: false },
  dangerousRoleUpdate: { label: 'Anti dangerous role permission update', limited: false },
  dangerousRoleAdd: { label: 'Anti dangerous role add', limited: false },
};

export const limitText = (limit) => (limit <= 1 ? 'kazna već kod 1. akcije' : `kazna kod ${limit}. akcije`);

export const PUNISHMENTS = {
  ban: 'Ban',
  kick: 'Kick',
  strip: 'Oduzmi sve role',
  timeout: 'Timeout (28 dana)',
  none: 'Samo zabilježi',
};

const DEFAULT_LIMITS = { ban: 1, kick: 1, roleCreate: 3, roleDelete: 2, channelCreate: 3, channelDelete: 2, mention: 0 };

export const DANGEROUS_PERMISSIONS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ModerateMembers,
].reduce((all, bit) => all | bit, 0n);

export function defaultConfig() {
  return {
    enabled: false,
    logChannelId: null,
    windowSec: 60,
    revert: true,
    whitelistUsers: [],
    whitelistRoles: [],
    rules: Object.fromEntries(
      Object.entries(RULES).map(([key, rule]) => [
        key,
        {
          enabled: true,
          ...(rule.limited ? { limit: DEFAULT_LIMITS[key] } : {}),
          punishment: key === 'mention' ? 'timeout' : 'ban',
        },
      ]),
    ),
  };
}

// Stored config merged over defaults, so rules added later get sane values.
export function getConfig(guildId) {
  const stored = db.guild(guildId).config.antinuke ?? {};
  const base = defaultConfig();
  return {
    ...base,
    ...stored,
    rules: Object.fromEntries(Object.keys(RULES).map((key) => [key, { ...base.rules[key], ...stored.rules?.[key] }])),
  };
}

// Validates and stores a (partial) config coming from a command or the dashboard.
export function saveConfig(guildId, input) {
  const current = getConfig(guildId);
  const next = { ...current };
  if ('enabled' in input) next.enabled = Boolean(input.enabled);
  if ('logChannelId' in input) next.logChannelId = input.logChannelId || null;
  if ('windowSec' in input) next.windowSec = Math.min(3600, Math.max(5, Math.round(Number(input.windowSec)) || 60));
  if ('revert' in input) next.revert = Boolean(input.revert);
  if (Array.isArray(input.whitelistUsers)) next.whitelistUsers = [...new Set(input.whitelistUsers.map(String))].slice(0, 100);
  if (Array.isArray(input.whitelistRoles)) next.whitelistRoles = [...new Set(input.whitelistRoles.map(String))].slice(0, 100);
  for (const [key, rule] of Object.entries(input.rules ?? {})) {
    if (!RULES[key]) continue;
    const merged = { ...next.rules[key] };
    if ('enabled' in rule) merged.enabled = Boolean(rule.enabled);
    if ('punishment' in rule && PUNISHMENTS[rule.punishment]) merged.punishment = rule.punishment;
    if (RULES[key].limited && 'limit' in rule) merged.limit = Math.min(50, Math.max(0, Math.round(Number(rule.limit)) || 0));
    next.rules[key] = merged;
  }
  db.guild(guildId).config.antinuke = next;
  db.save();
  return next;
}

export function incidents(guildId) {
  return db.guild(guildId).antinukeIncidents ?? [];
}

// Only the server owner may change anti-nuke settings: an admin who could edit them could whitelist themselves.
export const canConfigure = (guild, userId) => guild.ownerId === userId;

// ---------- tracking ----------
const history = new Map(); // `${guildId}:${userId}` -> { [action]: [{ at, targetId, extra }] }
const punishedUntil = new Map(); // `${guildId}:${userId}` -> timestamp
const deletedChannels = new Map(); // channelId -> snapshot
const deletedRoles = new Map(); // roleId -> snapshot

function remember(map, id, snapshot) {
  map.set(id, snapshot);
  setTimeout(() => map.delete(id), SNAPSHOT_TTL).unref();
}

export function onChannelDelete(channel) {
  if (!channel.guild) return;
  remember(deletedChannels, channel.id, {
    name: channel.name,
    type: channel.type,
    parent: channel.parentId,
    position: channel.rawPosition,
    topic: channel.topic ?? undefined,
    nsfw: channel.nsfw ?? undefined,
    rateLimitPerUser: channel.rateLimitPerUser ?? undefined,
    bitrate: channel.bitrate ?? undefined,
    userLimit: channel.userLimit ?? undefined,
    permissionOverwrites: channel.permissionOverwrites?.cache.map((o) => ({ id: o.id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield })),
  });
}

export function onRoleDelete(role) {
  remember(deletedRoles, role.id, {
    name: role.name,
    color: role.color,
    hoist: role.hoist,
    permissions: role.permissions.bitfield,
    mentionable: role.mentionable,
    position: role.position,
  });
}

async function isExempt(guild, userId) {
  if (!userId || userId === guild.client.user.id || userId === guild.ownerId) return true;
  const cfg = getConfig(guild.id);
  if (cfg.whitelistUsers.includes(userId)) return true;
  const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
  return Boolean(member?.roles.cache.some((r) => cfg.whitelistRoles.includes(r.id)));
}

// Records an action and punishes once it happened `limit` times within the window (limit 0 or 1 = the first time),
// or right away for instant rules.
async function track(guild, action, executorId, targetId, extra = {}) {
  const cfg = getConfig(guild.id);
  const rule = cfg.rules[action];
  if (!cfg.enabled || !rule?.enabled) return false;
  if (await isExempt(guild, executorId)) return false;

  const key = `${guild.id}:${executorId}`;
  const now = Date.now();
  const actions = (history.get(key) ?? {})[action] ?? [];
  const recent = [...actions.filter((a) => now - a.at < cfg.windowSec * 1000), { at: now, targetId, extra }];
  history.set(key, { ...history.get(key), [action]: recent });

  // visible in the console, so it is easy to check that the bot sees the audit log
  console.log(`[antinuke] ${guild.name}: ${action} od ${executorId} (${recent.length}/${RULES[action].limited ? Math.max(1, rule.limit) : 1})`);
  if (RULES[action].limited && recent.length < Math.max(1, rule.limit)) return false;
  const alreadyPunished = (punishedUntil.get(key) ?? 0) > now;
  punishedUntil.set(key, now + cfg.windowSec * 1000);
  // a nuker keeps going while being banned; undo the new damage but punish only once
  await respond(guild, cfg, action, executorId, recent, { punish: !alreadyPunished });
  return true;
}

async function punish(guild, userId, type, reason) {
  if (type === 'none') return 'samo zabilježeno';
  const member = guild.members.cache.get(userId) ?? (await guild.members.fetch(userId).catch(() => null));
  try {
    if (type === 'ban') {
      await guild.members.ban(userId, { reason, deleteMessageSeconds: 0 });
      return 'banan/a';
    }
    if (!member) return 'nije više na serveru';
    if (type === 'kick') await member.kick(reason);
    else if (type === 'timeout') await member.timeout(TIMEOUT_MS, reason);
    else if (type === 'strip') await member.roles.set(member.roles.cache.filter((r) => r.managed), reason);
    return { kick: 'kickan/a', timeout: 'dobio/la timeout', strip: 'ostao/la bez rola' }[type];
  } catch (err) {
    console.warn('[antinuke] punish', err.message);
    return 'NISAM MOGAO kazniti (vjerojatno ima višu rolu od mene)';
  }
}

async function revert(guild, action, entries, reason) {
  const results = [];
  for (const { targetId, extra } of entries) {
    try {
      if (action === 'ban') await guild.members.unban(targetId, reason);
      else if (action === 'roleCreate') await guild.roles.cache.get(targetId)?.delete(reason);
      else if (action === 'channelCreate') await guild.channels.cache.get(targetId)?.delete(reason);
      else if (action === 'botAdd') await guild.members.cache.get(targetId)?.kick(reason);
      else if (action === 'dangerousRoleUpdate') await guild.roles.cache.get(targetId)?.setPermissions(extra.oldPermissions, reason);
      else if (action === 'dangerousRoleAdd') await guild.members.cache.get(targetId)?.roles.remove(extra.roleIds, reason);
      else if (action === 'mention') await extra.message?.delete();
      else if (action === 'channelDelete') {
        const snap = deletedChannels.get(targetId);
        if (!snap) continue;
        await guild.channels.create({ ...snap, parent: guild.channels.cache.has(snap.parent) ? snap.parent : null, reason });
        deletedChannels.delete(targetId);
      } else if (action === 'roleDelete') {
        const snap = deletedRoles.get(targetId);
        if (!snap) continue;
        await guild.roles.create({ ...snap, reason });
        deletedRoles.delete(targetId);
      } else continue;
      results.push(targetId);
    } catch (err) {
      console.warn(`[antinuke] revert ${action}`, err.message);
    }
  }
  return results.length;
}

async function respond(guild, cfg, action, executorId, entries, { punish: doPunish }) {
  const rule = cfg.rules[action];
  const label = RULES[action].label;
  const reason = `Anti-nuke: ${label}`;
  const result = doPunish ? await punish(guild, executorId, rule.punishment, reason) : 'već kažnjen/a';
  const reverted = cfg.revert ? await revert(guild, action, doPunish ? entries : entries.slice(-1), reason) : 0;

  const executor = await guild.client.users.fetch(executorId).catch(() => null);
  const name = executor?.username ?? executorId;
  const g = db.guild(guild.id);
  g.antinukeIncidents = [
    { at: Date.now(), action, label, executor: { id: executorId, name }, count: entries.length, punishment: rule.punishment, result, reverted },
    ...(g.antinukeIncidents ?? []),
  ].slice(0, MAX_INCIDENTS);
  db.save();
  if (doPunish) logActivity(guild.id, 'antinuke', `Anti-nuke: ${name} (${label}) — ${result}`);
  if (!doPunish) return;

  const embed = new EmbedBuilder()
    .setColor(COLOR_ALERT)
    .setTitle('🛡️ Anti-nuke')
    .setDescription(`<@${executorId}> (${name}) je okinuo/la **${label}**.`)
    .addFields(
      { name: 'Akcija', value: RULES[action].limited ? `${entries.length}× u ${cfg.windowSec} s (limit ${rule.limit})` : 'odmah', inline: true },
      { name: 'Kazna', value: `${PUNISHMENTS[rule.punishment]} — ${result}`, inline: true },
      { name: 'Vraćeno', value: cfg.revert ? String(reverted) : 'isključeno', inline: true },
    )
    .setTimestamp();
  const logChannel = cfg.logChannelId && guild.channels.cache.get(cfg.logChannelId);
  await logChannel?.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
  // the owner should know even if the log channel was deleted in the attack
  const owner = await guild.fetchOwner().catch(() => null);
  await owner?.send({ content: `Upozorenje sa servera **${guild.name}**:`, embeds: [embed] }).catch(() => {});
}

// ---------- event entry points ----------
export async function onAuditLogEntry(entry, guild) {
  const { action, executorId, targetId, changes } = entry;
  switch (action) {
    case AuditLogEvent.MemberBanAdd:
      return track(guild, 'ban', executorId, targetId);
    case AuditLogEvent.MemberKick:
      return track(guild, 'kick', executorId, targetId);
    case AuditLogEvent.RoleCreate:
      return track(guild, 'roleCreate', executorId, targetId);
    case AuditLogEvent.RoleDelete:
      return track(guild, 'roleDelete', executorId, targetId);
    case AuditLogEvent.ChannelCreate:
      return track(guild, 'channelCreate', executorId, targetId);
    case AuditLogEvent.ChannelDelete:
      return track(guild, 'channelDelete', executorId, targetId);
    case AuditLogEvent.BotAdd:
      return track(guild, 'botAdd', executorId, targetId);
    case AuditLogEvent.MemberPrune:
      return track(guild, 'prune', executorId, null);
    case AuditLogEvent.RoleUpdate: {
      const change = changes.find((c) => c.key === 'permissions');
      if (!change) return;
      const added = BigInt(change.new ?? 0) & ~BigInt(change.old ?? 0);
      if (added & DANGEROUS_PERMISSIONS) {
        return track(guild, 'dangerousRoleUpdate', executorId, targetId, { oldPermissions: new PermissionsBitField(BigInt(change.old ?? 0)) });
      }
      return;
    }
    case AuditLogEvent.MemberRoleUpdate: {
      const added = changes.find((c) => c.key === '$add')?.new ?? [];
      const roleIds = added
        .map((r) => r.id)
        .filter((id) => (guild.roles.cache.get(id)?.permissions.bitfield ?? 0n) & DANGEROUS_PERMISSIONS);
      if (roleIds.length) return track(guild, 'dangerousRoleAdd', executorId, targetId, { roleIds });
      return;
    }
    default:
  }
}

export async function onMessage(message) {
  if (!message.inGuild() || !message.mentions.everyone) return;
  // without the permission Discord does not ping anyone, so it is harmless
  if (!message.member?.permissionsIn(message.channel).has(PermissionFlagsBits.MentionEveryone)) return;
  await track(message.guild, 'mention', message.author.id, message.id, { message });
}
