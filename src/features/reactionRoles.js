// Reaction roles: react on a message -> get role, remove reaction -> lose role.
import { EmbedBuilder } from 'discord.js';
import * as db from '../db.js';
import { COLOR, roleProblem } from '../utils/helpers.js';

// Unicode emojis sometimes come with/without the variation selector, so compare without it.
export function emojiKey(emoji) {
  return emoji.id ?? emoji.name?.replace(/️/g, '');
}

// Parses user input ("😀", "<:name:123>", "<a:name:123>") into { key, react, display }.
export function parseEmoji(input) {
  const text = input.trim();
  const custom = text.match(/^<(a?):(\w+):(\d+)>$/);
  if (custom) return { key: custom[3], react: custom[3], display: text };
  if (/^\d{15,25}$/.test(text)) return { key: text, react: text, display: `<:emoji:${text}>` };
  if (!text || /\s/.test(text) || /^[\w]+$/.test(text)) return null;
  return { key: text.replace(/️/g, ''), react: text, display: text };
}

export function managedPayload(entry) {
  const lines = Object.values(entry.roles).map((r) => `${r.emoji} — <@&${r.roleId}>`);
  const description = [entry.baseDescription, lines.length ? lines.join('\n') : '*Još nema rola.*'].filter(Boolean).join('\n\n');
  return {
    embeds: [new EmbedBuilder().setColor(entry.color ?? COLOR).setTitle(entry.title).setDescription(description)],
  };
}

export async function refreshManagedMessage(message, entry) {
  if (entry.managed && message.editable) await message.edit(managedPayload(entry));
}

async function resolve(reaction, user) {
  if (user.bot) return null;
  const guildId = reaction.message.guildId;
  if (!guildId) return null;
  const entry = db.guild(guildId).reactionRoles[reaction.message.id];
  const mapping = entry?.roles[emojiKey(reaction.emoji)];
  if (!mapping) return null;
  const guild = reaction.client.guilds.cache.get(guildId);
  const role = guild?.roles.cache.get(mapping.roleId);
  if (!role || roleProblem(guild, role)) return null;
  const member = await guild.members.fetch(user.id).catch(() => null);
  return member ? { member, role } : null;
}

export async function onReactionAdd(reaction, user) {
  const r = await resolve(reaction, user);
  if (r && !r.member.roles.cache.has(r.role.id)) await r.member.roles.add(r.role, 'Jaankeza Utils reaction role');
}

export async function onReactionRemove(reaction, user) {
  const r = await resolve(reaction, user);
  if (r && r.member.roles.cache.has(r.role.id)) await r.member.roles.remove(r.role, 'Jaankeza Utils reaction role');
}

export function onMessageDelete(message) {
  if (!message.guildId) return;
  const g = db.guild(message.guildId);
  if (g.reactionRoles[message.id]) {
    delete g.reactionRoles[message.id];
    db.save();
  }
}
