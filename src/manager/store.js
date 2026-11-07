// Persistent registry for BYOT bots. Tokens are encrypted with AES-256-GCM.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.env.MANAGER_DATA_DIR || process.env.DATA_DIR || 'data');
const DIR = path.join(ROOT, 'manager');
const FILE = path.join(DIR, 'bots.json');
const KEY_FILE = path.join(DIR, 'key');
let data = { bots: {} };

export const botsDir = (botId) => path.join(ROOT, 'bots', botId);

function ensureDir() {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
}

function key() {
  if (process.env.TOKEN_ENCRYPTION_KEY) {
    return crypto.createHash('sha256').update(process.env.TOKEN_ENCRYPTION_KEY).digest();
  }
  ensureDir();
  try {
    return Buffer.from(fs.readFileSync(KEY_FILE, 'utf8').trim(), 'base64');
  } catch {
    const generated = crypto.randomBytes(32);
    fs.writeFileSync(KEY_FILE, generated.toString('base64'), { mode: 0o600 });
    return generated;
  }
}

export function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`;
}

export function decrypt(payload) {
  const [iv, tag, body] = String(payload || '').split('.');
  if (!iv || !tag || !body) throw new Error('Neispravan zapis tokena.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
}

export function load() {
  ensureDir();
  if (fs.existsSync(FILE)) data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  data.bots ??= {};
}

export function save() {
  ensureDir();
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}

export const list = () => Object.values(data.bots);
export const get = (id) => data.bots[id] ?? null;
export const tokenOf = (id) => (data.bots[id] ? decrypt(data.bots[id].token) : null);

export function add(record) {
  data.bots[record.id] = record;
  save();
  return record;
}

export function update(id, patch) {
  if (!data.bots[id]) return null;
  data.bots[id] = { ...data.bots[id], ...patch };
  save();
  return data.bots[id];
}

export function remove(id) {
  if (!data.bots[id]) return false;
  delete data.bots[id];
  save();
  return true;
}
