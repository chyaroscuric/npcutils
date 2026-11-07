import { ChannelType, EmbedBuilder, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as birthdays from '../features/birthdays.js';
import { COLOR, UserError, reply, roleProblem } from '../utils/helpers.js';

export const deferEphemeral = true;

const data = new SlashCommandBuilder()
  .setName('birthday')
  .setDescription('Rođendani: postavi svoj datum i podesi čestitku')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('postavi')
      .setDescription('Postavi svoj rođendan')
      .addIntegerOption((o) => o.setName('dan').setDescription('Dan (1–31)').setRequired(true).setMinValue(1).setMaxValue(31))
      .addIntegerOption((o) => o.setName('mjesec').setDescription('Mjesec (1–12)').setRequired(true).setMinValue(1).setMaxValue(12))
      .addIntegerOption((o) => o.setName('godina').setDescription('Godina rođenja (neobavezno, za dob)').setMinValue(1900).setMaxValue(new Date().getFullYear())),
  )
  .addSubcommand((s) => s.setName('ukloni').setDescription('Ukloni svoj rođendan'))
  .addSubcommand((s) =>
    s
      .setName('sljedeci')
      .setDescription('Prikaži sljedeći rođendan')
      .addUserOption((o) => o.setName('korisnik').setDescription('Član (zadano: ti)')),
  )
  .addSubcommand((s) =>
    s
      .setName('postavke')
      .setDescription('Podesi kanal, rolu i vrijeme čestitke')
      .addChannelOption((o) =>
        o.setName('kanal').setDescription('Kanal za rođendanske čestitke').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      )
      .addRoleOption((o) => o.setName('rola').setDescription('Rola koju član dobije na svoj rođendan'))
      .addIntegerOption((o) => o.setName('sat').setDescription('Sat slanja (0–23, zadano 9)').setMinValue(0).setMaxValue(23))
      .addStringOption((o) => o.setName('poruka').setDescription('Poruka; {user} {username} {server} {age} {date}').setMaxLength(2000))
      .addBooleanOption((o) => o.setName('ukljuci').setDescription('Uključi ili isključi čestitke')),
  )
  .addSubcommand((s) => s.setName('test').setDescription('Pošalji testnu čestitku za sebe'))
  .addSubcommand((s) => s.setName('iskljuci').setDescription('Isključi rođendanske čestitke'));

function statusEmbed(guild, cfg) {
  const channel = cfg.channelId && guild.channels.cache.get(cfg.channelId);
  const role = cfg.roleId && guild.roles.cache.get(cfg.roleId);
  return new EmbedBuilder()
    .setColor(cfg.enabled ? COLOR : 0xed4245)
    .setTitle(`🎂 Rođendani: ${cfg.enabled ? 'uključeni' : 'isključeni'}`)
    .addFields(
      { name: 'Kanal', value: channel ? `<#${channel.id}>` : 'nije odabran', inline: true },
      { name: 'Rola', value: role ? `<@&${role.id}>` : 'nije odabrana', inline: true },
      { name: 'Vrijeme', value: `${String(cfg.hour).padStart(2, '0')}:00`, inline: true },
      { name: 'Poruka', value: cfg.message || birthdays.DEFAULT_MESSAGE },
    )
    .setFooter({ text: 'Rođendan se čestita jednom godišnje, na dan koji član postavi.' });
}

function nextEmbed(guild, user, entry) {
  if (!entry) {
    return new EmbedBuilder()
      .setColor(0xed4245)
      .setTitle('🎂 Rođendan nije postavljen')
      .setDescription(`${user} još nije postavio/la rođendan. Postavi ga s \`/birthday postavi\`.`);
  }
  const next = birthdays.nextBirthday(entry);
  const age = next ? birthdays.ageOn(entry, next.year) : null;
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`🎂 ${user.username}`)
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .setDescription(`**${birthdays.formatDate(entry)}**${entry.year ? ` (${entry.year})` : ''}`)
    .addFields(
      { name: 'Sljedeći', value: next ? `<t:${Math.floor(next.date.getTime() / 1000)}:D>` : '—', inline: true },
      { name: 'Za', value: next ? (next.daysUntil === 0 ? 'danas' : `${next.daysUntil} dana`) : '—', inline: true },
      { name: 'Puni', value: age ? `${age} godina` : '—', inline: true },
    );
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;

  if (sub === 'postavi') {
    const entry = birthdays.setBirthday(guild.id, interaction.user.id, {
      day: interaction.options.getInteger('dan', true),
      month: interaction.options.getInteger('mjesec', true),
      year: interaction.options.getInteger('godina'),
    });
    const next = birthdays.nextBirthday(entry);
    return reply(
      interaction,
      `🎂 Tvoj rođendan je spremljen: **${birthdays.formatDate(entry)}**${entry.year ? ` (${entry.year})` : ''}.\n` +
        `Sljedeća čestitka: ${next ? (next.daysUntil === 0 ? 'danas' : `za ${next.daysUntil} dana`) : '—'}.`,
    );
  }

  if (sub === 'ukloni') {
    const removed = birthdays.removeBirthday(guild.id, interaction.user.id);
    return reply(interaction, removed ? '✅ Tvoj rođendan je uklonjen.' : 'ℹ️ Nisi imao/la spremljen rođendan.');
  }

  if (sub === 'sljedeci') {
    const user = interaction.options.getUser('korisnik') ?? interaction.user;
    return interaction.editReply({ embeds: [nextEmbed(guild, user, birthdays.getBirthday(guild.id, user.id))] });
  }

  if (sub === 'test') {
    await birthdays.sendTest(guild, interaction.member);
    return reply(interaction, '✅ Testna čestitka je poslana.');
  }

  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    throw new UserError('Za postavke rođendana trebaš permisiju **Manage Server**.');
  }

  if (sub === 'iskljuci') {
    const cfg = birthdays.saveConfig(guild.id, { enabled: false });
    return interaction.editReply({ embeds: [statusEmbed(guild, cfg)] });
  }

  const input = {};
  const channel = interaction.options.getChannel('kanal');
  const role = interaction.options.getRole('rola');
  const hour = interaction.options.getInteger('sat');
  const message = interaction.options.getString('poruka');
  const enabled = interaction.options.getBoolean('ukljuci');
  if (channel) input.channelId = channel.id;
  if (role) {
    const problem = roleProblem(guild, role);
    if (problem) throw new UserError(problem.replace(/\*\*/g, '').replace(/<@&\d+>/g, role.name));
    input.roleId = role.id;
  }
  if (hour != null) input.hour = hour;
  if (message != null) input.message = message;
  if (enabled != null) input.enabled = enabled;
  if (channel || enabled === true) input.enabled = true;
  if (!Object.keys(input).length) {
    return interaction.editReply({ embeds: [statusEmbed(guild, birthdays.getConfig(guild.id))] });
  }
  const cfg = birthdays.saveConfig(guild.id, input);
  return interaction.editReply({ embeds: [statusEmbed(guild, cfg)] });
}

export const commands = [{ deferEphemeral: true, data, execute }];
