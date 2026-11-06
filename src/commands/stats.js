import { EmbedBuilder, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as db from '../db.js';
import { computeStats, removeStats, setupStats, updateStats } from '../features/stats.js';
import { fetchSocial } from '../features/socialStats.js';
import { COLOR, UserError, fail } from '../utils/helpers.js';

// Acknowledged right away (ephemeral) because these commands talk to Discord/network and can take >3 s.
export const deferEphemeral = true;

const fmt = (n) => new Intl.NumberFormat('hr-HR').format(Number(n) || 0);

const socialOption = (name, description) => (o) => o.setName(name).setDescription(description).setRequired(true).setMaxLength(200);

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Statistika servera i društvenih mreža')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('server').setDescription('Prikaži statistiku ovog servera'))
  .addSubcommand((s) => s.setName('setup').setDescription('Napravi (ili ponovno napravi) stats kanale na vrhu servera'))
  .addSubcommand((s) => s.setName('refresh').setDescription('Odmah osvježi brojke u stats kanalima'))
  .addSubcommand((s) => s.setName('remove').setDescription('Obriši stats kanale'))
  .addSubcommand((s) =>
    s
      .setName('tiktok')
      .setDescription('Prikaži broj TikTok pratitelja')
      .addStringOption(socialOption('racun', 'TikTok korisničko ime (bez @) ili link profila')),
  )
  .addSubcommand((s) =>
    s
      .setName('youtube')
      .setDescription('Prikaži broj YouTube pretplatnika')
      .addStringOption(socialOption('kanal', 'YouTube @ime, channel ID ili link kanala')),
  )
  .addSubcommand((s) =>
    s
      .setName('twitch')
      .setDescription('Prikaži broj Twitch pratitelja')
      .addStringOption(socialOption('kanal', 'Twitch korisničko ime ili link kanala')),
  );

function serverEmbed(guild) {
  const bots = guild.members.cache.filter((m) => m.user.bot).size;
  const channels = guild.channels.cache;
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(guild.name)
    .setThumbnail(guild.iconURL({ size: 256 }) ?? null)
    .addFields(
      { name: 'Članovi', value: fmt(guild.memberCount), inline: true },
      { name: 'Ljudi', value: fmt(guild.memberCount - bots), inline: true },
      { name: 'Botovi', value: fmt(bots), inline: true },
      { name: 'Boostovi', value: `${fmt(guild.premiumSubscriptionCount ?? 0)} (level ${guild.premiumTier})`, inline: true },
      { name: 'Kanali', value: fmt(channels.size), inline: true },
      { name: 'Role', value: fmt(guild.roles.cache.size - 1), inline: true },
      { name: 'Vlasnik', value: `<@${guild.ownerId}>`, inline: true },
      { name: 'Napravljen', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true },
    );
}

function socialEmbed(data) {
  const platform = data.platform ?? '';
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`${data.name || data.account}${data.verified ? ' ✅' : ''}`)
    .setURL(data.url ?? null)
    .setFooter({ text: platform });
  if (data.avatarUrl) embed.setThumbnail(data.avatarUrl);
  if (data.bio) embed.setDescription(String(data.bio).slice(0, 500));
  const fields = [];
  if (platform === 'youtube') {
    if (data.subscribers != null) fields.push({ name: 'Pretplatnici', value: fmt(data.subscribers), inline: true });
  } else if (data.followers != null) {
    fields.push({ name: 'Pratitelji', value: fmt(data.followers), inline: true });
  }
  if (data.following != null) fields.push({ name: 'Prati', value: fmt(data.following), inline: true });
  if (data.posts != null) fields.push({ name: 'Objave', value: fmt(data.posts), inline: true });
  if (data.videos != null) fields.push({ name: 'Videa', value: fmt(data.videos), inline: true });
  if (data.likes != null) fields.push({ name: 'Lajkovi', value: fmt(data.likes), inline: true });
  if (platform === 'twitch' && data.live != null) fields.push({ name: 'Uživo', value: data.live ? 'Da' : 'Ne', inline: true });
  embed.addFields(...fields);
  return embed;
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;

  if (sub === 'server') {
    return interaction.editReply({ embeds: [serverEmbed(guild)] });
  }

  if (['tiktok', 'youtube', 'twitch'].includes(sub)) {
    const account = interaction.options.getString(sub === 'tiktok' ? 'racun' : 'kanal', true);
    let data;
    try {
      data = await fetchSocial(sub, account);
    } catch (err) {
      throw new UserError(err.message || 'Podaci trenutno nisu dostupni.');
    }
    return interaction.editReply({ embeds: [socialEmbed(data)] });
  }

  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return fail(interaction, 'Za postavljanje stats kanala trebaš permisiju **Manage Server**.');
  }
  if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return fail(interaction, 'Trebam permisiju **Manage Channels**.');
  }

  if (sub === 'setup') {
    await guild.members.fetch();
    await setupStats(guild);
    const s = computeStats(guild);
    return interaction.editReply(
      `✅ Stats kanali napravljeni! (👥 ${s.members} • 🤖 ${s.bots} • 🚀 ${s.boosts})\nBrojevi se ažuriraju automatski (Discord dopušta promjenu imena kanala najviše 2x u 10 min, pa može kasniti par minuta).`,
    );
  }
  if (sub === 'refresh') {
    if (!db.guild(guild.id).config.stats) return interaction.editReply('❌ Stats kanali nisu podešeni. Koristi `/stats setup`.');
    await guild.members.fetch();
    await updateStats(guild);
    return interaction.editReply('✅ Osvježeno (ako je kanal nedavno preimenovan, promjena stiže za par minuta).');
  }
  if (sub === 'remove') {
    const removed = await removeStats(guild);
    return interaction.editReply(removed ? '✅ Stats kanali obrisani.' : '❌ Stats kanali nisu bili podešeni.');
  }
}
