// Server cloning: wipes a destination server and rebuilds the roles, channels and (optionally) the
// profile, emojis and this bot's settings of a source server. Messages and members are not copied.
import { ChannelType, OverwriteType } from 'discord.js';
import * as db from '../db.js';
import { UserError } from '../utils/helpers.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PAUSE = 300; // be gentle with Discord's rate limits

const sessions = new Map(); // userId -> { sourceId, targetId, options }
const running = new Set(); // target guild ids being cloned

export function session(userId) {
  if (!sessions.has(userId)) sessions.set(userId, { sourceId: null, targetId: null, options: null });
  return sessions.get(userId);
}

export const endSession = (userId) => sessions.delete(userId);

// Checks everything that has to hold before (and right before) a clone; returns { source, target }.
export async function validate(client, userId) {
  const s = session(userId);
  if (!s.sourceId || !s.targetId) {
    throw new UserError(
      `Nedostaju postavke:\n• Izvor: ${s.sourceId ? `\`${s.sourceId}\`` : '**nije postavljen** (`/klon izvor`)'}\n` +
        `• Cilj: ${s.targetId ? `\`${s.targetId}\`` : '**nije postavljen** (`/klon cilj`)'}`,
    );
  }
  if (s.sourceId === s.targetId) throw new UserError('Izvor i cilj ne mogu biti isti server.');
  const source = client.guilds.cache.get(s.sourceId);
  const target = client.guilds.cache.get(s.targetId);
  if (!source || !target) throw new UserError('Bot mora biti na oba servera.');
  if (target.ownerId !== userId) throw new UserError(`Moraš biti vlasnik ciljnog servera (**${target.name}**).`);
  const sourceMember = await source.members.fetch(userId).catch(() => null);
  if (!sourceMember?.permissions.has('Administrator')) {
    throw new UserError(`Moraš imati Administrator na izvornom serveru (**${source.name}**).`);
  }
  if (!target.members.me.permissions.has('Administrator')) {
    throw new UserError(`Bot treba Administrator na ciljnom serveru (**${target.name}**).`);
  }
  if (running.has(target.id)) throw new UserError('Kloniranje na taj server već traje.');
  return { source, target };
}

// What a clone would do, for the confirmation message.
export function plan(source, target) {
  const isRole = (guild) => (r) => r.id !== guild.id && !r.managed;
  return {
    deleteChannels: target.channels.cache.filter((c) => !c.isThread()).size,
    deleteRoles: target.roles.cache.filter((r) => isRole(target)(r) && r.editable).size,
    createRoles: source.roles.cache.filter(isRole(source)).size,
    createChannels: source.channels.cache.filter((c) => !c.isThread()).size,
    emojis: source.emojis.cache.filter((e) => !e.managed).size,
  };
}

function channelOptions(ch, target, hasCommunity, parent, permissionOverwrites) {
  let type = ch.type;
  if (!hasCommunity) {
    // these need a Community server; fall back to the closest normal type
    if ([ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia].includes(type)) type = ChannelType.GuildText;
    else if (type === ChannelType.GuildStageVoice) type = ChannelType.GuildVoice;
  }
  const options = { name: ch.name, type, parent, permissionOverwrites };
  if ([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia].includes(type)) {
    options.topic = ch.topic ?? undefined;
    options.nsfw = ch.nsfw;
    options.rateLimitPerUser = ch.rateLimitPerUser ?? undefined;
    options.defaultAutoArchiveDuration = ch.defaultAutoArchiveDuration ?? undefined;
  }
  if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(type)) {
    options.bitrate = Math.min(ch.bitrate || 64000, target.maximumBitrate);
    options.userLimit = ch.userLimit;
    options.videoQualityMode = ch.videoQualityMode ?? undefined;
    if (ch.rtcRegion) options.rtcRegion = ch.rtcRegion;
  }
  if ([ChannelType.GuildForum, ChannelType.GuildMedia].includes(type)) {
    options.defaultSortOrder = ch.defaultSortOrder ?? undefined;
    options.defaultForumLayout = ch.defaultForumLayout ?? undefined;
    if (ch.availableTags?.length) {
      options.availableTags = ch.availableTags.map((tag) => ({
        name: tag.name,
        moderated: tag.moderated,
        ...(tag.emoji?.name && !tag.emoji.id ? { emoji: { name: tag.emoji.name } } : {}),
      }));
    }
    if (ch.defaultReactionEmoji?.name && !ch.defaultReactionEmoji.id) options.defaultReactionEmoji = { name: ch.defaultReactionEmoji.name };
  }
  return options;
}

// Moves this bot's own settings over, pointing them at the new channels and roles.
export function copyBotSettings(sourceId, targetId, roleMap, channelMap) {
  const src = db.guild(sourceId);
  const dst = db.guild(targetId);
  const ch = (id) => (id ? channelMap.get(id) ?? null : null);
  const role = (id) => (id ? roleMap.get(id) ?? null : null);
  const c = src.config;
  const config = {};
  for (const key of ['welcome', 'boost']) {
    if (c[key] && ch(c[key].channelId)) config[key] = { ...c[key], channelId: ch(c[key].channelId) };
  }
  if (c.autoroles?.length) config.autoroles = c.autoroles.map(role).filter(Boolean);
  if (c.tickets && ch(c.tickets.categoryId)) {
    config.tickets = { categoryId: ch(c.tickets.categoryId), supportRoleId: role(c.tickets.supportRoleId), logChannelId: ch(c.tickets.logChannelId) };
  }
  if (c.stats && ch(c.stats.categoryId)) {
    config.stats = Object.fromEntries(Object.entries(c.stats).map(([k, id]) => [k, ch(id)]));
  }
  if (c.modLogChannelId) config.modLogChannelId = ch(c.modLogChannelId);
  if (c.antinuke) {
    config.antinuke = { ...c.antinuke, logChannelId: ch(c.antinuke.logChannelId), whitelistRoles: (c.antinuke.whitelistRoles ?? []).map(role).filter(Boolean) };
  }
  dst.config = config;
}

// The target's own data points at channels/roles/messages that no longer exist after the wipe.
// Without copied settings only anti-nuke stays (minus its log channel and roles), so protection is not lost.
function resetTargetData(targetId, { configCopied }) {
  const g = db.guild(targetId);
  if (!configCopied) {
    const antinuke = g.config.antinuke;
    g.config = antinuke ? { antinuke: { ...antinuke, logChannelId: null, whitelistRoles: [] } } : {};
  }
  g.reactionRoles = {};
  g.giveaways = {};
  g.tickets = { counter: 0, open: {} };
  g.kaladont = {};
}

export async function cloneServer({ source, target, keepChannelId, options, progress }) {
  running.add(target.id);
  const failed = [];
  try {
    // 1. wipe the destination
    await progress('⏳ 1/6: Brišem kanale na ciljnom serveru…');
    const protectedChannels = [];
    for (const channel of target.channels.cache.filter((c) => !c.isThread()).values()) {
      if (channel.id === keepChannelId) continue;
      // rules / updates channels of a Community server cannot be deleted while they are in use
      await channel.delete('Kloniranje servera').catch(() => protectedChannels.push(channel));
      await sleep(PAUSE);
    }
    await progress('⏳ 2/6: Brišem role na ciljnom serveru…');
    for (const role of target.roles.cache.values()) {
      if (role.id === target.id || role.managed || !role.editable) continue;
      await role.delete('Kloniranje servera').catch(() => failed.push(`brisanje role ${role.name}`));
      await sleep(PAUSE);
    }

    // 2. profile
    const hasCommunity = target.features.includes('COMMUNITY');
    if (options.profile) {
      await progress('⏳ 3/6: Kopiram ime, ikonu i opis servera…');
      await target.setName(source.name).catch(() => failed.push('ime servera'));
      if (source.icon) await target.setIcon(source.iconURL({ extension: 'png', size: 1024 })).catch(() => failed.push('ikona servera'));
      if (source.description && hasCommunity) await target.setDescription(source.description).catch(() => {});
    }

    // 3. roles, highest first, then fix the order
    await progress('⏳ 4/6: Stvaram role…');
    const roleMap = new Map([[source.id, target.id]]);
    await target.roles.everyone.setPermissions(source.roles.everyone.permissions.bitfield).catch(() => failed.push('@everyone dozvole'));
    const sourceRoles = [...source.roles.cache.filter((r) => r.id !== source.id && !r.managed).values()];
    for (const role of [...sourceRoles].sort((a, b) => b.position - a.position)) {
      const created = await target.roles
        .create({
          name: role.name,
          // gradient role colours only work on servers that have that feature
          colors: target.features.includes('ENHANCED_ROLE_COLORS') ? role.colors : { primaryColor: role.colors.primaryColor },
          hoist: role.hoist,
          permissions: role.permissions.bitfield,
          mentionable: role.mentionable,
          reason: 'Kloniranje servera',
        })
        .catch(() => failed.push(`rola ${role.name}`) && null);
      if (created) roleMap.set(role.id, created.id);
      await sleep(PAUSE);
    }
    const positions = [...sourceRoles]
      .sort((a, b) => a.position - b.position)
      .map((role, index) => ({ role: roleMap.get(role.id), position: index + 1 }))
      .filter((p) => p.role);
    if (positions.length) await target.roles.setPositions(positions).catch(() => failed.push('redoslijed rola (moja rola mora biti na vrhu)'));

    // 4. channels: categories first, then the rest in order
    await progress('⏳ 5/6: Stvaram kanale i dozvole…');
    const channelMap = new Map();
    const overwritesOf = (ch) =>
      ch.permissionOverwrites.cache
        .map((o) => {
          const id = o.type === OverwriteType.Role ? roleMap.get(o.id) : target.members.cache.has(o.id) ? o.id : null;
          return id ? { id, type: o.type, allow: o.allow.bitfield, deny: o.deny.bitfield } : null;
        })
        .filter(Boolean);
    const byPosition = (a, b) => a.rawPosition - b.rawPosition;
    const categories = [...source.channels.cache.filter((c) => c.type === ChannelType.GuildCategory).values()].sort(byPosition);
    for (const cat of categories) {
      const created = await target.channels
        .create({ name: cat.name, type: ChannelType.GuildCategory, permissionOverwrites: overwritesOf(cat), reason: 'Kloniranje servera' })
        .catch(() => failed.push(`kategorija ${cat.name}`) && null);
      if (created) channelMap.set(cat.id, created.id);
      await sleep(PAUSE);
    }
    const others = [...source.channels.cache.filter((c) => c.type !== ChannelType.GuildCategory && !c.isThread()).values()].sort(byPosition);
    for (const ch of others) {
      const parent = ch.parentId ? channelMap.get(ch.parentId) ?? null : null;
      const created = await target.channels
        .create({ ...channelOptions(ch, target, hasCommunity, parent, overwritesOf(ch)), reason: 'Kloniranje servera' })
        .catch(() => failed.push(`kanal ${ch.name}`) && null);
      if (created) channelMap.set(ch.id, created.id);
      await sleep(PAUSE);
    }

    // 5. special channels, emojis, bot settings
    await progress('⏳ 6/6: Povezujem posebne kanale, emojije i postavke bota…');
    const link = async (id, set) => channelMap.get(id) && (await set(channelMap.get(id)).catch(() => {}));
    if (hasCommunity) {
      await link(source.rulesChannelId, (id) => target.setRulesChannel(id));
      await link(source.publicUpdatesChannelId, (id) => target.setPublicUpdatesChannel(id));
    }
    await link(source.systemChannelId, (id) => target.setSystemChannel(id));
    if (source.afkChannelId) await link(source.afkChannelId, (id) => target.setAFKChannel(id));
    for (const channel of protectedChannels) {
      await channel.delete('Kloniranje servera').catch(() => failed.push(`brisanje kanala ${channel.name}`));
      await sleep(PAUSE);
    }

    let emojis = 0;
    if (options.emojis) {
      const existing = new Set(target.emojis.cache.map((e) => e.name));
      for (const emoji of source.emojis.cache.filter((e) => !e.managed && !existing.has(e.name)).values()) {
        const ok = await target.emojis
          .create({ attachment: emoji.imageURL({ extension: emoji.animated ? 'gif' : 'png' }), name: emoji.name, reason: 'Kloniranje servera' })
          .then(() => true, () => false);
        if (ok) emojis++;
        else {
          failed.push('dio emojija (nema više mjesta ili limit)');
          break;
        }
        await sleep(PAUSE);
      }
    }

    if (options.botSettings) copyBotSettings(source.id, target.id, roleMap, channelMap);
    resetTargetData(target.id, { configCopied: options.botSettings });
    db.save();

    return { roles: roleMap.size - 1, channels: channelMap.size, emojis, failed: [...new Set(failed)] };
  } finally {
    running.delete(target.id);
  }
}
