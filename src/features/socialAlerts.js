// Notifications when a YouTube/TikTok/Twitch account uploads a video or goes live.
//
// The networks do not offer a free, reliable push API for this bot, so the feature
// polls public pages every few minutes. The first check of an account only records a
// baseline; notifications start with the next change. All state is persisted in the
// guild config so a bot restart does not repeat an alert.
import crypto from 'node:crypto';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import * as db from '../db.js';
import { logActivity } from './activity.js';
import { cleanAccount } from './socialStats.js';
import { fillTemplate } from '../utils/helpers.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const MAX_ACCOUNTS = 25;
const POLL_MINUTES = Math.max(2, Number(process.env.SOCIAL_POLL_MINUTES) || 5);

export const PLATFORMS = {
  youtube: { label: 'YouTube', color: 0xff0033, events: ['upload', 'live'] },
  twitch: { label: 'Twitch', color: 0x9146ff, events: ['live'] },
  tiktok: { label: 'TikTok', color: 0x25f4ee, events: ['upload', 'live'] },
};

export const ROUTE_KEYS = Object.entries(PLATFORMS).flatMap(([platform, def]) =>
  def.events.map((event) => `${platform}:${event}`),
);

export const DEFAULT_MESSAGE = '**{account}** je {event}, brzo da svi pogledate!';

// Special `roleId` values that mention everyone instead of a role.
export const MENTION_EVERYONE = 'everyone';
export const MENTION_HERE = 'here';

const DEFAULT_STATE = {
  lastVideoId: null,
  lastVideoTitle: null,
  lastVideoAt: null,
  videoCount: null,
  live: false,
  liveVideoId: null,
  lastLiveAt: null,
  lastCheckedAt: null,
  lastError: null,
  channelId: null,
  name: null,
  avatarUrl: null,
  followers: null,
  title: null,
  game: null,
};

const str = (value, max = 200) => String(value ?? '').trim().slice(0, max);
const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function defaultConfig() {
  return { enabled: false, channelId: null, roleId: null, message: '', channels: {}, accounts: [] };
}

export function normalizeState(raw) {
  const state = { ...DEFAULT_STATE, ...(raw && typeof raw === 'object' ? raw : {}) };
  for (const key of ['lastVideoId', 'lastVideoTitle', 'liveVideoId', 'channelId', 'name', 'avatarUrl', 'title', 'game']) {
    state[key] = state[key] ? str(state[key], 500) : null;
  }
  for (const key of ['lastVideoAt', 'lastLiveAt', 'lastCheckedAt']) state[key] = num(state[key]);
  for (const key of ['videoCount', 'followers']) state[key] = num(state[key]);
  state.live = Boolean(state.live);
  state.lastError = state.lastError ? str(state.lastError, 300) : null;
  return state;
}

export function normalizeAccount(raw) {
  const platform = PLATFORMS[raw?.platform] ? raw.platform : null;
  if (!platform) return null;
  const account = cleanAccount(raw.account);
  if (!account) return null;
  const allowed = PLATFORMS[platform].events;
  const events = {};
  for (const event of allowed) events[event] = raw.events?.[event] !== false;
  return {
    id: str(raw.id, 64) || crypto.randomUUID(),
    platform,
    account,
    label: str(raw.label, 100) || account,
    events,
    state: normalizeState(raw.state),
  };
}

export function normalizeConfig(raw) {
  const base = defaultConfig();
  if (!raw || typeof raw !== 'object') return base;
  const accounts = [];
  const seen = new Set();
  for (const item of Array.isArray(raw.accounts) ? raw.accounts : []) {
    const account = normalizeAccount(item);
    if (!account) continue;
    const key = `${account.platform}:${account.account.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    accounts.push(account);
  }
  const channels = {};
  for (const key of ROUTE_KEYS) {
    const id = raw.channels?.[key];
    if (id) channels[key] = str(id, 64);
  }
  return {
    enabled: Boolean(raw.enabled),
    channelId: raw.channelId ? str(raw.channelId, 64) : null,
    roleId: raw.roleId ? str(raw.roleId, 64) : null,
    message: str(raw.message, 2000),
    channels,
    accounts: accounts.slice(0, MAX_ACCOUNTS),
  };
}

export function getConfig(guildId) {
  return normalizeConfig(db.guild(guildId).config.socialAlerts);
}

function persist(guildId, cfg) {
  db.guild(guildId).config.socialAlerts = cfg;
  db.save();
  return cfg;
}

export function saveConfig(guildId, input = {}) {
  const cfg = getConfig(guildId);
  if ('enabled' in input) cfg.enabled = Boolean(input.enabled);
  if ('channelId' in input) cfg.channelId = input.channelId ? str(input.channelId, 64) : null;
  if ('roleId' in input) cfg.roleId = input.roleId ? str(input.roleId, 64) : null;
  if ('message' in input) cfg.message = str(input.message, 2000);
  if (input.channels && typeof input.channels === 'object') {
    const channels = { ...cfg.channels };
    for (const key of ROUTE_KEYS) {
      if (!(key in input.channels)) continue;
      const id = input.channels[key];
      if (id) channels[key] = str(id, 64);
      else delete channels[key];
    }
    cfg.channels = channels;
  }
  return persist(guildId, cfg);
}

export function hasChannel(cfg) {
  return Boolean(cfg.channelId || Object.values(cfg.channels ?? {}).some(Boolean));
}

export function channelFor(cfg, platform, event) {
  return cfg.channels?.[`${platform}:${event}`] || cfg.channelId || null;
}

export function targetChannel(guild, cfg, platform, event) {
  const override = cfg.channels?.[`${platform}:${event}`];
  const channel = override && guild.channels.cache.get(override);
  if (channel) return channel;
  return (cfg.channelId && guild.channels.cache.get(cfg.channelId)) || null;
}

export function addAccount(guildId, input = {}) {
  const cfg = getConfig(guildId);
  const account = normalizeAccount(input);
  if (!account) throw new Error('Odaberi platformu i upiši korisničko ime ili kanal.');
  const duplicate = cfg.accounts.some(
    (a) => a.platform === account.platform && a.account.toLowerCase() === account.account.toLowerCase(),
  );
  if (duplicate) throw new Error('Taj račun već pratiš.');
  if (cfg.accounts.length >= MAX_ACCOUNTS) throw new Error(`Najviše ${MAX_ACCOUNTS} računa po serveru.`);
  cfg.accounts.push(account);
  if (!cfg.enabled) cfg.enabled = true;
  persist(guildId, cfg);
  return account;
}

export function updateAccount(guildId, id, input = {}) {
  const cfg = getConfig(guildId);
  const account = cfg.accounts.find((a) => a.id === id);
  if (!account) throw new Error('Taj račun više ne postoji.');
  if ('label' in input) account.label = str(input.label, 100) || account.account;
  if (input.events && typeof input.events === 'object') {
    for (const event of PLATFORMS[account.platform].events) {
      if (event in input.events) account.events[event] = Boolean(input.events[event]);
    }
  }
  persist(guildId, cfg);
  return account;
}

export function removeAccount(guildId, id) {
  const cfg = getConfig(guildId);
  const before = cfg.accounts.length;
  cfg.accounts = cfg.accounts.filter((a) => a.id !== id);
  persist(guildId, cfg);
  return cfg.accounts.length !== before;
}

export function accountSummary(account) {
  return {
    id: account.id,
    platform: account.platform,
    account: account.account,
    label: account.label,
    events: { ...account.events },
    state: { ...account.state },
  };
}

// ---------- public-page parsers (exported for tests) ----------

export function decodeXml(text) {
  return String(text ?? '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

function decodeJsonString(value) {
  try {
    return JSON.parse(`"${value}"`);
  } catch {
    return String(value ?? '');
  }
}

export function parseYouTubeFeed(xml) {
  const text = String(xml ?? '');
  const channelTitle = decodeXml(text.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').trim() || null;
  const entry = text.match(/<entry>([\s\S]*?)<\/entry>/)?.[1];
  if (!entry) return { channelTitle, latest: null };
  const videoId = entry.match(/<yt:videoId>([^<]+)<\/yt:videoId>/)?.[1] ?? null;
  const title = decodeXml(entry.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '').trim();
  const published = entry.match(/<published>([^<]+)<\/published>/)?.[1] ?? null;
  const link = entry.match(/<link[^>]+rel="alternate"[^>]+href="([^"]+)"/)?.[1] ?? null;
  const thumbnail = entry.match(/<media:thumbnail[^>]+url="([^"]+)"/)?.[1] ?? null;
  return {
    channelTitle,
    latest: videoId
      ? {
          videoId,
          title,
          published,
          publishedAt: published ? Date.parse(published) : null,
          url: link || `https://www.youtube.com/watch?v=${videoId}`,
          thumbnail: thumbnail || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
        }
      : null,
  };
}

export function parseYouTubeLive(html) {
  const text = String(html ?? '');
  const start = text.indexOf('"videoDetails"');
  const window = start >= 0 ? text.slice(start, start + 40_000) : '';
  if (!window) return { live: false, videoId: null, title: null };
  const live = /"isLive"\s*:\s*true/.test(window);
  const videoId = window.match(/"videoId"\s*:\s*"([\w-]{6,})"/)?.[1] ?? null;
  const title = decodeJsonString(window.match(/"title"\s*:\s*"((?:\\.|[^"\\])*)"/)?.[1] ?? '');
  return { live, videoId, title: title || null };
}

export function parseTikTokProfile(html) {
  const text = String(html ?? '');
  let user = null;
  let stats = null;
  const json = text.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (json) {
    try {
      const data = JSON.parse(json);
      const info = data?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo;
      user = info?.user ?? null;
      stats = info?.statsV2 ?? info?.stats ?? null;
    } catch {
      // fall back to regex below
    }
  }
  if (!user) {
    const uniqueId = text.match(/"uniqueId":"([^"]+)"/)?.[1];
    if (!uniqueId) return null;
    user = {
      uniqueId,
      nickname: text.match(/"nickname":"((?:\\.|[^"\\])*)"/)?.[1] ?? uniqueId,
      signature: text.match(/"signature":"((?:\\.|[^"\\])*)"/)?.[1] ?? '',
      avatarLarger: text.match(/"avatarLarger":"((?:\\.|[^"\\])*)"/)?.[1]?.replace(/\\u002F/g, '/') ?? null,
      roomId: text.match(/"roomId":"([^"]*)"/)?.[1] ?? '',
    };
    stats = {
      followerCount: text.match(/"followerCount":"?(\d+)"?/)?.[1],
      videoCount: text.match(/"videoCount":"?(\d+)"?/)?.[1],
    };
  }
  const account = user.uniqueId;
  if (!account) return null;
  const roomId = String(user.roomId ?? '').trim();
  return {
    platform: 'tiktok',
    account,
    name: decodeJsonString(user.nickname || account),
    avatarUrl: user.avatarLarger ?? user.avatarMedium ?? user.avatarThumb ?? null,
    followers: num(stats?.followerCount),
    videos: num(stats?.videoCount),
    roomId,
    live: Boolean(roomId),
    bio: decodeJsonString(user.signature ?? ''),
    url: `https://www.tiktok.com/@${account}`,
  };
}

// The public creator embed (`/embed/@user`) lists the latest videos with their
// description and cover. Pinned videos can come first, so the newest one is picked by
// ID (TikTok IDs grow with time).
export function parseTikTokEmbed(html) {
  const text = String(html ?? '');
  const json = text.match(/<script id="__FRONTITY_CONNECT_STATE__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  let list = null;
  if (json) {
    try {
      const data = JSON.parse(json);
      for (const value of Object.values(data?.source?.data ?? {})) {
        if (Array.isArray(value?.videoList)) {
          list = value.videoList;
          break;
        }
      }
    } catch {
      list = null;
    }
  }
  if (!list) return { latest: null };
  let latest = null;
  for (const item of list) {
    const id = String(item?.id ?? '');
    if (!/^\d{6,}$/.test(id) || item.privateItem) continue;
    if (!latest || BigInt(id) > BigInt(latest.id)) latest = item;
  }
  if (!latest) return { latest: null };
  const account = latest.authorUniqueId || null;
  const id = String(latest.id);
  return {
    latest: {
      videoId: id,
      title: str(latest.desc, 500),
      url: account ? `https://www.tiktok.com/@${account}/video/${id}` : `https://www.tiktok.com/video/${id}`,
      thumbnail: latest.originCoverUrl || latest.coverUrl || null,
      publishedAt: tikTokIdTime(id),
    },
  };
}

// The first 32 bits of a TikTok video ID are the upload time in seconds.
export function tikTokIdTime(id) {
  try {
    const seconds = Number(BigInt(id) >> 32n);
    return seconds > 1_400_000_000 ? seconds * 1000 : null;
  } catch {
    return null;
  }
}

export function isNewerId(next, previous) {
  if (!next) return false;
  if (!previous) return true;
  try {
    return BigInt(next) > BigInt(previous);
  } catch {
    return next !== previous;
  }
}

export function parseYouTubeAvatar(html) {
  const url = String(html ?? '').match(/https:\/\/yt3\.(?:ggpht|googleusercontent)\.com\/[\w\-./=~]+/)?.[0];
  return url ? url.replace(/=s\d+[^/]*$/, '=s176-c-k-c0x00ffffff-no-rj') : null;
}

export function twitchPreview(user, now = Date.now()) {
  return `https://static-cdn.jtvnw.net/previews-ttv/live_user_${String(user).toLowerCase()}-1280x720.jpg?t=${Math.floor(now / 60_000)}`;
}

export function parseTwitchUptime(text) {
  const value = String(text ?? '').trim();
  if (!value || /offline|not found|does not exist|error/i.test(value)) return { live: false, text: value };
  return { live: /live/i.test(value), text: value };
}

export function parseTikTokVideoCount(html) {
  const text = String(html ?? '');
  return num(text.match(/"videoCount":"?(\d+)"?/)?.[1]);
}

// ---------- fetchers ----------

async function getText(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

async function resolveYouTube(account, state) {
  const raw = String(account ?? '').trim();
  if (/^UC[\w-]{20,}$/.test(raw)) {
    return { channelId: raw, url: `https://www.youtube.com/channel/${raw}` };
  }
  if (state.channelId) return { channelId: state.channelId, url: `https://www.youtube.com/channel/${state.channelId}` };
  let url;
  if (/^https?:\/\//i.test(raw)) {
    const parsed = new URL(raw);
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(parsed.hostname)) throw new Error('To nije YouTube link.');
    const id = parsed.pathname.match(/\/channel\/(UC[\w-]{20,})/)?.[1];
    if (id) return { channelId: id, url: `https://www.youtube.com/channel/${id}` };
    if (!parsed.pathname.startsWith('/@') && !parsed.pathname.startsWith('/c/') && !parsed.pathname.startsWith('/user/')) {
      throw new Error('Link mora biti YouTube kanal, npr. https://youtube.com/@ime.');
    }
    url = `https://www.youtube.com${parsed.pathname}`;
  } else {
    url = `https://www.youtube.com/@${cleanAccount(raw)}`;
  }
  const html = await getText(url, { Accept: 'text/html' });
  const avatarUrl = parseYouTubeAvatar(html);
  const channelId = html.match(/"channelId"\s*:\s*"(UC[\w-]{20,})"/)?.[1]
    ?? html.match(/"externalId"\s*:\s*"(UC[\w-]{20,})"/)?.[1]
    ?? html.match(/channel\/(UC[\w-]{20,})/)?.[1];
  if (!channelId) throw new Error('Ne mogu pronaći YouTube kanal. Provjeri @ime ili link.');
  return { channelId, avatarUrl, url: `https://www.youtube.com/channel/${channelId}` };
}

async function fetchYouTube(account, state, events) {
  const resolved = await resolveYouTube(account, state);
  state.channelId = resolved.channelId;
  const out = { account, url: resolved.url, name: null, upload: null, live: null, avatarUrl: resolved.avatarUrl ?? null };
  let error = null;
  if (events.upload) {
    try {
      const xml = await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(resolved.channelId)}`);
      const feed = parseYouTubeFeed(xml);
      out.name = feed.channelTitle;
      out.upload = feed.latest;
    } catch (err) {
      error = err;
    }
  }
  if (events.live) {
    try {
      const html = await getText(`https://www.youtube.com/channel/${encodeURIComponent(resolved.channelId)}/live`, { Accept: 'text/html' });
      out.live = parseYouTubeLive(html);
      out.avatarUrl = out.avatarUrl ?? parseYouTubeAvatar(html);
    } catch (err) {
      error = error ?? err;
    }
  }
  if (!out.upload && !out.live && error) throw error;
  return out;
}

async function fetchTwitch(account) {
  const user = cleanAccount(account);
  const uptime = parseTwitchUptime(await getText(`https://decapi.me/twitch/uptime/${encodeURIComponent(user)}`));
  const out = { account: user, url: `https://www.twitch.tv/${user}`, name: user, live: uptime.live, title: null, game: null, avatarUrl: null };
  if (uptime.live) {
    const [title, game, avatar] = await Promise.all([
      getText(`https://decapi.me/twitch/title/${encodeURIComponent(user)}`).catch(() => ''),
      getText(`https://decapi.me/twitch/game/${encodeURIComponent(user)}`).catch(() => ''),
      getText(`https://decapi.me/twitch/avatar/${encodeURIComponent(user)}`).catch(() => ''),
    ]);
    out.title = title.trim() || null;
    out.game = game.trim() || null;
    out.avatarUrl = /^https?:\/\//.test(avatar.trim()) ? avatar.trim() : null;
  }
  return out;
}

async function fetchTikTok(account) {
  const user = cleanAccount(account);
  const html = await getText(`https://www.tiktok.com/@${encodeURIComponent(user)}`);
  const data = parseTikTokProfile(html);
  if (!data) throw new Error('TikTok trenutno ne vraća podatke za taj račun.');
  return data;
}

async function fetchTikTokLatest(account) {
  try {
    const html = await getText(`https://www.tiktok.com/embed/@${encodeURIComponent(cleanAccount(account))}`, { Accept: 'text/html' });
    return parseTikTokEmbed(html).latest;
  } catch {
    return null;
  }
}

// ---------- notifications ----------

export function eventText(event) {
  return event === 'live' ? 'počeo/la stream' : 'objavio/la novi video';
}

export function profileUrl(account) {
  const user = encodeURIComponent(account.account);
  if (account.platform === 'twitch') return `https://www.twitch.tv/${user}`;
  if (account.platform === 'tiktok') return `https://www.tiktok.com/@${user}`;
  if (/^UC[\w-]{20,}$/.test(account.account)) return `https://www.youtube.com/channel/${user}`;
  return `https://www.youtube.com/@${user}`;
}

const isHttp = (value) => typeof value === 'string' && /^https?:\/\//i.test(value);

// Bare links in the text above the card would make Discord add a second preview.
function suppressLinks(text) {
  return text.replace(/(^|[^(<])(https?:\/\/[^\s>)]+)/g, '$1<$2>');
}

function mention(roleId) {
  if (!roleId) return null;
  if (roleId === MENTION_EVERYONE) return { text: '@everyone', allowed: { parse: ['everyone'] } };
  if (roleId === MENTION_HERE) return { text: '@here', allowed: { parse: ['everyone'] } };
  return { text: `<@&${roleId}>`, allowed: { roles: [roleId] } };
}

// Builds the alert: a short announcement (with the optional mention) above a card with
// the creator, the video/stream title, a large preview image and link buttons.
export function buildNotification(cfg, account, event, data = {}) {
  const platform = PLATFORMS[account.platform] ?? PLATFORMS.youtube;
  const profile = isHttp(data.profileUrl) ? data.profileUrl : profileUrl(account);
  const url = isHttp(data.url) ? data.url : profile;
  const name = account.label || data.name || account.account;
  const title = str(data.title, 256) || (event === 'live' ? `${name} je uživo` : 'Novi video');
  const values = {
    account: name,
    username: account.account,
    platform: platform.label,
    event: eventText(event),
    title,
    url,
    game: data.game ?? '',
    followers: data.followers != null ? new Intl.NumberFormat('hr-HR').format(data.followers) : '',
  };
  const template = cfg.message || DEFAULT_MESSAGE;
  const text = suppressLinks(fillTemplate(template, values))
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const embed = new EmbedBuilder()
    .setColor(platform.color)
    .setAuthor({ name: str(name, 256), url: profile, ...(isHttp(data.avatarUrl) ? { iconURL: data.avatarUrl } : {}) })
    .setTitle(title)
    .setURL(url)
    .setFooter({ text: event === 'live' ? `🔴 Uživo na ${platform.label}` : platform.label });
  const lines = [];
  if (event === 'live' && data.game) lines.push(`🎮 ${str(data.game, 200)}`);
  if (data.followers != null) lines.push(`👥 ${values.followers} pratitelja`);
  if (lines.length) embed.setDescription(lines.join(' · '));
  if (isHttp(data.thumbnail)) embed.setImage(data.thumbnail);
  else if (isHttp(data.avatarUrl)) embed.setThumbnail(data.avatarUrl);
  const at = Number.isFinite(data.publishedAt) ? data.publishedAt : Date.parse(data.published ?? '');
  embed.setTimestamp(Number.isFinite(at) ? at : Date.now());

  const buttons = [
    new ButtonBuilder()
      .setStyle(ButtonStyle.Link)
      .setLabel(event === 'live' ? 'Gledaj stream' : 'Pogledaj video')
      .setURL(url),
  ];
  if (profile !== url) {
    buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(`Otvori ${platform.label}`).setURL(profile));
  }

  const ping = mention(cfg.roleId);
  const content = [ping?.text, text].filter(Boolean).join('\n').slice(0, 2000);
  const payload = {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(buttons)],
    allowedMentions: ping?.allowed ?? { parse: [] },
  };
  if (content) payload.content = content;
  return payload;
}

async function checkAccount(cfg, account, { notify = true } = {}) {
  const state = account.state;
  const firstRun = !state.lastCheckedAt;
  const notifications = [];
  const platform = account.platform;

  if (platform === 'youtube') {
    const data = await fetchYouTube(account.account, state, account.events);
    if (data.name) state.name = data.name;
    if (data.avatarUrl) state.avatarUrl = data.avatarUrl;
    const common = { name: state.name, avatarUrl: state.avatarUrl, profileUrl: data.url };
    if (data.live) {
      if (data.live.live) {
        const liveId = data.live.videoId;
        const changed = !state.live || (liveId && state.liveVideoId !== liveId);
        if (notify && !firstRun && changed) {
          notifications.push({
            event: 'live',
            data: {
              ...common,
              title: data.live.title || null,
              url: liveId ? `https://www.youtube.com/watch?v=${liveId}` : data.url,
              thumbnail: liveId ? `https://i.ytimg.com/vi/${liveId}/hqdefault_live.jpg` : null,
            },
          });
        }
        state.live = true;
        state.liveVideoId = liveId ?? null;
        state.lastLiveAt = Date.now();
        state.title = data.live.title || state.title;
        // The live stream also appears in the RSS feed; mark it as seen so the
        // upload watcher does not send a second alert for the same video.
        if (liveId) {
          state.lastVideoId = liveId;
          state.lastVideoTitle = data.live.title || state.lastVideoTitle;
          state.lastVideoAt = Date.now();
        }
      } else {
        state.live = false;
        state.liveVideoId = null;
      }
    }
    if (data.upload) {
      const upload = data.upload;
      const isNew =
        upload.videoId &&
        upload.videoId !== state.lastVideoId &&
        (state.lastVideoAt == null || (upload.publishedAt ?? 0) > state.lastVideoAt);
      if (notify && !firstRun && isNew && !(data.live?.live && data.live.videoId === upload.videoId)) {
        notifications.push({ event: 'upload', data: { ...common, ...upload } });
      }
      state.lastVideoId = upload.videoId;
      state.lastVideoTitle = upload.title;
      state.lastVideoAt = upload.publishedAt ?? Date.now();
      state.title = upload.title;
    }
  } else if (platform === 'twitch') {
    const data = await fetchTwitch(account.account);
    if (notify && !firstRun && data.live && !state.live) {
      notifications.push({
        event: 'live',
        data: {
          title: data.title || null,
          game: data.game,
          url: data.url,
          profileUrl: data.url,
          avatarUrl: data.avatarUrl,
          thumbnail: twitchPreview(data.account),
        },
      });
    }
    state.live = data.live;
    state.title = data.title;
    state.game = data.game;
    state.avatarUrl = data.avatarUrl;
    state.name = data.name;
    if (data.live) state.lastLiveAt = Date.now();
  } else if (platform === 'tiktok') {
    const data = await fetchTikTok(account.account);
    const common = { name: data.name, avatarUrl: data.avatarUrl, profileUrl: data.url, followers: data.followers };
    if (notify && !firstRun && data.live && !state.live) {
      notifications.push({ event: 'live', data: { ...common, title: null, url: `${data.url}/live` } });
    }
    const grew = data.videos != null && state.videoCount != null && data.videos > state.videoCount;
    // The profile page only has the video count; the creator embed has the latest video.
    const latest = account.events.upload !== false && (grew || !state.lastVideoId || firstRun)
      ? await fetchTikTokLatest(account.account)
      : null;
    const newer = latest && state.lastVideoId ? isNewerId(latest.videoId, state.lastVideoId) : grew;
    if (notify && !firstRun && newer) {
      notifications.push({
        event: 'upload',
        data: latest
          ? { ...common, ...latest, title: latest.title || null }
          : { ...common, title: `Novi video (ukupno ${data.videos})`, url: data.url },
      });
    }
    if (latest && isNewerId(latest.videoId, state.lastVideoId)) {
      state.lastVideoId = latest.videoId;
      state.lastVideoTitle = latest.title || null;
      state.lastVideoAt = latest.publishedAt ?? Date.now();
    }
    state.videoCount = data.videos;
    state.live = data.live;
    state.name = data.name;
    state.avatarUrl = data.avatarUrl;
    state.followers = data.followers;
    state.title = data.live ? 'Uživo' : state.lastVideoTitle || state.title;
    if (data.live) state.lastLiveAt = Date.now();
  }

  state.lastCheckedAt = Date.now();
  state.lastError = null;
  return notifications;
}

export async function checkGuild(guild, { notify = true, accountId = null } = {}) {
  const cfg = getConfig(guild.id);
  if (!cfg.accounts.length) return { accounts: [], checked: 0 };
  const results = [];
  let checked = 0;
  for (const account of cfg.accounts) {
    if (accountId && account.id !== accountId) continue;
    checked += 1;
    try {
      const notifications = await checkAccount(cfg, account, { notify });
      for (const item of notifications) {
        const target = targetChannel(guild, cfg, account.platform, item.event);
        if (!target) {
          account.state.lastError = `Kanal za ${PLATFORMS[account.platform].label} ${item.event === 'live' ? 'uživo' : 'video'} nije dostupan.`;
          continue;
        }
        await target.send(buildNotification(cfg, account, item.event, item.data));
        logActivity(
          guild.id,
          'social',
          `${account.label}: ${item.event === 'live' ? 'stream je počeo' : 'novi video'} (${PLATFORMS[account.platform].label})`,
        );
      }
    } catch (err) {
      account.state.lastCheckedAt = Date.now();
      account.state.lastError = String(err.message || err).slice(0, 300);
      console.warn(`[social] ${guild.name}/${account.platform}/${account.account}:`, err.message);
    }
    results.push(accountSummary(account));
  }
  persist(guild.id, cfg);
  return { accounts: results, checked, channelMissing: !hasChannel(cfg) };
}

export async function testNotification(guild, accountId = null) {
  const cfg = getConfig(guild.id);
  const account = cfg.accounts.find((a) => a.id === accountId) ?? cfg.accounts[0];
  if (!account) throw new Error('Prvo dodaj barem jedan račun.');
  const st = account.state;
  const event = account.events.upload && st.lastVideoId ? 'upload' : account.events.live ? 'live' : 'upload';
  const channel = targetChannel(guild, cfg, account.platform, event);
  if (!channel) throw new Error('Odaberi i spremi kanal za tu vrstu obavijesti.');
  const video = event === 'upload' && st.lastVideoId ? st.lastVideoId : null;
  const videoUrl = video && account.platform === 'youtube'
    ? `https://www.youtube.com/watch?v=${video}`
    : video && account.platform === 'tiktok'
      ? `https://www.tiktok.com/@${account.account}/video/${video}`
      : null;
  const payload = buildNotification(cfg, account, event, {
    title: (video && st.lastVideoTitle) || 'Testna obavijest',
    url: videoUrl || profileUrl(account),
    name: st.name,
    avatarUrl: st.avatarUrl,
    thumbnail: account.platform === 'twitch'
      ? twitchPreview(account.account)
      : video && account.platform === 'youtube' ? `https://i.ytimg.com/vi/${video}/hqdefault.jpg` : null,
    game: account.platform === 'twitch' ? st.game || 'Test' : null,
  });
  await channel.send(payload);
  return true;
}

// ---------- polling ----------

const running = new Set();
let timer = null;
let kickoff = null;

async function tick(client) {
  for (const guild of client.guilds.cache.values()) {
    if (running.has(guild.id)) continue;
    const cfg = getConfig(guild.id);
    if (!cfg.enabled || !hasChannel(cfg) || !cfg.accounts.length) continue;
    running.add(guild.id);
    try {
      await checkGuild(guild);
    } catch (err) {
      console.error(`[social] ${guild.name}:`, err);
    } finally {
      running.delete(guild.id);
    }
  }
}

export function start(client) {
  stop();
  kickoff = setTimeout(() => tick(client).catch((err) => console.error('[social]', err)), 15_000);
  kickoff.unref?.();
  timer = setInterval(() => tick(client).catch((err) => console.error('[social]', err)), POLL_MINUTES * 60 * 1000);
  timer.unref?.();
}

export function stop() {
  if (kickoff) clearTimeout(kickoff);
  if (timer) clearInterval(timer);
  kickoff = null;
  timer = null;
  running.clear();
}

export const pollMinutes = POLL_MINUTES;
