// Auto-generated welcome banner: a background image with the member's avatar,
// name and a configurable title. Rendered with @napi-rs/canvas, so no browser is
// needed. The banner is attached to the welcome message as welcome.png.
import { GlobalFonts, createCanvas, loadImage } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';
import { fillTemplate } from '../utils/helpers.js';

const FONT = 'WelcomeFont';
GlobalFonts.registerFromPath(fileURLToPath(new URL('../assets/fonts/Poppins-Bold.ttf', import.meta.url)), FONT);

const WIDTH = 1024;
const HEIGHT = 512;
const AVATAR = 136;
const AVATAR_X = 96;
const AVATAR_Y = 318;
const NAME_BOX_X = 270;
const NAME_BOX_Y = 344;
const NAME_BOX_H = 84;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export const DEFAULT_BANNER = {
  enabled: false,
  backgroundUrl: '',
  title: 'Dobrodošao/la kod {server}',
  subtitle: 'Novi član · {memberCount}.',
  accentColor: '#f472b6',
  nameColor: '#1f2937',
  overlay: 0.32,
  showTitle: true,
  showSubtitle: true,
  avatarX: 0.16,
  avatarY: 0.75,
  avatarSize: 0.133,
  nameX: 0.55,
  nameY: 0.75,
  nameSize: 0.074,
};

const backgroundCache = new Map(); // url -> { at, image }

function hex(value, fallback) {
  const raw = String(value ?? '').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(raw)) return `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`.toLowerCase();
  return fallback;
}

const clamp = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

function rgba(hexColor, alpha) {
  const value = hex(hexColor, DEFAULT_BANNER.accentColor).slice(1);
  const r = Number.parseInt(value.slice(0, 2), 16);
  const g = Number.parseInt(value.slice(2, 4), 16);
  const b = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function safeUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(raw)) {
    return raw.length <= 4_000_000 ? raw : '';
  }
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}

export function normalizeBanner(raw, defaults = {}) {
  const base = { ...DEFAULT_BANNER, ...defaults };
  if (!raw || typeof raw !== 'object') return { ...base };
  return {
    enabled: Boolean(raw.enabled),
    backgroundUrl: safeUrl(raw.backgroundUrl),
    title: String(raw.title ?? base.title).trim().slice(0, 160) || base.title,
    subtitle: String(raw.subtitle ?? base.subtitle).trim().slice(0, 160),
    accentColor: hex(raw.accentColor, base.accentColor),
    nameColor: hex(raw.nameColor, base.nameColor),
    overlay: clamp(raw.overlay, 0, 0.8, base.overlay),
    showTitle: raw.showTitle !== false,
    showSubtitle: raw.showSubtitle !== false,
    avatarX: clamp(raw.avatarX, 0, 1, base.avatarX),
    avatarY: clamp(raw.avatarY, 0, 1, base.avatarY),
    avatarSize: clamp(raw.avatarSize, 0.05, 0.4, base.avatarSize),
    nameX: clamp(raw.nameX, 0, 1, base.nameX),
    nameY: clamp(raw.nameY, 0, 1, base.nameY),
    nameSize: clamp(raw.nameSize, 0.03, 0.2, base.nameSize),
  };
}

async function fetchImage(url) {
  if (String(url).startsWith('data:')) {
    const comma = String(url).indexOf(',');
    if (comma < 0) throw new Error('Neispravna data URL.');
    return Buffer.from(String(url).slice(comma + 1), 'base64');
  }
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = String(res.headers.get('content-type') || '');
  if (type && !type.startsWith('image/')) throw new Error('URL nije slika.');
  return Buffer.from(await res.arrayBuffer());
}

// Uploads are cropped to the banner size and stored as a compact JPEG data URL,
// so the image lives in the bot database and works behind the BYOT proxy too.
export async function processBannerImage(buffer) {
  const image = await loadImage(buffer);
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#1c1e23';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawCover(ctx, image);
  const jpeg = canvas.toBuffer('image/jpeg', 85);
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

async function backgroundImage(url) {
  if (String(url).startsWith('data:')) return loadImage(await fetchImage(url));
  const hit = backgroundCache.get(url);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.image;
  const image = await loadImage(await fetchImage(url));
  backgroundCache.set(url, { at: Date.now(), image });
  if (backgroundCache.size > 8) backgroundCache.delete(backgroundCache.keys().next().value);
  return image;
}

function roundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawCover(ctx, image) {
  const scale = Math.max(WIDTH / image.width, HEIGHT / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
}

function fitFont(ctx, text, maxWidth, start, min) {
  let size = start;
  do {
    ctx.font = `${size}px ${FONT}`;
    if (ctx.measureText(text).width <= maxWidth) break;
    size -= 2;
  } while (size > min);
  return size;
}

async function drawAvatar(ctx, url, cx, cy, size, accent) {
  const x = cx - size / 2;
  const y = cy - size / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fillStyle = '#4f545c';
  ctx.fill();
  ctx.clip();
  try {
    const image = await loadImage(await fetchImage(url));
    const scale = Math.max(size / image.width, size / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    ctx.drawImage(image, cx - w / 2, cy - h / 2, w, h);
  } catch {
    // keep the neutral fallback circle
  }
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 - 3, 0, Math.PI * 2);
  ctx.strokeStyle = accent;
  ctx.lineWidth = Math.max(4, Math.round(size * 0.044));
  ctx.stroke();
  ctx.restore();
}

function drawNameBox(ctx, name, cx, cy, fontPx, nameColor) {
  ctx.save();
  ctx.font = `${fontPx}px ${FONT}`;
  const height = Math.max(48, Math.round(fontPx * 2.1));
  const width = Math.min(WIDTH - 48, Math.max(200, ctx.measureText(name).width + 96));
  const x = Math.min(WIDTH - 24 - width, Math.max(24, cx - width / 2));
  const y = Math.min(HEIGHT - 24 - height, Math.max(24, cy - height / 2));
  roundedRect(ctx, x, y, width, height, height / 2);
  ctx.fillStyle = 'rgba(255,255,255,0.94)';
  ctx.fill();
  ctx.fillStyle = nameColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const size = fitFont(ctx, name, width - 48, fontPx, 18);
  ctx.font = `${size}px ${FONT}`;
  ctx.fillText(name, x + width / 2, y + height / 2 + 1);
  ctx.restore();
}

export async function renderWelcomeBanner({
  backgroundUrl,
  avatarUrl,
  name,
  serverName,
  title = DEFAULT_BANNER.title,
  subtitle = DEFAULT_BANNER.subtitle,
  accentColor = DEFAULT_BANNER.accentColor,
  nameColor = DEFAULT_BANNER.nameColor,
  overlay = DEFAULT_BANNER.overlay,
  showTitle = true,
  showSubtitle = true,
  avatarX = DEFAULT_BANNER.avatarX,
  avatarY = DEFAULT_BANNER.avatarY,
  avatarSize = DEFAULT_BANNER.avatarSize,
  nameX = DEFAULT_BANNER.nameX,
  nameY = DEFAULT_BANNER.nameY,
  nameSize = DEFAULT_BANNER.nameSize,
  memberCount,
} = {}) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const accent = hex(accentColor, DEFAULT_BANNER.accentColor);
  const values = {
    server: serverName ?? '',
    username: name ?? '',
    name: name ?? '',
    memberCount: memberCount ?? '',
  };
  const layout = {
    avatarX: clamp(avatarX, 0, 1, DEFAULT_BANNER.avatarX),
    avatarY: clamp(avatarY, 0, 1, DEFAULT_BANNER.avatarY),
    avatarSize: clamp(avatarSize, 0.05, 0.4, DEFAULT_BANNER.avatarSize),
    nameX: clamp(nameX, 0, 1, DEFAULT_BANNER.nameX),
    nameY: clamp(nameY, 0, 1, DEFAULT_BANNER.nameY),
    nameSize: clamp(nameSize, 0.03, 0.2, DEFAULT_BANNER.nameSize),
  };

  ctx.fillStyle = '#1c1e23';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  if (backgroundUrl) {
    try {
      drawCover(ctx, await backgroundImage(backgroundUrl));
    } catch {
      // flat fallback, still readable
    }
  }
  ctx.fillStyle = `rgba(0,0,0,${Math.min(0.8, Math.max(0, Number(overlay) || 0))})`;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const titleText = showTitle ? fillTemplate(title, values).replace(/\s+/g, ' ').trim() : '';
  const subtitleText = showSubtitle ? fillTemplate(subtitle ?? '', values).replace(/\s+/g, ' ').trim() : '';
  if (titleText || subtitleText) {
    // A quiet accent block behind the title keeps text readable on busy art.
    ctx.fillStyle = rgba(accent, 0.2);
    roundedRect(ctx, 72, 70, WIDTH - 144, 210, 28);
    ctx.fill();
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = '#ffffff';
    if (titleText) {
      const titleSize = fitFont(ctx, titleText, WIDTH - 200, 82, 42);
      ctx.font = `${titleSize}px ${FONT}`;
      ctx.fillText(titleText, WIDTH / 2, subtitleText ? 148 : 175);
    }
    if (subtitleText) {
      ctx.shadowBlur = 10;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      const subSize = fitFont(ctx, subtitleText, WIDTH - 260, 30, 20);
      ctx.font = `${subSize}px ${FONT}`;
      ctx.fillText(subtitleText, WIDTH / 2, titleText ? 224 : 175);
    }
    ctx.restore();
  }

  const avatarPx = Math.max(24, Math.round(WIDTH * layout.avatarSize));
  await drawAvatar(ctx, avatarUrl, WIDTH * layout.avatarX, HEIGHT * layout.avatarY, avatarPx, accent);
  const namePx = Math.max(16, Math.round(HEIGHT * layout.nameSize));
  drawNameBox(ctx, String(name ?? '').slice(0, 80) || 'Član', WIDTH * layout.nameX, HEIGHT * layout.nameY, namePx, hex(nameColor, DEFAULT_BANNER.nameColor));
  return canvas.toBuffer('image/png');
}

export const BANNER_SIZE = { width: WIDTH, height: HEIGHT };
