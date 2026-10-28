// Simple JSON file storage. Fine for one (or a few) servers; writes are debounced and atomic.
import fs from 'node:fs';
import path from 'node:path';

let FILE = null;
let data = { guilds: {} };
let saveTimer = null;

export function load() {
  const dir = path.resolve(process.env.DATA_DIR || 'data');
  fs.mkdirSync(dir, { recursive: true });
  FILE = path.join(dir, 'db.json');
  if (fs.existsSync(FILE)) {
    data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  }
  data.guilds ??= {};
}

export function guild(guildId) {
  const g = (data.guilds[guildId] ??= {});
  g.config ??= {};
  g.invites ??= {}; // inviterId -> { regular, left, fake, bonus }
  g.joins ??= {}; // memberId -> { inviterId, code, fake, at }
  g.tickets ??= { counter: 0, open: {} }; // open: channelId -> { ownerId, number, createdAt }
  g.reactionRoles ??= {}; // messageId -> { channelId, roles: { emojiKey: { roleId, emoji } }, managed, baseDescription }
  g.giveaways ??= {}; // messageId -> giveaway
  return g;
}

export function allGuildIds() {
  return Object.keys(data.guilds);
}

export function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flush();
  }, 1000);
}

export function flush() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!FILE) return;
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}
