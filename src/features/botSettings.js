// Global bot settings (presence/status) editable from the dashboard.
import { ActivityType } from 'discord.js';
import * as db from '../db.js';

export const STATUS_TYPES = {
  custom: 'Custom',
  playing: 'Playing',
  watching: 'Watching',
  listening: 'Listening',
  competing: 'Competing',
};

export const PRESENCE_STATES = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do Not Disturb',
  invisible: 'Invisible',
};

const ACTIVITY_TYPES = {
  custom: ActivityType.Custom,
  playing: ActivityType.Playing,
  watching: ActivityType.Watching,
  listening: ActivityType.Listening,
  competing: ActivityType.Competing,
};

const MAX_TEXT = 128;

export function getSettings() {
  const stored = db.bot().status ?? {};
  return {
    status: {
      text: String(stored.text ?? '').slice(0, MAX_TEXT),
      type: STATUS_TYPES[stored.type] ? stored.type : 'custom',
      state: PRESENCE_STATES[stored.state] ? stored.state : 'online',
    },
  };
}

export function saveSettings(input) {
  const next = getSettings();
  if (input.status) {
    const text = String(input.status.text ?? '').trim().slice(0, MAX_TEXT);
    const type = STATUS_TYPES[input.status.type] ? input.status.type : 'custom';
    const state = PRESENCE_STATES[input.status.state] ? input.status.state : 'online';
    next.status = { text, type, state };
  }
  db.bot().status = next.status;
  db.save();
  return next;
}

function activityFor(status) {
  if (status.type === 'custom') return { name: status.text, state: status.text, type: ActivityType.Custom };
  return { name: status.text, type: ACTIVITY_TYPES[status.type] };
}

export async function applyStatus(client) {
  if (!client.user) return;
  const { status } = getSettings();
  const activities = status.text ? [activityFor(status)] : [];
  await client.user.setPresence({ status: status.state, activities }).catch((err) => {
    console.warn('[status] Ne mogu postaviti status:', err.message);
  });
}

// The bot owner (or every member of the owning team) may change global settings.
export function ownerIds(client) {
  const ids = new Set();
  if (process.env.BOT_OWNER_ID) ids.add(process.env.BOT_OWNER_ID);
  const owner = client.application?.owner;
  if (!owner) return ids;
  if (owner.ownerId) ids.add(owner.ownerId);
  if (owner.id) ids.add(owner.id);
  for (const member of owner.members?.values?.() ?? []) ids.add(member.user?.id ?? member.id);
  return ids;
}

export const canEdit = (client, userId) => ownerIds(client).has(userId);
