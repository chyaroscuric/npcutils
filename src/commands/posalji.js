import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { sendMessage } from '../features/messages.js';
import { UserError, reply } from '../utils/helpers.js';

export const deferEphemeral = true;

export const data = new SlashCommandBuilder()
  .setName('posalji')
  .setDescription('Pošalji poruku ili embed kao bot')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addChannelOption((o) =>
    o.setName('kanal').setDescription('Kanal u koji bot šalje').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
  )
  .addStringOption((o) => o.setName('tekst').setDescription('Obicni tekst poruke (do 2000 znakova)').setMaxLength(2000))
  .addStringOption((o) => o.setName('naslov').setDescription('Naslov embeda').setMaxLength(256))
  .addStringOption((o) => o.setName('opis').setDescription('Opis embeda').setMaxLength(4096))
  .addStringOption((o) => o.setName('boja').setDescription('Boja embeda u hexu, npr. #5865f2').setMaxLength(7))
  .addStringOption((o) => o.setName('slika').setDescription('URL slike u embedu').setMaxLength(2048))
  .addStringOption((o) => o.setName('autor').setDescription('Ime autora embeda').setMaxLength(256))
  .addStringOption((o) => o.setName('footer').setDescription('Tekst podnožja embeda').setMaxLength(2048))
  .addBooleanOption((o) => o.setName('vrijeme').setDescription('Prikaži vrijeme slanja u embedu'));

export async function execute(interaction) {
  const channel = interaction.options.getChannel('kanal', true);
  const input = {
    content: interaction.options.getString('tekst') ?? '',
    embed: {
      enabled: Boolean(
        interaction.options.getString('naslov') ||
          interaction.options.getString('opis') ||
          interaction.options.getString('slika') ||
          interaction.options.getString('autor') ||
          interaction.options.getString('footer') ||
          interaction.options.getBoolean('vrijeme'),
      ),
      title: interaction.options.getString('naslov') ?? '',
      description: interaction.options.getString('opis') ?? '',
      color: interaction.options.getString('boja') ?? '',
      imageUrl: interaction.options.getString('slika') ?? '',
      author: interaction.options.getString('autor') ?? '',
      footer: interaction.options.getString('footer') ?? '',
      timestamp: Boolean(interaction.options.getBoolean('vrijeme')),
    },
  };
  if (!input.content.trim() && !input.embed.enabled) {
    throw new UserError('Upiši tekst ili barem jedan dio embeda (naslov, opis, sliku...).');
  }
  let message;
  try {
    message = await sendMessage(channel, input);
  } catch (err) {
    throw new UserError(err.message || `Ne mogu poslati poruku u #${channel.name}.`);
  }
  return reply(interaction, `✅ Poruka je poslana u ${channel}.\n${message.url}`);
}
