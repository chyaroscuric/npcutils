// Small per-server log of recent events, shown on the dashboard overview.
import * as db from '../db.mjs';

const MAX_ENTRIES = 30;

export function logActivity(guildId, type, text) {
  const g = db.guild(guildId);
  g.activity = [{ type, text, at: Date.now() }, ...(g.activity ?? [])].slice(0, MAX_ENTRIES);
  db.save();
}

export function recentActivity(guildId) {
  return db.guild(guildId).activity ?? [];
}
