import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as db from '../db.js';
import { managedPayload, parseEmoji, refreshManagedMessage } from '../features/reactionRoles.js';
import { fail, reply, roleProblem } from '../utils/helpers.js';

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

async function fetchMessage(interaction) {
  const channel = interaction.options.getChannel('kanal') ?? interaction.channel;
  const id = interaction.options.getString('poruka_id', true).trim();
  return channel.messages.fetch(id).catch(() => null);
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const g = db.guild(interaction.guild.id);

  if (sub === 'create') {
    const channel = interaction.options.getChannel('kanal') ?? interaction.channel;
    const entry = {
      channelId: channel.id,
      roles: {},
      managed: true,
      title: interaction.options.getString('naslov', true),
      baseDescription: interaction.options.getString('opis')?.replace(/\\n/g, '\n') ?? 'Klikni na emoji ispod da dobiješ rolu. Makni reakciju da je izgubiš.',
    };
    let message;
    try {
      message = await channel.send(managedPayload(entry));
    } catch {
      return fail(interaction, `Ne mogu slati poruke u ${channel}.`);
    }
    g.reactionRoles[message.id] = entry;
    db.save();
    return reply(
      interaction,
      `✅ Poruka poslana: ${message.url}\n**ID poruke:** \`${message.id}\`\n\nSad dodaj role s:\n\`/reactionrole add poruka_id:${message.id} emoji:🎮 rola:@Gamer\``,
    );
  }

  if (sub === 'add') {
    const message = await fetchMessage(interaction);
    if (!message) return fail(interaction, 'Ne mogu naći tu poruku. Provjeri ID i kanal (opcija `kanal`).');
    const emoji = parseEmoji(interaction.options.getString('emoji', true));
    if (!emoji) return fail(interaction, 'Neispravan emoji.');
    const role = interaction.options.getRole('rola', true);
    const problem = roleProblem(interaction.guild, role);
    if (problem) return fail(interaction, problem);
    try {
      await message.react(emoji.react);
    } catch {
      return fail(interaction, 'Ne mogu reagirati tim emojijem (custom emoji mora biti s servera na kojem sam).');
    }
    const entry = (g.reactionRoles[message.id] ??= { channelId: message.channel.id, roles: {}, managed: false });
    entry.roles[emoji.key] = { roleId: role.id, emoji: emoji.display };
    db.save();
    await refreshManagedMessage(message, entry).catch(() => {});
    return reply(interaction, `✅ ${emoji.display} → ${role} na [ovoj poruci](${message.url}).`);
  }

  if (sub === 'remove') {
    const message = await fetchMessage(interaction);
    const messageId = interaction.options.getString('poruka_id', true).trim();
    const emoji = parseEmoji(interaction.options.getString('emoji', true));
    const entry = g.reactionRoles[messageId];
    if (!emoji || !entry?.roles[emoji.key]) return fail(interaction, 'Taj emoji nije povezan ni s jednom rolom na toj poruci.');
    delete entry.roles[emoji.key];
    if (!entry.managed && !Object.keys(entry.roles).length) delete g.reactionRoles[messageId];
    db.save();
    if (message) {
      const reaction = message.reactions.cache.find((r) => (r.emoji.id ?? r.emoji.name?.replace(/\uFE0F/g, '')) === emoji.key);
      await reaction?.users.remove(interaction.client.user.id).catch(() => {});
      await refreshManagedMessage(message, entry).catch(() => {});
    }
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
