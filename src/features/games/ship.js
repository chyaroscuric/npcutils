// /ship: a love percentage for two people, drawn as an image with both avatars and a heart.
import crypto from 'node:crypto';
import { GlobalFonts, createCanvas, loadImage } from '@napi-rs/canvas';
import { fileURLToPath } from 'node:url';

const FONT = 'ShipFont';
// bundled so the text renders on hosts without any system fonts
GlobalFonts.registerFromPath(fileURLToPath(new URL('../../assets/fonts/Poppins-Bold.ttf', import.meta.url)), FONT);

const WIDTH = 1000;
const HEIGHT = 420;
const AVATAR = 300;

// Same pair -> same result, whichever order they are given in.
export function shipPercent(idA, idB) {
  const [a, b] = [idA, idB].sort();
  const hash = crypto.createHash('sha256').update(`${a}:${b}:ship`).digest();
  return hash.readUInt32BE(0) % 101;
}

export function shipName(nameA, nameB) {
  const first = nameA.slice(0, Math.ceil(nameA.length / 2));
  const second = nameB.slice(Math.floor(nameB.length / 2));
  return first + second;
}

export function comment(percent) {
  if (percent <= 20) return 'Ovo neće ići… 💔';
  if (percent <= 40) return 'Bolje da ostanete prijatelji. 🙂';
  if (percent <= 60) return 'Ima nečega, ali treba truda. 🤔';
  if (percent <= 80) return 'Lijep par! 💕';
  if (percent <= 95) return 'Stvoreni ste jedno za drugo! 💖';
  return 'Srodne duše! 💍';
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function drawAvatar(ctx, url, x, y) {
  ctx.save();
  roundedRect(ctx, x, y, AVATAR, AVATAR, 24);
  ctx.clip();
  try {
    ctx.drawImage(await loadImage(url), x, y, AVATAR, AVATAR);
  } catch {
    ctx.fillStyle = '#4f545c';
    ctx.fillRect(x, y, AVATAR, AVATAR);
  }
  ctx.restore();
}

function drawHeart(ctx, cx, cy, size) {
  const s = size / 100;
  ctx.beginPath();
  ctx.moveTo(cx, cy + 35 * s);
  ctx.bezierCurveTo(cx - 70 * s, cy - 10 * s, cx - 55 * s, cy - 75 * s, cx, cy - 45 * s);
  ctx.bezierCurveTo(cx + 55 * s, cy - 75 * s, cx + 70 * s, cy - 10 * s, cx, cy + 35 * s);
  ctx.closePath();
  ctx.fillStyle = '#dd2e44';
  ctx.fill();
}

export async function renderShip(avatarA, avatarB, percent) {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const top = (HEIGHT - AVATAR) / 2;
  await drawAvatar(ctx, avatarA, 50, top);
  await drawAvatar(ctx, avatarB, WIDTH - 50 - AVATAR, top);

  drawHeart(ctx, WIDTH / 2, HEIGHT / 2 + 15, 280);
  ctx.fillStyle = '#ffffff';
  ctx.font = `76px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${percent}%`, WIDTH / 2, HEIGHT / 2 - 18);
  return canvas.toBuffer('image/png');
}
