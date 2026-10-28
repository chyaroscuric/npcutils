import { EmbedBuilder, MessageFlags, PermissionFlagsBits } from 'discord.js';

export const COLOR = 0x5865f2;
export const COLOR_OK = 0x57f287;
export const COLOR_ERR = 0xed4245;
export const COLOR_BOOST = 0xf47fff;

export function embed(description, color = COLOR) {
  return new EmbedBuilder().setColor(color).setDescription(description);
}

// Replies ephemerally whether or not the interaction was already acknowledged.
export async function reply(interaction, content, { ok = true, ephemeral = true } = {}) {
  const embeds = [embed(content, ok ? COLOR_OK : COLOR_ERR)];
  // a deferred reply keeps the visibility chosen in deferReply()
  if (interaction.deferred && !interaction.replied) return interaction.editReply({ embeds });
  const payload = { embeds, flags: ephemeral ? MessageFlags.Ephemeral : undefined };
  if (interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

export const fail = (interaction, content) => reply(interaction, `❌ ${content}`, { ok: false });

// Replaces {placeholders} in user-defined messages.
export function fillTemplate(template, values) {
  return template
    .replace(/\\n/g, '\n')
    .replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
}

// Checks whether the bot can give/take the role.
export function roleProblem(guild, role) {
  const me = guild.members.me;
  if (role.id === guild.id) return 'Ne mogu koristiti @everyone rolu.';
  if (role.managed) return `Rola ${role} pripada integraciji/botu i ne može se dodjeljivati.`;
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return 'Nemam permisiju **Manage Roles**.';
  if (me.roles.highest.comparePositionTo(role) <= 0) {
    return `Rola ${role} je iznad moje najviše role. Pomakni rolu **${me.roles.highest.name}** iznad nje u postavkama servera.`;
  }
  return null;
}

export function isAdmin(member) {
  return member.permissions.has(PermissionFlagsBits.ManageGuild);
}
