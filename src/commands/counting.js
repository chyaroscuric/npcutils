import { ChannelType, EmbedBuilder, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as counting from '../features/counting.js';
import { COLOR, reply } from '../utils/helpers.js';

export const deferEphemeral = true;

export const data = new SlashCommandBuilder()
  .setName('counting')
  .setDescription('Igra brojanja: članovi redom pišu 1, 2, 3...')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('setup')
      .setDescription('Postavi kanal za brojanje')
      .addChannelOption((o) => o.setName('kanal').setDescription('Kanal u kojem se broji').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)),
  )
  .addSubcommand((s) => s.setName('status').setDescription('Prikaži trenutni broj i rekord'))
  .addSubcommand((s) => s.setName('reset').setDescription('Vrati brojanje na 1'))
  .addSubcommand((s) => s.setName('off').setDescription('Isključi igru brojanja'));

function statusEmbed(guild, cfg) {
  if (!cfg) {
    return new EmbedBuilder().setColor(0xed4245).setTitle('🔢 Brojanje je isključeno').setDescription('Uključi ga s `/counting setup kanal:#kanal`.');
  }
  const channel = guild.channels.cache.get(cfg.channelId);
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('🔢 Brojanje')
    .addFields(
      { name: 'Kanal', value: channel ? `<#${channel.id}>` : 'kanal je obrisan', inline: true },
      { name: 'Trenutni broj', value: String(cfg.current ?? 0), inline: true },
      { name: 'Rekord', value: String(cfg.best ?? 0), inline: true },
      { name: 'Sljedeći broj', value: String((cfg.current ?? 0) + 1), inline: true },
    );
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;

  if (sub === 'setup') {
    const channel = interaction.options.getChannel('kanal', true);
    const cfg = counting.setup(guild.id, channel.id);
    await reply(interaction, `✅ Brojanje je uključeno u ${channel}. Sljedeći broj je **1**.`);
    return interaction.followUp({ embeds: [statusEmbed(guild, cfg)] });
  }
  if (sub === 'status') {
    return interaction.editReply({ embeds: [statusEmbed(guild, counting.getConfig(guild.id))] });
  }
  if (sub === 'reset') {
    const cfg = counting.reset(guild.id);
    if (!cfg) return interaction.editReply('❌ Brojanje nije uključeno.');
    await reply(interaction, '✅ Brojanje je vraćeno na **1**.');
    return interaction.followUp({ embeds: [statusEmbed(guild, cfg)] });
  }
  if (sub === 'off') {
    counting.disable(guild.id);
    return interaction.editReply('✅ Brojanje je isključeno.');
  }
}
