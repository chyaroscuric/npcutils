// Voice channels at the top of the server that show member / bot / boost counts and social followers.
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import * as db from '../db.js';
import { fetchSocial, formatCount } from './socialStats.js';

export const DEFAULT_STATS_CATEGORY = '📊 Statistika servera';

export const STATS = {
  members: { label: 'Članovi', kind: 'local', defaultTemplate: '👥 Članovi: {count}' },
  bots: { label: 'Botovi', kind: 'local', defaultTemplate: '🤖 Botovi: {count}' },
  boosts: { label: 'Boostovi', kind: 'local', defaultTemplate: '🚀 Boostovi: {count}' },
  tiktok: { label: 'TikTok pratitelji', kind: 'social', platform: 'tiktok', defaultTemplate: '🎵 TikTok: {count}' },
  youtube: { label: 'YouTube pretplatnici', kind: 'social', platform: 'youtube', defaultTemplate: '▶️ YouTube: {count}' },
  twitch: { label: 'Twitch pratitelji', kind: 'social', platform: 'twitch', defaultTemplate: '🟣 Twitch: {count}' },
};

export const STATS_DEFINITIONS = Object.entries(STATS).map(([key, def]) => ({
  key,
  label: def.label,
  kind: def.kind,
  platform: def.platform ?? null,
  defaultTemplate: def.defaultTemplate,
}));

// Discord allows only 2 channel renames per 10 minutes, so each channel is renamed at most every ~5 min.
const MIN_RENAME_INTERVAL = 5 * 60 * 1000 + 5000;
const lastRename = new Map(); // channelId -> timestamp
const scheduled = new Map(); // guildId -> timeout
const running = new Set(); // guildIds currently updating
const dirty = new Set(); // guildIds that changed while updating

export function defaultStatsConfig() {
  const channels = {};
  for (const [key, def] of Object.entries(STATS)) {
    channels[key] = {
      enabled: def.kind === 'local',
      channelId: null,
      template: def.defaultTemplate,
      account: '',
    };
  }
  return { categoryId: null, categoryName: DEFAULT_STATS_CATEGORY, channels };
}

// Accepts the old shape ({ members: channelId, ... }) and the new one ({ channels: { ... } }).
export function normalizeStatsConfig(raw) {
  if (!raw) return null;
  const base = defaultStatsConfig();
  const source = raw.channels && typeof raw.channels === 'object' ? raw.channels : raw;
  const channels = {};
  for (const [key, def] of Object.entries(STATS)) {
    const item = source[key];
    const previous = base.channels[key];
    if (typeof item === 'string') {
      channels[key] = { ...previous, enabled: true, channelId: item };
    } else if (item && typeof item === 'object') {
      channels[key] = {
        enabled: item.enabled !== false,
        channelId: item.channelId || null,
        template: String(item.template || def.defaultTemplate).slice(0, 100),
        account: String(item.account ?? '').trim().slice(0, 100),
      };
    } else {
      channels[key] = previous;
    }
  }
  return {
    categoryId: raw.categoryId || null,
    categoryName: String(raw.categoryName || DEFAULT_STATS_CATEGORY).slice(0, 100),
    channels,
  };
}

export function getStatsConfig(guildId) {
  return normalizeStatsConfig(db.guild(guildId).config.stats);
}

export function saveStatsConfig(guildId, input = {}) {
  const current = normalizeStatsConfig(db.guild(guildId).config.stats) ?? defaultStatsConfig();
  if ('categoryName' in input) {
    const name = String(input.categoryName ?? '').trim().slice(0, 100);
    current.categoryName = name || DEFAULT_STATS_CATEGORY;
  }
  for (const [key, def] of Object.entries(STATS)) {
    const item = input.channels?.[key];
    if (!item || typeof item !== 'object') continue;
    const target = current.channels[key];
    if ('enabled' in item) target.enabled = Boolean(item.enabled);
    if ('template' in item) {
      const template = String(item.template ?? '').trim().slice(0, 100);
      target.template = template || def.defaultTemplate;
    }
    if ('account' in item) target.account = String(item.account ?? '').trim().slice(0, 100);
  }
  db.guild(guildId).config.stats = current;
  db.save();
  return current;
}

export function computeStats(guild) {
  return {
    members: guild.memberCount,
    bots: guild.members.cache.filter((m) => m.user.bot).size,
    boosts: guild.premiumSubscriptionCount ?? 0,
  };
}

async function valuesFor(guild, cfg) {
  const values = computeStats(guild);
  for (const [key, def] of Object.entries(STATS)) {
    if (def.kind !== 'social') continue;
    const item = cfg.channels[key];
    if (!item?.enabled || !item.account) {
      values[key] = null;
      continue;
    }
    try {
      const data = await fetchSocial(def.platform, item.account);
      values[key] = data.followers ?? data.subscribers ?? null;
    } catch (err) {
      console.warn(`[stats] ${def.platform}/${item.account}:`, err.message);
      values[key] = null;
    }
  }
  return values;
}

export function renderStatsName(template, value) {
  const text = String(template || '')
    .replace(/\{count\}/g, value == null ? '?' : formatCount(value))
    .replace(/\{value\}/g, value == null ? '?' : formatCount(value))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return text || null;
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
  const cfg = getStatsConfig(guild.id);
  if (!cfg) return;
  if (running.has(guild.id)) {
    dirty.add(guild.id);
    return;
  }
  running.add(guild.id);
  let retryIn = 0;
  try {
    const values = await valuesFor(guild, cfg);
    for (const [key, def] of Object.entries(STATS)) {
      const item = cfg.channels[key];
      const channel = item?.enabled && item.channelId && guild.channels.cache.get(item.channelId);
      if (!channel) continue;
      const value = values[key];
      // Keep the old name when a social lookup is temporarily unavailable.
      if (value == null && def.kind === 'social') continue;
      const name = renderStatsName(item.template, value);
      if (!name || channel.name === name) continue;
      const wait = (lastRename.get(channel.id) ?? 0) + MIN_RENAME_INTERVAL - Date.now();
      if (wait > 0) {
        retryIn = Math.max(retryIn, wait);
        continue;
      }
      lastRename.set(channel.id, Date.now());
      await channel.setName(name, `${guild.client.user.username}: statistika`);
    }
  } finally {
    running.delete(guild.id);
  }
  if (dirty.delete(guild.id)) scheduleStatsUpdate(guild);
  if (retryIn) scheduleStatsUpdate(guild, retryIn + 1000);
}

async function deleteStatsChannels(guild, cfg) {
  for (const item of Object.values(cfg.channels)) {
    const channel = item.channelId && guild.channels.cache.get(item.channelId);
    if (channel) await channel.delete(`${guild.client.user.username}: statistika uklonjena`).catch(() => {});
    item.channelId = null;
  }
  const category = cfg.categoryId && guild.channels.cache.get(cfg.categoryId);
  if (category) await category.delete(`${guild.client.user.username}: statistika uklonjena`).catch(() => {});
  cfg.categoryId = null;
}

export async function setupStats(guild, input) {
  const g = db.guild(guild.id);
  if (input) saveStatsConfig(guild.id, input);
  const cfg = getStatsConfig(guild.id) ?? defaultStatsConfig();
  await deleteStatsChannels(guild, cfg);
  const values = await valuesFor(guild, cfg);
  const locked = [
    { id: guild.id, deny: [PermissionFlagsBits.Connect] },
    {
      id: guild.members.me.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels],
    },
  ];
  const category = await guild.channels.create({
    name: cfg.categoryName,
    type: ChannelType.GuildCategory,
    position: 0,
    permissionOverwrites: locked,
  });
  cfg.categoryId = category.id;
  for (const [key, def] of Object.entries(STATS)) {
    const item = cfg.channels[key];
    if (!item?.enabled) continue;
    if (def.kind === 'social' && !item.account) continue;
    const name = renderStatsName(item.template, values[key]) || def.label;
    const channel = await guild.channels.create({
      name,
      type: ChannelType.GuildVoice,
      parent: category.id,
      permissionOverwrites: locked,
    });
    item.channelId = channel.id;
    lastRename.set(channel.id, Date.now());
  }
  g.config.stats = cfg;
  db.save();
  return cfg;
}

export async function removeStats(guild) {
  const g = db.guild(guild.id);
  const cfg = getStatsConfig(guild.id);
  if (!cfg) return false;
  await deleteStatsChannels(guild, cfg);
  delete g.config.stats;
  db.save();
  return true;
}

// Used by the dashboard to show the current values without renaming anything.
export async function getStatsSnapshot(guild) {
  const cfg = getStatsConfig(guild.id) ?? defaultStatsConfig();
  const values = await valuesFor(guild, cfg);
  return { config: cfg, values };
}
