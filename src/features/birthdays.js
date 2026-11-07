// Birthdays: /birthday stores a day and month per member; a scheduler sends a
// celebration message (and optionally gives a birthday role for the day).
import { EmbedBuilder } from 'discord.js';
import * as db from '../db.js';
import { logActivity } from './activity.js';
import { fillTemplate, roleProblem } from '../utils/helpers.js';

export const DEFAULT_TIMEZONE = process.env.BOT_TIMEZONE || 'Europe/Zagreb';
export const DEFAULT_MESSAGE = '🎂 Sretan rođendan {user}!\n{server} ti želi sve najbolje.';
export const MONTHS = [
  'siječnja', 'veljače', 'ožujka', 'travnja', 'svibnja', 'lipnja',
  'srpnja', 'kolovoza', 'rujna', 'listopada', 'studenoga', 'prosinca',
];

const str = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const int = (value) => {
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
};

export function defaultConfig() {
  return { enabled: false, channelId: null, roleId: null, hour: 9, message: '', timezone: DEFAULT_TIMEZONE };
}

function safeTimezone(value) {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value }).format(new Date());
    return value;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function normalizeConfig(raw) {
  const base = defaultConfig();
  if (!raw || typeof raw !== 'object') return base;
  return {
    enabled: Boolean(raw.enabled),
    channelId: raw.channelId ? str(raw.channelId, 64) : null,
    roleId: raw.roleId ? str(raw.roleId, 64) : null,
    hour: Math.min(23, Math.max(0, int(raw.hour) ?? base.hour)),
    message: str(raw.message, 2000),
    timezone: safeTimezone(raw.timezone || DEFAULT_TIMEZONE),
  };
}

export function getConfig(guildId) {
  return normalizeConfig(db.guild(guildId).config.birthdays);
}

export function saveConfig(guildId, input = {}) {
  const cfg = getConfig(guildId);
  if ('enabled' in input) cfg.enabled = Boolean(input.enabled);
  if ('channelId' in input) cfg.channelId = input.channelId ? str(input.channelId, 64) : null;
  if ('roleId' in input) cfg.roleId = input.roleId ? str(input.roleId, 64) : null;
  if ('hour' in input) cfg.hour = Math.min(23, Math.max(0, int(input.hour) ?? cfg.hour));
  if ('message' in input) cfg.message = str(input.message, 2000);
  if ('timezone' in input) cfg.timezone = safeTimezone(input.timezone);
  db.guild(guildId).config.birthdays = cfg;
  db.save();
  return cfg;
}

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// Feb 29 is celebrated on Feb 28 in years that are not leap years.
export function effectiveDay(year, month, day) {
  return month === 2 && day === 29 && !isLeapYear(year) ? 28 : day;
}

export function validateBirthday({ day, month, year } = {}) {
  const d = int(day);
  const m = int(month);
  const y = year == null || year === '' ? null : int(year);
  if (d == null || m == null) throw new Error('Upiši dan i mjesec rođenja.');
  if (m < 1 || m > 12) throw new Error('Mjesec mora biti od 1 do 12.');
  if (d < 1 || d > 31) throw new Error('Dan mora biti od 1 do 31.');
  if (d > daysInMonth(y ?? 2000, m)) throw new Error('Taj datum ne postoji u odabranom mjesecu.');
  const currentYear = new Date().getFullYear();
  if (y != null && (y < 1900 || y > currentYear)) throw new Error(`Godina mora biti između 1900 i ${currentYear}.`);
  return { day: d, month: m, year: y };
}

const birthdays = (guildId) => (db.guild(guildId).birthdays ??= {});

export function getBirthday(guildId, userId) {
  const entry = birthdays(guildId)[userId];
  return entry ? { userId, ...entry } : null;
}

export function setBirthday(guildId, userId, input) {
  const value = validateBirthday(input);
  birthdays(guildId)[userId] = { ...value, setAt: Date.now(), lastCelebrated: null };
  db.save();
  return getBirthday(guildId, userId);
}

export function removeBirthday(guildId, userId) {
  const all = birthdays(guildId);
  if (!all[userId]) return false;
  delete all[userId];
  db.save();
  return true;
}

export function localParts(date = new Date(), timeZone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: safeTimezone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour') };
}

export function isBirthdayToday(entry, parts) {
  return Boolean(entry) && entry.month === parts.month && effectiveDay(parts.year, entry.month, entry.day) === parts.day;
}

export function nextBirthday(entry, now = new Date(), timeZone = DEFAULT_TIMEZONE) {
  if (!entry) return null;
  const today = localParts(now, timeZone);
  const todayUtc = Date.UTC(today.year, today.month - 1, today.day);
  for (const year of [today.year, today.year + 1]) {
    const day = effectiveDay(year, entry.month, entry.day);
    const at = Date.UTC(year, entry.month - 1, day);
    if (at >= todayUtc) {
      return {
        year,
        month: entry.month,
        day,
        daysUntil: Math.round((at - todayUtc) / 86_400_000),
        date: new Date(at),
      };
    }
  }
  return null;
}

export function formatDate(entry) {
  return `${entry.day}. ${MONTHS[entry.month - 1] ?? ''}`.trim();
}

export function ageOn(entry, year) {
  return entry.year ? Math.max(0, year - entry.year) : null;
}

export function listBirthdays(guildId, { now = new Date(), timeZone = DEFAULT_TIMEZONE } = {}) {
  return Object.entries(birthdays(guildId))
    .map(([userId, entry]) => {
      const next = nextBirthday(entry, now, timeZone);
      return { userId, ...entry, next };
    })
    .sort((a, b) => (a.next?.daysUntil ?? 9999) - (b.next?.daysUntil ?? 9999));
}

export function celebrationPayload(guild, member, entry, cfg, year) {
  const age = ageOn(entry, year);
  const text = fillTemplate(cfg.message || DEFAULT_MESSAGE, {
    user: `<@${member.id}>`,
    username: member.user.username,
    server: guild.name,
    age: age ?? '',
    date: formatDate(entry),
    memberCount: guild.memberCount,
  }).replace(/\n{3,}/g, '\n\n').trim();
  const embed = new EmbedBuilder()
    .setColor(0xf472b6)
    .setTitle('🎂 Sretan rođendan!')
    .setDescription(text.slice(0, 4096) || `Sretan rođendan, ${member}!`)
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .setTimestamp();
  if (age != null && age > 0) embed.addFields({ name: 'Puni', value: `${age} ${age % 10 === 1 && age % 100 !== 11 ? 'godinu' : 'godina'}`, inline: true });
  return { content: `<@${member.id}>`, embeds: [embed], allowedMentions: { users: [member.id] } };
}

async function sendCelebration(guild, entry, cfg, year, { force = false } = {}) {
  if (!force && entry.lastCelebrated === year) return false;
  const member = guild.members.cache.get(entry.userId) ?? (await guild.members.fetch(entry.userId).catch(() => null));
  if (!member) return false;
  const channel = cfg.channelId && guild.channels.cache.get(cfg.channelId);
  if (!channel) return false;
  await channel.send(celebrationPayload(guild, member, entry, cfg, year));
  logActivity(guild.id, 'birthday', `${member.user.username} ima rođendan`);
  const stored = birthdays(guild.id)[entry.userId];
  if (stored) stored.lastCelebrated = year;
  db.save();
  if (cfg.roleId) {
    const role = guild.roles.cache.get(cfg.roleId);
    if (role && !roleProblem(guild, role)) {
      await member.roles.add(role, `${guild.client.user.username}: rođendan`).catch(() => {});
      const roles = (db.guild(guild.id).birthdayRoles ??= {});
      roles[entry.userId] = { year, roleId: role.id };
      db.save();
    }
  }
  return true;
}

async function cleanupRoles(guild, cfg, today) {
  const g = db.guild(guild.id);
  const active = g.birthdayRoles;
  if (!active || !Object.keys(active).length) return;
  let changed = false;
  for (const [userId, info] of Object.entries(active)) {
    const entry = g.birthdays?.[userId];
    const stillToday = cfg.enabled && entry && isBirthdayToday(entry, today);
    if (stillToday) continue;
    const member = guild.members.cache.get(userId);
    const role = info.roleId && guild.roles.cache.get(info.roleId);
    if (member && role && member.roles.cache.has(role.id)) {
      await member.roles.remove(role, `${guild.client.user.username}: rođendan je završio`).catch(() => {});
    }
    delete active[userId];
    changed = true;
  }
  if (changed) db.save();
}

export async function tickGuild(guild, { force = false, now = new Date() } = {}) {
  const cfg = getConfig(guild.id);
  const today = localParts(now, cfg.timezone);
  await cleanupRoles(guild, cfg, today);
  if (!cfg.enabled || !cfg.channelId) return { sent: 0 };
  if (!force && today.hour < cfg.hour) return { sent: 0 };
  let sent = 0;
  for (const [userId, entry] of Object.entries(birthdays(guild.id))) {
    if (!isBirthdayToday(entry, today)) continue;
    if (await sendCelebration(guild, { userId, ...entry }, cfg, today.year, { force })) sent += 1;
  }
  return { sent };
}

export async function sendTest(guild, member) {
  const cfg = getConfig(guild.id);
  if (!cfg.channelId) throw new Error('Prvo odaberi kanal za rođendane.');
  const channel = guild.channels.cache.get(cfg.channelId);
  if (!channel) throw new Error('Odabrani kanal više ne postoji.');
  const entry = getBirthday(guild.id, member.id) ?? { userId: member.id, day: 1, month: 1, year: null };
  await channel.send(celebrationPayload(guild, member, entry, cfg, new Date().getFullYear()));
  return true;
}

let timer = null;
let kickoff = null;

async function tick(client) {
  for (const guild of client.guilds.cache.values()) {
    try {
      await tickGuild(guild);
    } catch (err) {
      console.error(`[birthdays] ${guild.name}:`, err);
    }
  }
}

export function start(client) {
  stop();
  kickoff = setTimeout(() => tick(client).catch((err) => console.error('[birthdays]', err)), 20_000);
  kickoff.unref?.();
  timer = setInterval(() => tick(client).catch((err) => console.error('[birthdays]', err)), 15 * 60 * 1000);
  timer.unref?.();
}

export function stop() {
  if (kickoff) clearTimeout(kickoff);
  if (timer) clearInterval(timer);
  kickoff = null;
  timer = null;
}
