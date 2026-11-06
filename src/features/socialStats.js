// Public follower/subscriber lookups for social networks, used by /stats and the stats channels.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const CACHE_TTL = 10 * 60 * 1000;
const cache = new Map(); // `${platform}:${account}` -> { at, data }

const numberFmt = new Intl.NumberFormat('hr-HR');
export const formatCount = (n) => numberFmt.format(Number(n) || 0);

function cleanAccount(value) {
  return String(value ?? '')
    .trim()
    .replace(/^@/, '')
    .replace(/^https?:\/\/(?:www\.)?(?:tiktok\.com|youtube\.com|twitch\.tv)\//i, '')
    .split(/[/?#]/)[0]
    .trim();
}

async function get(url, headers = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

function humanNumber(value) {
  const text = String(value ?? '').replace(/,/g, '').trim().toLowerCase();
  const match = text.match(/([\d.]+)\s*([kmbt])?/);
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n)) return null;
  const mult = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[match[2]] ?? 1;
  return Math.round(n * mult);
}

function meta(html, property) {
  const m = html.match(new RegExp(`<meta[^>]+property=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'))
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+property=["']${property}["']`, 'i'));
  return m?.[1] ?? null;
}

async function tiktok(account) {
  const username = cleanAccount(account);
  if (!/^[a-z0-9._]{1,30}$/i.test(username)) throw new Error('Neispravno TikTok korisničko ime.');
  const html = await (await get(`https://www.tiktok.com/@${username}`)).text();
  let user;
  let stats;
  const json = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (json) {
    try {
      const data = JSON.parse(json);
      const info = data?.__DEFAULT_SCOPE__?.['webapp.user-detail']?.userInfo;
      user = info?.user;
      stats = info?.statsV2 ?? info?.stats;
    } catch {
      // fall back to regex below
    }
  }
  if (!stats) {
    const followers = html.match(/"followerCount":"?(\d+)"?/)?.[1];
    if (!followers) throw new Error('TikTok trenutno ne vraća podatke za taj račun.');
    stats = {
      followerCount: followers,
      followingCount: html.match(/"followingCount":"?(\d+)"?/)?.[1],
      heartCount: html.match(/"heartCount":"?(\d+)"?/)?.[1],
      videoCount: html.match(/"videoCount":"?(\d+)"?/)?.[1],
    };
  }
  return {
    platform: 'tiktok',
    account: user?.uniqueId ?? username,
    name: user?.nickname || username,
    avatarUrl: user?.avatarLarger ?? user?.avatarMedium ?? user?.avatarThumb ?? null,
    followers: Number(stats.followerCount ?? 0) || 0,
    following: Number(stats.followingCount ?? 0) || 0,
    likes: Number(stats.heartCount ?? stats.heart ?? 0) || 0,
    videos: Number(stats.videoCount ?? 0) || 0,
    verified: Boolean(user?.verified),
    bio: user?.signature ?? '',
    url: `https://www.tiktok.com/@${user?.uniqueId ?? username}`,
  };
}

async function youtube(input) {
  const raw = String(input ?? '').trim();
  if (!raw) throw new Error('Upiši YouTube kanal (npr. @MrBeast ili URL).');
  let url;
  if (/^https?:\/\//i.test(raw)) {
    const u = new URL(raw);
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(u.hostname)) throw new Error('To nije YouTube link.');
    if (u.pathname.startsWith('/@') || u.pathname.startsWith('/channel/') || u.pathname.startsWith('/c/') || u.pathname.startsWith('/user/')) {
      url = `https://www.youtube.com${u.pathname}`;
    } else {
      throw new Error('Link mora biti YouTube kanal, npr. https://youtube.com/@ime.');
    }
  } else if (/^UC[\w-]{20,}$/.test(raw)) {
    url = `https://www.youtube.com/channel/${raw}`;
  } else {
    url = `https://www.youtube.com/@${cleanAccount(raw)}`;
  }
  const html = await (await get(url, { Accept: 'text/html' })).text();
  const subscribers = html.match(/"interactionType":\{"type":"FollowAction"\},"userInteractionCount":"(\d+)"/)?.[1]
    ?? html.match(/"userInteractionCount":"(\d+)"/)?.[1]
    ?? html.match(/"subscriberCountText":[\s\S]{0,600}?"simpleText":"([^"]+)"/)?.[1];
  const name = meta(html, 'og:title') ?? html.match(/"channelMetadataRenderer":\{"title":"([^"]+)"/)?.[1];
  if (!subscribers) throw new Error('YouTube trenutno ne vraća broj pretplatnika za taj kanal.');
  const count = typeof subscribers === 'string' && /^\d+$/.test(subscribers) ? Number(subscribers) : humanNumber(subscribers);
  return {
    platform: 'youtube',
    account: cleanAccount(raw) || name,
    name: name || cleanAccount(raw),
    avatarUrl: meta(html, 'og:image'),
    subscribers: count,
    followers: count,
    url,
  };
}

async function twitch(account) {
  const username = cleanAccount(account);
  if (!/^[a-z0-9_]{2,25}$/i.test(username)) throw new Error('Neispravno Twitch korisničko ime.');
  const followers = (await (await get(`https://decapi.me/twitch/followcount/${encodeURIComponent(username)}`)).text()).trim();
  if (!/^\d+$/.test(followers)) throw new Error('Twitch trenutno ne vraća podatke za taj kanal.');
  const avatarUrl = await (await get(`https://decapi.me/twitch/avatar/${encodeURIComponent(username)}`)).text().then((t) => t.trim()).catch(() => null);
  const uptime = await (await get(`https://decapi.me/twitch/uptime/${encodeURIComponent(username)}`)).text().then((t) => t.trim()).catch(() => '');
  return {
    platform: 'twitch',
    account: username,
    name: username,
    avatarUrl: /^https?:\/\//.test(avatarUrl ?? '') ? avatarUrl : null,
    followers: Number(followers),
    live: Boolean(uptime) && !/offline/i.test(uptime),
    url: `https://www.twitch.tv/${username}`,
  };
}

const FETCHERS = { tiktok, youtube, twitch };

export async function fetchSocial(platform, account, { force = false } = {}) {
  const fetcher = FETCHERS[platform];
  if (!fetcher) throw new Error('Nepoznata platforma.');
  const key = `${platform}:${cleanAccount(account).toLowerCase()}`;
  const hit = cache.get(key);
  if (!force && hit && Date.now() - hit.at < CACHE_TTL) return hit.data;
  const data = await fetcher(account);
  cache.set(key, { at: Date.now(), data });
  return data;
}

export function clearSocialCache() {
  cache.clear();
}
