// Counting game: members count 1, 2, 3... in one channel; a wrong number resets the counter.
import * as db from '../db.js';

export function getConfig(guildId) {
  const cfg = db.guild(guildId).counting;
  return cfg?.channelId ? cfg : null;
}

export function setup(guildId, channelId) {
  const g = db.guild(guildId);
  g.counting = { channelId, current: 0, lastUserId: null, best: g.counting?.best ?? 0 };
  db.save();
  return g.counting;
}

export function disable(guildId) {
  delete db.guild(guildId).counting;
  db.save();
}

export function reset(guildId) {
  const cfg = getConfig(guildId);
  if (!cfg) return null;
  cfg.current = 0;
  cfg.lastUserId = null;
  db.save();
  return cfg;
}

export async function onMessage(message) {
  const cfg = getConfig(message.guild.id);
  if (!cfg || message.channelId !== cfg.channelId) return false;
  if (message.author.bot) return true;
  const text = String(message.content ?? '').trim();
  if (!/^\d+$/.test(text)) return true;

  const number = Number(text);
  const expected = cfg.current + 1;
  if (number === expected) {
    cfg.current = number;
    cfg.lastUserId = message.author.id;
    cfg.best = Math.max(cfg.best ?? 0, number);
    db.save();
    await message.react('✅').catch(() => {});
    return true;
  }

  const ruinedAt = cfg.current;
  cfg.current = 0;
  cfg.lastUserId = null;
  db.save();
  await message.react('❌').catch(() => {});
  await message.channel
    .send({
      content: `<@${message.author.id}> POKVARIO/LA SI NA ${ruinedAt}! Sljedeći broj je 1. Pogrešan broj.`,
      allowedMentions: { users: [message.author.id] },
    })
    .catch(() => {});
  return true;
}
