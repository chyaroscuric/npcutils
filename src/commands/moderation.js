import { ChannelType, EmbedBuilder, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as db from '../db.js';
import { addWarn, assertCanModerate, clearWarns, modLog, warns } from '../features/moderation.js';
import { parseDuration } from '../utils/duration.js';
import { COLOR, UserError, reply } from '../utils/helpers.js';

const MAX_TIMEOUT = 28 * 24 * 60 * 60 * 1000;

const command = (name, description, permission) =>
  new SlashCommandBuilder()
    .setName(name)
    .setDescription(description)
    .setDefaultMemberPermissions(permission)
    .setContexts(InteractionContextType.Guild);
const userOption = (o) => o.setName('korisnik').setDescription('Korisnik').setRequired(true);
const reasonOption = (o) => o.setName('razlog').setDescription('Razlog').setMaxLength(500);

async function targetMember(interaction, action) {
  const user = interaction.options.getUser('korisnik', true);
  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  assertCanModerate(interaction.member, member, action);
  return { user, member };
}

// DM before the punishment, while the bot still shares a server with the user.
async function notify(user, text) {
  await user.send(text).catch(() => {});
}

const purge = {
  deferEphemeral: true,
  data: command('purge', 'Obriši više poruka odjednom', PermissionFlagsBits.ManageMessages)
    .addIntegerOption((o) => o.setName('broj').setDescription('Koliko poruka pregledati (1–100)').setMinValue(1).setMaxValue(100).setRequired(true))
    .addUserOption((o) => o.setName('korisnik').setDescription('Samo poruke ovog korisnika'))
    .addBooleanOption((o) => o.setName('botovi').setDescription('Samo poruke botova'))
    .addStringOption((o) => o.setName('sadrzi').setDescription('Samo poruke koje sadrže ovaj tekst').setMaxLength(100)),
  async execute(interaction) {
    const amount = interaction.options.getInteger('broj', true);
    const user = interaction.options.getUser('korisnik');
    const botsOnly = interaction.options.getBoolean('botovi');
    const text = interaction.options.getString('sadrzi')?.toLowerCase();
    const fetched = await interaction.channel.messages.fetch({ limit: amount });
    const selected = fetched.filter(
      (m) => (!user || m.author.id === user.id) && (!botsOnly || m.author.bot) && (!text || m.content.toLowerCase().includes(text)),
    );
    // Discord does not bulk delete messages older than 14 days
    const deleted = await interaction.channel.bulkDelete(selected, true);
    const skipped = selected.size - deleted.size;
    await modLog(interaction.guild, {
      action: 'Purge',
      moderator: interaction.user,
      extra: `${deleted.size} poruka u <#${interaction.channel.id}>`,
    });
    return reply(interaction, `🧹 Obrisano **${deleted.size}** poruka.${skipped ? ` ${skipped} je starije od 14 dana pa ih ne mogu obrisati.` : ''}`);
  },
};

const ban = {
  deferEphemeral: true,
  data: command('ban', 'Banaj korisnika', PermissionFlagsBits.BanMembers)
    .addUserOption(userOption)
    .addStringOption(reasonOption)
    .addIntegerOption((o) =>
      o
        .setName('obrisi_poruke')
        .setDescription('Obriši njegove poruke iz zadnjih…')
        .addChoices({ name: 'Ništa', value: 0 }, { name: '1 sat', value: 3600 }, { name: '1 dan', value: 86400 }, { name: '7 dana', value: 604800 }),
    ),
  async execute(interaction) {
    const { user } = await targetMember(interaction, 'banati');
    const reason = interaction.options.getString('razlog') ?? undefined;
    await notify(user, `Banan/a si sa servera **${interaction.guild.name}**.${reason ? ` Razlog: ${reason}` : ''}`);
    await interaction.guild.members.ban(user.id, {
      reason: `${interaction.user.username}: ${reason ?? 'bez razloga'}`,
      deleteMessageSeconds: interaction.options.getInteger('obrisi_poruke') ?? 0,
    });
    await modLog(interaction.guild, { action: 'Ban', target: user, moderator: interaction.user, reason });
    return reply(interaction, `🔨 ${user} je banan/a.`, { ephemeral: false });
  },
};

const unban = {
  deferEphemeral: true,
  data: command('unban', 'Makni ban', PermissionFlagsBits.BanMembers)
    .addStringOption((o) => o.setName('korisnik_id').setDescription('ID korisnika').setRequired(true))
    .addStringOption(reasonOption),
  async execute(interaction) {
    const id = interaction.options.getString('korisnik_id', true).trim();
    const reason = interaction.options.getString('razlog') ?? undefined;
    const user = await interaction.guild.members.unban(id, reason).catch(() => null);
    if (!user) throw new UserError('Taj korisnik nije banan (provjeri ID).');
    await modLog(interaction.guild, { action: 'Unban', target: user, moderator: interaction.user, reason });
    return reply(interaction, `✅ ${user.username} više nije banan/a.`);
  },
};

const kick = {
  deferEphemeral: true,
  data: command('kick', 'Izbaci korisnika sa servera', PermissionFlagsBits.KickMembers).addUserOption(userOption).addStringOption(reasonOption),
  async execute(interaction) {
    const { user, member } = await targetMember(interaction, 'kickati');
    if (!member) throw new UserError('Taj korisnik nije na serveru.');
    const reason = interaction.options.getString('razlog') ?? undefined;
    await notify(user, `Izbačen/a si sa servera **${interaction.guild.name}**.${reason ? ` Razlog: ${reason}` : ''}`);
    await member.kick(`${interaction.user.username}: ${reason ?? 'bez razloga'}`);
    await modLog(interaction.guild, { action: 'Kick', target: user, moderator: interaction.user, reason });
    return reply(interaction, `👢 ${user} je izbačen/a.`, { ephemeral: false });
  },
};

const timeout = {
  deferEphemeral: true,
  data: command('timeout', 'Utišaj korisnika na neko vrijeme', PermissionFlagsBits.ModerateMembers)
    .addUserOption(userOption)
    .addStringOption((o) => o.setName('trajanje').setDescription('npr. 10m, 1h, 1d (max 28d)').setRequired(true))
    .addStringOption(reasonOption),
  async execute(interaction) {
    const { user, member } = await targetMember(interaction, 'utišati');
    if (!member) throw new UserError('Taj korisnik nije na serveru.');
    const ms = parseDuration(interaction.options.getString('trajanje', true));
    if (!ms || ms > MAX_TIMEOUT) throw new UserError('Neispravno trajanje. Primjeri: `10m`, `1h`, `1d` (najviše 28 dana).');
    const reason = interaction.options.getString('razlog') ?? undefined;
    await member.timeout(ms, `${interaction.user.username}: ${reason ?? 'bez razloga'}`);
    const until = Math.floor((Date.now() + ms) / 1000);
    await modLog(interaction.guild, { action: 'Timeout', target: user, moderator: interaction.user, reason, extra: `do <t:${until}:f>` });
    return reply(interaction, `🔇 ${user} je utišan/a do <t:${until}:f>.`, { ephemeral: false });
  },
};

const untimeout = {
  deferEphemeral: true,
  data: command('untimeout', 'Makni timeout', PermissionFlagsBits.ModerateMembers).addUserOption(userOption),
  async execute(interaction) {
    const { user, member } = await targetMember(interaction, 'odtišati');
    if (!member?.communicationDisabledUntilTimestamp) throw new UserError('Taj korisnik nema timeout.');
    await member.timeout(null, interaction.user.username);
    await modLog(interaction.guild, { action: 'Timeout maknut', target: user, moderator: interaction.user });
    return reply(interaction, `🔊 ${user} više nema timeout.`, { ephemeral: false });
  },
};

const warn = {
  deferEphemeral: true,
  data: command('warn', 'Upozori korisnika', PermissionFlagsBits.ModerateMembers)
    .addUserOption(userOption)
    .addStringOption((o) => o.setName('razlog').setDescription('Razlog').setMaxLength(500).setRequired(true)),
  async execute(interaction) {
    const { user } = await targetMember(interaction, 'upozoriti');
    const reason = interaction.options.getString('razlog', true);
    const list = addWarn(interaction.guild.id, user.id, interaction.user.id, reason);
    await notify(user, `Dobio/la si upozorenje na serveru **${interaction.guild.name}**: ${reason}`);
    await modLog(interaction.guild, { action: 'Upozorenje', target: user, moderator: interaction.user, reason, extra: `ukupno ${list.length}` });
    return reply(interaction, `⚠️ ${user} je upozoren/a (ukupno upozorenja: **${list.length}**).`, { ephemeral: false });
  },
};

const warnings = {
  deferEphemeral: true,
  data: command('warnings', 'Popis upozorenja korisnika', PermissionFlagsBits.ModerateMembers).addUserOption(userOption),
  async execute(interaction) {
    const user = interaction.options.getUser('korisnik', true);
    const list = warns(interaction.guild.id, user.id);
    const embed = new EmbedBuilder()
      .setColor(COLOR)
      .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
      .setTitle(`Upozorenja: ${list.length}`)
      .setDescription(
        list.map((w) => `**#${w.id}** <t:${Math.floor(w.at / 1000)}:d> od <@${w.by}>: ${w.reason}`).join('\n').slice(0, 4000) ||
          'Nema upozorenja.',
      );
    return interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};

const clearwarns = {
  deferEphemeral: true,
  data: command('clearwarns', 'Obriši upozorenja korisnika', PermissionFlagsBits.ModerateMembers)
    .addUserOption(userOption)
    .addIntegerOption((o) => o.setName('broj').setDescription('Samo upozorenje s ovim brojem (#)').setMinValue(1)),
  async execute(interaction) {
    const user = interaction.options.getUser('korisnik', true);
    const removed = clearWarns(interaction.guild.id, user.id, interaction.options.getInteger('broj'));
    await modLog(interaction.guild, { action: 'Upozorenja obrisana', target: user, moderator: interaction.user, extra: String(removed) });
    return reply(interaction, `✅ Obrisano upozorenja: **${removed}**.`);
  },
};

const slowmode = {
  deferEphemeral: true,
  data: command('slowmode', 'Postavi slowmode u ovom kanalu', PermissionFlagsBits.ManageChannels).addStringOption((o) =>
    o.setName('trajanje').setDescription('npr. 5s, 1m, 2h; 0 = isključi (max 6h)').setRequired(true),
  ),
  async execute(interaction) {
    const input = interaction.options.getString('trajanje', true).trim();
    const ms = input === '0' ? 0 : parseDuration(input);
    if (ms === null || ms > 6 * 60 * 60 * 1000) throw new UserError('Neispravno trajanje. Primjeri: `5s`, `1m`, `2h`, `0` (najviše 6 h).');
    await interaction.channel.setRateLimitPerUser(Math.round(ms / 1000), interaction.user.username);
    return reply(interaction, ms ? `🐢 Slowmode: **${input}**.` : '✅ Slowmode isključen.', { ephemeral: false });
  },
};

const lockCommand = (name, description, locked) => ({
  deferEphemeral: true,
  data: command(name, description, PermissionFlagsBits.ManageChannels).addStringOption(reasonOption),
  async execute(interaction) {
    const channel = interaction.channel;
    if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) throw new UserError('Ovo radi samo u tekstualnim kanalima.');
    const reason = interaction.options.getString('razlog') ?? undefined;
    await channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: locked ? false : null }, { reason });
    await modLog(interaction.guild, { action: locked ? 'Kanal zaključan' : 'Kanal otključan', moderator: interaction.user, reason, extra: `<#${channel.id}>` });
    return reply(interaction, locked ? `🔒 Kanal je zaključan.${reason ? ` Razlog: ${reason}` : ''}` : '🔓 Kanal je otključan.', { ephemeral: false });
  },
});

const modlog = {
  deferEphemeral: true,
  data: command('modlog', 'Kanal za zapisnik moderacije', PermissionFlagsBits.ManageGuild).addChannelOption((o) =>
    o.setName('kanal').setDescription('Kanal (prazno = isključi)').addChannelTypes(ChannelType.GuildText),
  ),
  async execute(interaction) {
    const channel = interaction.options.getChannel('kanal');
    db.guild(interaction.guild.id).config.modLogChannelId = channel?.id ?? null;
    db.save();
    return reply(interaction, channel ? `✅ Zapisnik moderacije ide u ${channel}.` : '✅ Zapisnik moderacije je isključen.');
  },
};

export const commands = [
  purge,
  ban,
  unban,
  kick,
  timeout,
  untimeout,
  warn,
  warnings,
  clearwarns,
  slowmode,
  lockCommand('lock', 'Zaključaj ovaj kanal (nitko ne može pisati)', true),
  lockCommand('unlock', 'Otključaj ovaj kanal', false),
  modlog,
];
