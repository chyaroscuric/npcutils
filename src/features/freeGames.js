// Free game alerts for Epic Games Store and Steam. Epic uses its public store
// promotions endpoint; Steam uses GamerPower's freebie feed filtered to games.
import { EmbedBuilder } from 'discord.js';
import * as db from '../db.js';
import { logActivity } from './activity.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CACHE_MS = 30 * 60 * 1000;
const POLL_HOURS = Math.max(1, Number(process.env.FREE_GAMES_POLL_HOURS) || 6);
const MAX_FIELD_ITEMS = 8;

let cache = null; // { at, data }

export function defaultConfig() {
  return {
    enabled: false,
    channelId: null,
    roleId: null,
    epic: true,
    steam: true,
    message: '',
    lastEpic: [],
    lastSteam: [],
    lastCheckedAt: null,
    lastError: null,
  };
}

const str = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const idList = (value) => (Array.isArray(value) ? [...new Set(value.map(String))].slice(0, 100) : []);

export function normalizeConfig(raw) {
  const base = defaultConfig();
  if (!raw || typeof raw !== 'object') return base;
  return {
    enabled: Boolean(raw.enabled),
    channelId: raw.channelId ? str(raw.channelId, 64) : null,
    roleId: raw.roleId ? str(raw.roleId, 64) : null,
    epic: raw.epic !== false,
    steam: raw.steam !== false,
    message: str(raw.message, 2000),
    lastEpic: idList(raw.lastEpic),
    lastSteam: idList(raw.lastSteam),
    lastCheckedAt: Number(raw.lastCheckedAt) || null,
    lastError: raw.lastError ? str(raw.lastError, 300) : null,
  };
}

export function getConfig(guildId) {
  return normalizeConfig(db.guild(guildId).config.freeGames);
}

export function saveConfig(guildId, input = {}) {
  const cfg = getConfig(guildId);
  for (const key of ['enabled', 'epic', 'steam']) if (key in input) cfg[key] = Boolean(input[key]);
  if ('channelId' in input) cfg.channelId = input.channelId ? str(input.channelId, 64) : null;
  if ('roleId' in input) cfg.roleId = input.roleId ? str(input.roleId, 64) : null;
  if ('message' in input) cfg.message = str(input.message, 2000);
  db.guild(guildId).config.freeGames = cfg;
  db.save();
  return cfg;
}

function persist(guildId, cfg) {
  db.guild(guildId).config.freeGames = cfg;
  db.save();
  return cfg;
}

function endText(value) {
  const at = Date.parse(value ?? '');
  return Number.isFinite(at) ? `<t:${Math.floor(at / 1000)}:R>` : null;
}

// ---------- parsers ----------

export function parseEpicFreeGames(json) {
  const elements = json?.data?.Catalog?.searchStore?.elements;
  if (!Array.isArray(elements)) return [];
  const out = [];
  for (const item of elements) {
    const promo = item?.promotions?.promotionalOffers?.[0]?.promotionalOffers?.[0];
    const price = Number(item?.price?.totalPrice?.discountPrice);
    const original = Number(item?.price?.totalPrice?.originalPrice);
    if (!promo || price !== 0 || !(original > 0)) continue;
    const slug = item?.offerMappings?.[0]?.pageSlug ?? item?.productSlug ?? item?.urlSlug;
    const id = `epic:${item?.id ?? slug ?? item?.title}`;
    out.push({
      id,
      platform: 'epic',
      title: item.title || 'Nepoznata igra',
      description: str(item.description, 300),
      url: slug ? `https://store.epicgames.com/en-US/p/${slug}` : 'https://store.epicgames.com/en-US/free-games',
      image: item?.keyImages?.find((image) => image?.type === 'Thumbnail')?.url ?? null,
      endDate: promo.endDate ?? null,
      endText: endText(promo.endDate),
      worth: original > 0 ? `$${(original / 100).toFixed(2)}` : null,
    });
  }
  return out;
}

export function parseSteamGiveaways(json) {
  if (!Array.isArray(json)) return [];
  return json
    .filter((item) => String(item?.status ?? '').toLowerCase() === 'active')
    .filter((item) => item?.type === 'Game' || (item?.type === 'Early Access' && item?.worth && item.worth !== 'N/A'))
    .map((item) => ({
      id: `steam:${item.id}`,
      platform: 'steam',
      title: str(item.title, 200),
      description: str(item.description, 300),
      url: item.open_giveaway_url || item.gamerpower_url || 'https://store.steampowered.com/',
      image: item.image || item.thumbnail || null,
      endDate: item.end_date && item.end_date !== 'N/A' ? item.end_date : null,
      endText: endText(item.end_date),
      worth: item.worth && item.worth !== 'N/A' ? String(item.worth) : null,
      type: item.type,
    }));
}

// ---------- fetching ----------

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchFreeGames({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const [epic, steam] = await Promise.allSettled([
    getJson('https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US').then(parseEpicFreeGames),
    getJson('https://www.gamerpower.com/api/giveaways?platform=steam').then(parseSteamGiveaways),
  ]);
  const data = {
    epic: epic.status === 'fulfilled' ? epic.value : [],
    steam: steam.status === 'fulfilled' ? steam.value : [],
    errors: [
      ...(epic.status === 'rejected' ? [`Epic: ${epic.reason?.message ?? epic.reason}`] : []),
      ...(steam.status === 'rejected' ? [`Steam: ${steam.reason?.message ?? steam.reason}`] : []),
    ],
    fetchedAt: Date.now(),
  };
  if (!data.epic.length && !data.steam.length && data.errors.length) {
    throw new Error(data.errors.join(' · '));
  }
  cache = { at: Date.now(), data };
  return data;
}

export function cachedGames() {
  return cache?.data ?? null;
}

export function newSince(current, seen) {
  const known = new Set(seen ?? []);
  return (current ?? []).filter((item) => !known.has(item.id));
}

export function buildFreeGamesPayload(cfg, games, { onlyNew = false } = {}) {
  const epic = onlyNew ? games.newEpic ?? games.epic : games.epic;
  const steam = onlyNew ? games.newSteam ?? games.steam : games.steam;
  const line = (item) =>
    `**[${item.title}](${item.url})**${item.endText ? ` — do ${item.endText}` : ''}${item.worth ? ` · vrijednost ${item.worth}` : ''}`;
  const embed = new EmbedBuilder()
    .setColor(0x22c55e)
    .setTitle(onlyNew ? '🎁 Nove besplatne igre' : '🎁 Besplatne igre')
    .setTimestamp();
  if (cfg.message) embed.setDescription(cfg.message.slice(0, 4096));
  if (cfg.epic) {
    const list = epic ?? [];
    if (list.length || !onlyNew) {
      embed.addFields({
        name: 'Epic Games',
        value: list.length ? list.slice(0, MAX_FIELD_ITEMS).map(line).join('\n') : 'Trenutno nema besplatnih igara.',
      });
    }
  }
  if (cfg.steam) {
    const list = steam ?? [];
    if (list.length || !onlyNew) {
      embed.addFields({
        name: 'Steam',
        value: list.length ? list.slice(0, MAX_FIELD_ITEMS).map(line).join('\n') : 'Trenutno nema besplatnih igara.',
      });
    }
  }
  if (!cfg.epic && !cfg.steam) embed.setDescription('Uključi barem jednu platformu u postavkama.');
  const payload = { embeds: [embed], allowedMentions: { parse: [] } };
  if (cfg.roleId) {
    payload.content = `<@&${cfg.roleId}>`;
    payload.allowedMentions = { roles: [cfg.roleId] };
  }
  return payload;
}

export async function checkGuild(guild, { notify = true } = {}) {
  const cfg = getConfig(guild.id);
  if (!cfg.enabled || !cfg.channelId) return { sent: false, reason: 'disabled' };
  const channel = guild.channels.cache.get(cfg.channelId);
  if (!channel) {
    cfg.lastError = 'Kanal za besplatne igre nije dostupan.';
    persist(guild.id, cfg);
    return { sent: false, reason: 'channel-missing' };
  }
  try {
    const games = await fetchFreeGames({ force: true });
    const newEpic = cfg.epic ? newSince(games.epic, cfg.lastEpic) : [];
    const newSteam = cfg.steam ? newSince(games.steam, cfg.lastSteam) : [];
    const firstRun = !cfg.lastCheckedAt;
    if (notify && !firstRun && (newEpic.length || newSteam.length)) {
      await channel.send(buildFreeGamesPayload(cfg, { ...games, newEpic, newSteam }, { onlyNew: true }));
      logActivity(guild.id, 'freegames', `${newEpic.length + newSteam.length} novih besplatnih igara`);
    }
    cfg.lastEpic = games.epic.map((item) => item.id);
    cfg.lastSteam = games.steam.map((item) => item.id);
    cfg.lastCheckedAt = Date.now();
    cfg.lastError = null;
    persist(guild.id, cfg);
    return { sent: Boolean(notify && !firstRun && (newEpic.length || newSteam.length)), games, newEpic, newSteam };
  } catch (err) {
    cfg.lastError = str(err.message || err, 300);
    persist(guild.id, cfg);
    return { sent: false, reason: 'fetch-failed', error: cfg.lastError };
  }
}

export async function testNotification(guild) {
  const cfg = getConfig(guild.id);
  const channel = cfg.channelId && guild.channels.cache.get(cfg.channelId);
  if (!channel) throw new Error('Prvo odaberi i spremi kanal za besplatne igre.');
  const games = await fetchFreeGames({ force: true });
  await channel.send(buildFreeGamesPayload(cfg, games));
  return games;
}

let timer = null;
let kickoff = null;

async function tick(client) {
  for (const guild of client.guilds.cache.values()) {
    const cfg = getConfig(guild.id);
    if (!cfg.enabled || !cfg.channelId) continue;
    try {
      await checkGuild(guild);
    } catch (err) {
      console.error(`[freegames] ${guild.name}:`, err);
    }
  }
}

export function start(client) {
  stop();
  kickoff = setTimeout(() => tick(client).catch((err) => console.error('[freegames]', err)), 30_000);
  kickoff.unref?.();
  timer = setInterval(() => tick(client).catch((err) => console.error('[freegames]', err)), POLL_HOURS * 60 * 60 * 1000);
  timer.unref?.();
}

export function stop() {
  if (kickoff) clearTimeout(kickoff);
  if (timer) clearInterval(timer);
  kickoff = null;
  timer = null;
}

export const pollHours = POLL_HOURS;
