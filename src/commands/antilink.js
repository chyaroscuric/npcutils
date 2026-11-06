import { ChannelType, EmbedBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as db from '../db.js';
import { getConfig, saveConfig } from '../features/antilink.js';
import { UserError, reply } from '../utils/helpers.js';

export const deferEphemeral = true;

const channelOption = (o) =>
  o
    .setName('kanal')
    .setDescription('Kanal u kojem su linkovi dopušteni')
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildCategory);

export const data = new SlashCommandBuilder()
  .setName('antilink')
  .setDescription('Zaštita od linkova i Discord pozivnica (briše poruke članovima bez moderatorskih dozvola)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('status').setDescription('Prikaži postavke zaštite od linkova'))
  .addSubcommand((s) =>
    s
      .setName('ukljuci')
      .setDescription('Uključi ili isključi cijelu zaštitu')
      .addBooleanOption((o) => o.setName('ukljuceno').setDescription('Uključeno?').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('pravilo')
      .setDescription('Uključi ili isključi brisanje linkova / pozivnica')
      .addStringOption((o) =>
        o
          .setName('vrsta')
          .setDescription('Što blokirati')
          .setRequired(true)
          .addChoices({ name: 'Obični linkovi', value: 'links' }, { name: 'Discord pozivnice', value: 'invites' }),
      )
      .addBooleanOption((o) => o.setName('ukljuceno').setDescription('Uključeno?').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('obavijest')
      .setDescription('Pošalji kratku poruku članu nakon brisanja')
      .addBooleanOption((o) => o.setName('ukljuceno').setDescription('Uključeno?').setRequired(true)),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('whitelist')
      .setDescription('Role i kanali u kojima su linkovi dopušteni')
      .addSubcommand((s) =>
        s
          .setName('dodaj')
          .setDescription('Dodaj rolu ili kanal na popis iznimki')
          .addRoleOption((o) => o.setName('rola').setDescription('Rola koja smije slati linkove'))
          .addChannelOption(channelOption),
      )
      .addSubcommand((s) =>
        s
          .setName('makni')
          .setDescription('Makni rolu ili kanal s popisa iznimki')
          .addRoleOption((o) => o.setName('rola').setDescription('Rola koja više ne smije slati linkove'))
          .addChannelOption(channelOption),
      ),
  );

function statusEmbed(guild, cfg) {
  const mark = (on) => (on ? '✅' : '⬛');
  const roles = cfg.whitelistRoles.map((id) => `<@&${id}>`);
  const channels = cfg.whitelistChannels.map((id) => `<#${id}>`);
  const logId = db.guild(guild.id).config.modLogChannelId;
  return new EmbedBuilder()
    .setColor(cfg.enabled ? 0x57f287 : 0xed4245)
    .setTitle(`🔗 Zaštita od linkova: ${cfg.enabled ? 'uključena' : 'isključena'}`)
    .setDescription(
      [
        `${mark(cfg.blockLinks)} Obični linkovi`,
        `${mark(cfg.blockInvites)} Discord pozivnice`,
        `${mark(cfg.notify)} Kratka poruka članu nakon brisanja`,
      ].join('\n'),
    )
    .addFields(
      { name: 'Izuzete role', value: roles.join(', ') || 'nema', inline: true },
      { name: 'Izuzeti kanali', value: channels.join(', ') || 'nema', inline: true },
      { name: 'Zapisnik', value: logId ? `<#${logId}>` : 'nije postavljen', inline: true },
    )
    .setFooter({ text: 'Vlasnik, bot i moderatori (Manage Messages / Ban / Kick / Timeout) uvijek su izuzeti.' });
}

export async function execute(interaction) {
  const guild = interaction.guild;
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (sub === 'status') {
    return interaction.editReply({ embeds: [statusEmbed(guild, getConfig(guild.id))] });
  }

  let cfg;
  if (sub === 'ukljuci') {
    cfg = saveConfig(guild.id, { enabled: interaction.options.getBoolean('ukljuceno', true) });
  } else if (sub === 'pravilo') {
    const kind = interaction.options.getString('vrsta', true);
    const enabled = interaction.options.getBoolean('ukljuceno', true);
    cfg = saveConfig(guild.id, kind === 'links' ? { blockLinks: enabled } : { blockInvites: enabled });
  } else if (sub === 'obavijest') {
    cfg = saveConfig(guild.id, { notify: interaction.options.getBoolean('ukljuceno', true) });
  } else if (group === 'whitelist') {
    const role = interaction.options.getRole('rola');
    const channel = interaction.options.getChannel('kanal');
    if (!role && !channel) throw new UserError('Odaberi rolu ili kanal.');
    const current = getConfig(guild.id);
    const change = (list, id) => (sub === 'dodaj' ? [...new Set([...list, id])] : list.filter((x) => x !== id));
    cfg = saveConfig(guild.id, {
      whitelistRoles: role ? change(current.whitelistRoles, role.id) : current.whitelistRoles,
      whitelistChannels: channel ? change(current.whitelistChannels, channel.id) : current.whitelistChannels,
    });
  }

  if (!cfg) throw new UserError('Nepoznata podnaredba.');
  await reply(interaction, '✅ Spremljeno.');
  return interaction.followUp({ embeds: [statusEmbed(guild, cfg)], flags: MessageFlags.Ephemeral });
}
