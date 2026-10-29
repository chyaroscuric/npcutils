// Voice channels at the top of the server that show member / bot / boost counts.
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import * as db from '../db.js';

export const STATS = {
  members: { label: 'Članovi', name: (n) => `👥 Članovi: ${n}` },
  bots: { label: 'Botovi', name: (n) => `🤖 Botovi: ${n}` },
  boosts: { label: 'Boostovi', name: (n) => `🚀 Boostovi: ${n}` },
};

// Discord allows only 2 channel renames per 10 minutes, so each channel is renamed at most every ~5 min.
const MIN_RENAME_INTERVAL = 5 * 60 * 1000 + 5000;
const lastRename = new Map(); // channelId -> timestamp
const scheduled = new Map(); // guildId -> timeout
const running = new Set(); // guildIds currently updating
const dirty = new Set(); // guildIds that changed while updating

export function computeStats(guild) {
  return {
    members: guild.memberCount,
    bots: guild.members.cache.filter((m) => m.user.bot).size,
    boosts: guild.premiumSubscriptionCount ?? 0,
  };
}

export function scheduleStatsUpdate(guild, delay = 5000) {
  if (!db.guild(guild.id).config.stats) return;
  if (scheduled.has(guild.id)) return;
  scheduled.set(
    guild.id,
    setTimeout(() => {
      scheduled.delete(guild.id);
      updateStats(guild).catch((err) => console.error('[stats]', err));
    }, delay),
  );
}

export async function updateStats(guild) {
  const cfg = db.guild(guild.id).config.stats;
  if (!cfg) return;
  if (running.has(guild.id)) {
    dirty.add(guild.id);
    return;
  }
  running.add(guild.id);
  let retryIn = 0;
  try {
    const values = computeStats(guild);
    for (const [key, stat] of Object.entries(STATS)) {
      const channel = cfg[key] && guild.channels.cache.get(cfg[key]);
      if (!channel) continue;
      const name = stat.name(values[key]);
      if (channel.name === name) continue;
      const wait = (lastRename.get(channel.id) ?? 0) + MIN_RENAME_INTERVAL - Date.now();
      if (wait > 0) {
        retryIn = Math.max(retryIn, wait);
        continue;
      }
      lastRename.set(channel.id, Date.now());
      await channel.setName(name, 'Jaankeza Utils statistika');
    }
  } finally {
    running.delete(guild.id);
  }
  if (dirty.delete(guild.id)) scheduleStatsUpdate(guild);
  if (retryIn) scheduleStatsUpdate(guild, retryIn + 1000);
}

export async function setupStats(guild) {
  const g = db.guild(guild.id);
  await removeStats(guild);
  const values = computeStats(guild);
  const locked = [
    { id: guild.id, deny: [PermissionFlagsBits.Connect] },
    {
      id: guild.members.me.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels],
    },
  ];
  const category = await guild.channels.create({
    name: '📊 Statistika servera',
    type: ChannelType.GuildCategory,
    position: 0,
    permissionOverwrites: locked,
  });
  const cfg = { categoryId: category.id };
  for (const [key, stat] of Object.entries(STATS)) {
    const channel = await guild.channels.create({
      name: stat.name(values[key]),
      type: ChannelType.GuildVoice,
      parent: category.id,
      permissionOverwrites: locked,
    });
    cfg[key] = channel.id;
    lastRename.set(channel.id, Date.now());
  }
  g.config.stats = cfg;
  db.save();
  return cfg;
}

export async function removeStats(guild) {
  const g = db.guild(guild.id);
  const cfg = g.config.stats;
  if (!cfg) return false;
  for (const id of [...Object.keys(STATS).map((k) => cfg[k]), cfg.categoryId]) {
    const channel = id && guild.channels.cache.get(id);
    if (channel) await channel.delete('Jaankeza Utils statistika uklonjena').catch(() => {});
  }
  delete g.config.stats;
  db.save();
  return true;
}
