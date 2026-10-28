import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as db from '../db.mjs';
import { addReactionRole, createManagedMessage, parseEmoji, removeReactionRole } from '../features/reactionRoles.mjs';
import { fail, reply } from '../utils/helpers.mjs';

const channelOption = (o) =>
  o
    .setName('kanal')
    .setDescription('Kanal u kojem je poruka (default: ovaj)')
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

// Acknowledged right away (ephemeral) because these commands talk to Discord and can take >3 s.
export const deferEphemeral = true;

export const data = new SlashCommandBuilder()
  .setName('reactionrole')
  .setDescription('Reaction roles - klikni emoji, dobij rolu')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('create')
      .setDescription('Pošalji novu reaction role poruku (embed koji se sam ažurira)')
      .addStringOption((o) => o.setName('naslov').setDescription('Naslov, npr. "Odaberi role"').setRequired(true).setMaxLength(256))
      .addStringOption((o) => o.setName('opis').setDescription('Tekst iznad popisa rola (\\n za novi red)').setMaxLength(1500))
      .addChannelOption(channelOption),
  )
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Poveži emoji i rolu na nekoj poruci')
      .addStringOption((o) => o.setName('poruka_id').setDescription('ID poruke (desni klik -> Copy Message ID)').setRequired(true))
      .addStringOption((o) => o.setName('emoji').setDescription('Emoji, npr. 🎮 ili custom emoji').setRequired(true))
      .addRoleOption((o) => o.setName('rola').setDescription('Rola koja se dobije').setRequired(true))
      .addChannelOption(channelOption),
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Makni emoji s reaction role poruke')
      .addStringOption((o) => o.setName('poruka_id').setDescription('ID poruke').setRequired(true))
      .addStringOption((o) => o.setName('emoji').setDescription('Emoji').setRequired(true))
      .addChannelOption(channelOption),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Popis svih reaction role poruka'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const g = db.guild(interaction.guild.id);
  const channel = interaction.options.getChannel('kanal') ?? interaction.channel;
  const messageId = interaction.options.getString('poruka_id')?.trim();

  if (sub === 'create') {
    const message = await createManagedMessage(channel, interaction.options.getString('naslov', true), interaction.options.getString('opis'));
    return reply(
      interaction,
      `✅ Poruka poslana: ${message.url}\n**ID poruke:** \`${message.id}\`\n\nSad dodaj role s:\n\`/reactionrole add poruka_id:${message.id} emoji:🎮 rola:@Gamer\``,
    );
  }

  if (sub === 'add') {
    const role = interaction.options.getRole('rola', true);
    const { message, emoji } = await addReactionRole(channel, messageId, interaction.options.getString('emoji', true), role);
    return reply(interaction, `✅ ${emoji.display} → ${role} na [ovoj poruci](${message.url}).`);
  }

  if (sub === 'remove') {
    const emoji = parseEmoji(interaction.options.getString('emoji', true));
    if (!emoji) return fail(interaction, 'Neispravan emoji.');
    await removeReactionRole(interaction.guild, messageId, emoji.key);
    return reply(interaction, `✅ ${emoji.display} maknut.`);
  }

  if (sub === 'list') {
    const lines = Object.entries(g.reactionRoles).map(([id, entry]) => {
      const roles = Object.values(entry.roles).map((r) => `${r.emoji} → <@&${r.roleId}>`).join(', ') || '*nema*';
      return `[Poruka](https://discord.com/channels/${interaction.guild.id}/${entry.channelId}/${id}) (\`${id}\`): ${roles}`;
    });
    return reply(interaction, lines.length ? lines.join('\n').slice(0, 4000) : 'Nema reaction role poruka. Napravi jednu s `/reactionrole create`.');
  }
}
