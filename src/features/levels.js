// Levels from message activity and time spent in voice channels.
import * as db from '../db.js';

export function defaultConfig() {
  return {
    enabled: true,
    announce: true,
    xpPerMessage: 15,
    xpPerMinuteVoice: 5,
    cooldownSec: 60,
  };
}

export function getConfig(guildId) {
  return { ...defaultConfig(), ...(db.guild(guildId).config.levels ?? {}) };
}

export function saveConfig(guildId, input = {}) {
  const next = getConfig(guildId);
  for (const key of ['enabled', 'announce']) if (key in input) next[key] = Boolean(input[key]);
  if ('xpPerMessage' in input) next.xpPerMessage = Math.min(100, Math.max(1, Math.round(Number(input.xpPerMessage)) || 15));
  if ('xpPerMinuteVoice' in input) next.xpPerMinuteVoice = Math.min(100, Math.max(0, Math.round(Number(input.xpPerMinuteVoice)) || 0));
  if ('cooldownSec' in input) next.cooldownSec = Math.min(3600, Math.max(0, Math.round(Number(input.cooldownSec)) || 0));
  db.guild(guildId).config.levels = next;
  db.save();
  return next;
}

export function levelForXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, Number(xp) || 0) / 100));
}

export function xpForLevel(level) {
  return 100 * Math.max(0, Number(level) || 0) ** 2;
}

export function totalXp(user, cfg) {
  return Math.max(0, Number(user?.messageXp) || 0) + Math.floor((Number(user?.voiceMs) || 0) / 60000) * cfg.xpPerMinuteVoice;
}

function ensureUser(guildId, userId) {
  const g = db.guild(guildId);
  g.levelUsers ??= {};
  const u = (g.levelUsers[userId] ??= { messages: 0, voiceMs: 0, messageXp: 0, lastXpAt: 0 });
  u.messages ??= 0;
  u.voiceMs ??= 0;
  u.messageXp ??= 0;
  u.lastXpAt ??= 0;
  return u;
}

export async function onMessage(message) {
  if (message.author.bot) return false;
  const cfg = getConfig(message.guild.id);
  if (!cfg.enabled) return false;
  const user = ensureUser(message.guild.id, message.author.id);
  user.messages += 1;
  const now = Date.now();
  if (now - (user.lastXpAt || 0) >= cfg.cooldownSec * 1000) {
    const before = levelForXp(totalXp(user, cfg));
    user.messageXp += cfg.xpPerMessage;
    user.lastXpAt = now;
    const after = levelForXp(totalXp(user, cfg));
    db.save();
    if (after > before && cfg.announce) {
      await message.channel
        .send({ content: `🎉 <@${message.author.id}> je dosegao/la **level ${after}**!`, allowedMentions: { users: [message.author.id] } })
        .catch(() => {});
    }
  } else {
    db.save();
  }
  return false;
}

// ---------- voice tracking ----------
const voiceSessions = new Map(); // `${guildId}:${userId}` -> { at, channelId }
let timer = null;

function voiceEnabled(state) {
  return Boolean(state?.channelId) && state.channelId !== state.guild?.afkChannelId && !state.selfDeaf && !state.serverDeaf;
}

function addVoice(guildId, userId, ms) {
  if (ms <= 0) return;
  const user = ensureUser(guildId, userId);
  user.voiceMs += ms;
}

function startSession(guildId, userId, channelId, at = Date.now()) {
  voiceSessions.set(`${guildId}:${userId}`, { at, channelId });
}

function endSession(guildId, userId, now = Date.now()) {
  const key = `${guildId}:${userId}`;
  const session = voiceSessions.get(key);
  if (!session) return;
  addVoice(guildId, userId, now - session.at);
  voiceSessions.delete(key);
}

export function onVoiceStateUpdate(oldState, newState) {
  const member = newState.member ?? oldState.member;
  const guild = newState.guild ?? oldState.guild;
  if (!member || member.user.bot || !guild) return;
  const cfg = getConfig(guild.id);
  if (!cfg.enabled) {
    endSession(guild.id, member.id);
    return;
  }
  const was = voiceEnabled(oldState);
  const is = voiceEnabled(newState);
  if (was && (!is || oldState.channelId !== newState.channelId)) endSession(guild.id, member.id);
  if (is && (!was || oldState.channelId !== newState.channelId)) startSession(guild.id, member.id, newState.channelId);
}

export function flushVoice(now = Date.now()) {
  if (!voiceSessions.size) return;
  for (const [key, session] of voiceSessions) {
    const [guildId, userId] = key.split(':');
    addVoice(guildId, userId, now - session.at);
    session.at = now;
  }
  db.save();
}

export function start(client) {
  for (const guild of client.guilds.cache.values()) {
    for (const state of guild.voiceStates.cache.values()) {
      if (state.member && !state.member.user.bot && voiceEnabled(state)) startSession(guild.id, state.id, state.channelId);
    }
  }
  if (timer) clearInterval(timer);
  timer = setInterval(() => flushVoice(), 5 * 60 * 1000);
  timer.unref?.();
}

export function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  flushVoice();
}

// ---------- read/reset ----------
export function statsFor(guildId, userId) {
  const cfg = getConfig(guildId);
  const user = db.guild(guildId).levelUsers?.[userId] ?? { messages: 0, voiceMs: 0, messageXp: 0, lastXpAt: 0 };
  const xp = totalXp(user, cfg);
  return { userId, messages: user.messages ?? 0, voiceMs: user.voiceMs ?? 0, xp, level: levelForXp(xp) };
}

export function top(guildId, limit = 10) {
  const cfg = getConfig(guildId);
  const list = Object.keys(db.guild(guildId).levelUsers ?? {}).map((id) => statsFor(guildId, id));
  const text = [...list].sort((a, b) => b.messages - a.messages).slice(0, limit);
  const voice = [...list].sort((a, b) => b.voiceMs - a.voiceMs).slice(0, limit);
  return { text, voice };
}

export function rank(guildId, userId) {
  const cfg = getConfig(guildId);
  const list = Object.keys(db.guild(guildId).levelUsers ?? {})
    .map((id) => statsFor(guildId, id))
    .sort((a, b) => b.xp - a.xp);
  const index = list.findIndex((u) => u.userId === userId);
  return { ...statsFor(guildId, userId), rank: index < 0 ? null : index + 1, total: list.length, cfg };
}

export function resetUser(guildId, userId) {
  const g = db.guild(guildId);
  if (!g.levelUsers?.[userId]) return false;
  delete g.levelUsers[userId];
  db.save();
  return true;
}

export function resetAll(guildId) {
  db.guild(guildId).levelUsers = {};
  db.save();
}
