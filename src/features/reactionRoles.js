// Reaction roles: react on a message -> get role, remove reaction -> lose role.
import { EmbedBuilder } from 'discord.js';
import * as db from '../db.js';
import { COLOR, UserError, roleProblem } from '../utils/helpers.js';

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

export const DEFAULT_DESCRIPTION = 'Klikni na emoji ispod da dobiješ rolu. Makni reakciju da je izgubiš.';

// Posts a new embed that lists its emoji -> role pairs and keeps itself up to date.
export async function createManagedMessage(channel, title, description) {
  const entry = {
    channelId: channel.id,
    roles: {},
    managed: true,
    title,
    baseDescription: description?.replace(/\\n/g, '\n') || DEFAULT_DESCRIPTION,
  };
  let message;
  try {
    message = await channel.send(managedPayload(entry));
  } catch {
    throw new UserError(`Ne mogu slati poruke u ${channel}.`);
  }
  db.guild(channel.guild.id).reactionRoles[message.id] = entry;
  db.save();
  return message;
}

export async function addReactionRole(channel, messageId, emojiInput, role) {
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) throw new UserError('Ne mogu naći tu poruku. Provjeri ID poruke i kanal.');
  const emoji = parseEmoji(emojiInput);
  if (!emoji) throw new UserError('Neispravan emoji.');
  const problem = roleProblem(channel.guild, role);
  if (problem) throw new UserError(problem);
  try {
    await message.react(emoji.react);
  } catch {
    throw new UserError('Ne mogu reagirati tim emojijem (custom emoji mora biti sa servera na kojem sam).');
  }
  const g = db.guild(channel.guild.id);
  const entry = (g.reactionRoles[message.id] ??= { channelId: message.channel.id, roles: {}, managed: false });
  entry.roles[emoji.key] = { roleId: role.id, emoji: emoji.display };
  db.save();
  await refreshManagedMessage(message, entry).catch(() => {});
  return { message, emoji };
}

export async function removeReactionRole(guild, messageId, key) {
  const g = db.guild(guild.id);
  const entry = g.reactionRoles[messageId];
  if (!entry?.roles[key]) throw new UserError('Taj emoji nije povezan ni s jednom rolom na toj poruci.');
  delete entry.roles[key];
  if (!entry.managed && !Object.keys(entry.roles).length) delete g.reactionRoles[messageId];
  db.save();
  const message = await guild.channels.cache.get(entry.channelId)?.messages.fetch(messageId).catch(() => null);
  if (message) {
    const reaction = message.reactions.cache.find((r) => emojiKey(r.emoji) === key);
    await reaction?.users.remove(guild.client.user.id).catch(() => {});
    await refreshManagedMessage(message, entry).catch(() => {});
  }
}

// Stops tracking a message; bot-made (managed) messages are deleted too.
export async function deleteReactionRoleMessage(guild, messageId) {
  const g = db.guild(guild.id);
  const entry = g.reactionRoles[messageId];
  if (!entry) throw new UserError('Ta poruka nije reaction role poruka.');
  delete g.reactionRoles[messageId];
  db.save();
  if (entry.managed) {
    const message = await guild.channels.cache.get(entry.channelId)?.messages.fetch(messageId).catch(() => null);
    await message?.delete().catch(() => {});
  }
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
