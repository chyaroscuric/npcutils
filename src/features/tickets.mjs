// Ticket system: panel with a button -> modal (reason) -> private channel -> close with transcript.
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import * as db from '../db.mjs';
import { COLOR, COLOR_ERR, UserError, fail, reply } from '../utils/helpers.mjs';
import { logActivity } from './activity.mjs';

const MEMBER_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];

export function panelPayload(title, description) {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(title || '🎫 Podrška')
    .setDescription(description || 'Trebaš pomoć? Klikni na gumb ispod da otvoriš tiket.\nStaff će ti se javiti što prije.');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:open').setLabel('Otvori tiket').setEmoji('🎫').setStyle(ButtonStyle.Primary),
  );
  return { embeds: [embed], components: [row] };
}

export function getTicket(channel) {
  return db.guild(channel.guild.id).tickets.open[channel.id] ?? null;
}

export function isStaff(member) {
  const cfg = db.guild(member.guild.id).config.tickets;
  return (
    member.permissions.has(PermissionFlagsBits.ManageChannels) ||
    Boolean(cfg?.supportRoleId && member.roles.cache.has(cfg.supportRoleId))
  );
}

export async function handleComponent(interaction) {
  const action = interaction.customId.split(':')[1];
  if (action === 'open') return showOpenModal(interaction);
  if (action === 'modal') return createTicket(interaction);
  if (action === 'close') return askClose(interaction);
  if (action === 'close-confirm') return closeTicket(interaction);
  if (action === 'close-cancel') return interaction.update({ content: 'Zatvaranje otkazano.', embeds: [], components: [] });
}

async function showOpenModal(interaction) {
  const g = db.guild(interaction.guild.id);
  if (!g.config.tickets) return fail(interaction, 'Tiketi još nisu podešeni. Admin treba pokrenuti `/ticket setup`.');

  const existing = Object.entries(g.tickets.open).find(([, t]) => t.ownerId === interaction.user.id);
  if (existing) {
    if (interaction.guild.channels.cache.has(existing[0])) {
      return fail(interaction, `Već imaš otvoren tiket: <#${existing[0]}>`);
    }
    delete g.tickets.open[existing[0]];
    db.save();
  }

  const modal = new ModalBuilder()
    .setCustomId('ticket:modal')
    .setTitle('Otvori tiket')
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('reason')
          .setLabel('Razlog otvaranja tiketa')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('Ukratko opiši s čime ti treba pomoć...')
          .setMaxLength(1000)
          .setRequired(false),
      ),
    );
  await interaction.showModal(modal);
}

async function createTicket(interaction) {
  const guild = interaction.guild;
  const g = db.guild(guild.id);
  const cfg = g.config.tickets;
  if (!cfg) return fail(interaction, 'Tiketi nisu podešeni.');
  if (Object.values(g.tickets.open).some((t) => t.ownerId === interaction.user.id)) {
    return fail(interaction, 'Već imaš otvoren tiket.');
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const reason = interaction.fields.getTextInputValue('reason')?.trim() || 'Nije naveden.';
  const number = ++g.tickets.counter;
  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: MEMBER_PERMS },
    {
      id: guild.members.me.id,
      allow: [...MEMBER_PERMS, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages],
    },
  ];
  if (cfg.supportRoleId && guild.roles.cache.has(cfg.supportRoleId)) {
    overwrites.push({ id: cfg.supportRoleId, allow: [...MEMBER_PERMS, PermissionFlagsBits.ManageMessages] });
  }
  const parent = cfg.categoryId && guild.channels.cache.has(cfg.categoryId) ? cfg.categoryId : null;

  let channel;
  try {
    channel = await guild.channels.create({
      name: `ticket-${String(number).padStart(4, '0')}`,
      type: ChannelType.GuildText,
      parent,
      topic: `Tiket korisnika ${interaction.user.tag} (${interaction.user.id})`,
      permissionOverwrites: overwrites,
    });
  } catch (err) {
    console.error('[tickets]', err);
    return fail(interaction, 'Ne mogu napraviti kanal. Provjeri da imam permisiju **Manage Channels**.');
  }

  g.tickets.open[channel.id] = { ownerId: interaction.user.id, number, reason, createdAt: Date.now() };
  db.save();
  logActivity(guild.id, 'ticket_open', `${interaction.user.username} je otvorio/la tiket #${number}`);

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`🎫 Tiket #${number}`)
    .setDescription(`Hej ${interaction.user}, hvala što si otvorio/la tiket!\nStaff će ti se uskoro javiti.`)
    .addFields({ name: 'Razlog', value: reason.slice(0, 1024) })
    .setTimestamp();
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:close').setLabel('Zatvori tiket').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  );
  const ping = [interaction.user.toString(), cfg.supportRoleId ? `<@&${cfg.supportRoleId}>` : null].filter(Boolean).join(' ');
  await channel.send({
    content: ping,
    embeds: [embed],
    components: [row],
    allowedMentions: { users: [interaction.user.id], roles: cfg.supportRoleId ? [cfg.supportRoleId] : [] },
  });
  await interaction.editReply({ embeds: [new EmbedBuilder().setColor(COLOR).setDescription(`✅ Tiket otvoren: ${channel}`)] });
}

export async function askClose(interaction) {
  const ticket = getTicket(interaction.channel);
  if (!ticket) return fail(interaction, 'Ovo nije tiket kanal.');
  if (ticket.ownerId !== interaction.user.id && !isStaff(interaction.member)) {
    return fail(interaction, 'Samo vlasnik tiketa ili staff može zatvoriti tiket.');
  }
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket:close-confirm').setLabel('Da, zatvori').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('ticket:close-cancel').setLabel('Odustani').setStyle(ButtonStyle.Secondary),
  );
  await interaction.reply({
    embeds: [new EmbedBuilder().setColor(COLOR_ERR).setDescription('Jesi li siguran/na da želiš zatvoriti ovaj tiket?')],
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

async function buildTranscript(channel) {
  const messages = [];
  let before;
  while (messages.length < 2000) {
    const batch = await channel.messages.fetch({ limit: 100, before });
    if (!batch.size) break;
    messages.push(...batch.values());
    before = batch.last().id;
  }
  return messages
    .reverse()
    .map((m) => {
      const time = new Date(m.createdTimestamp).toISOString().replace('T', ' ').slice(0, 19);
      const parts = [m.content];
      for (const e of m.embeds) parts.push(`[embed] ${e.title ?? ''} ${e.description ?? ''}`.trim());
      for (const a of m.attachments.values()) parts.push(`[prilog] ${a.url}`);
      return `[${time}] ${m.author.tag}: ${parts.filter(Boolean).join(' | ')}`;
    })
    .join('\n');
}

async function closeTicket(interaction) {
  if (!getTicket(interaction.channel)) {
    return interaction.update({ content: 'Ovo više nije otvoren tiket.', embeds: [], components: [] });
  }
  await interaction.update({ content: '🔒 Zatvaram tiket...', embeds: [], components: [] });
  await closeTicketChannel(interaction.channel, { id: interaction.user.id, name: interaction.user.tag });
}

// Posts the transcript to the log channel and deletes the ticket channel. Used by the button and the dashboard.
export async function closeTicketChannel(channel, closedBy) {
  const g = db.guild(channel.guild.id);
  const ticket = g.tickets.open[channel.id];
  if (!ticket) throw new UserError('Ovo nije otvoren tiket.');
  delete g.tickets.open[channel.id];
  db.save();

  await channel
    .send({ embeds: [new EmbedBuilder().setColor(COLOR_ERR).setDescription(`🔒 Tiket zatvara <@${closedBy.id}>. Kanal se briše za 5 sekundi.`)] })
    .catch(() => {});

  const logChannel = g.config.tickets?.logChannelId && channel.guild.channels.cache.get(g.config.tickets.logChannelId);
  if (logChannel) {
    try {
      const transcript = await buildTranscript(channel);
      const file = new AttachmentBuilder(Buffer.from(transcript, 'utf8'), { name: `${channel.name}.txt` });
      const embed = new EmbedBuilder()
        .setColor(COLOR)
        .setTitle(`🎫 Tiket #${ticket.number} zatvoren`)
        .addFields(
          { name: 'Otvorio/la', value: `<@${ticket.ownerId}>`, inline: true },
          { name: 'Zatvorio/la', value: `<@${closedBy.id}>`, inline: true },
          { name: 'Otvoren', value: `<t:${Math.floor(ticket.createdAt / 1000)}:f>`, inline: true },
          { name: 'Razlog', value: (ticket.reason || 'Nije naveden.').slice(0, 1024) },
        )
        .setTimestamp();
      await logChannel.send({ embeds: [embed], files: [file] });
    } catch (err) {
      console.error('[tickets] transcript', err);
    }
  }

  logActivity(channel.guild.id, 'ticket_close', `Tiket #${ticket.number} zatvorio/la ${closedBy.name}`);
  setTimeout(() => channel.delete(`Tiket zatvorio ${closedBy.name}`).catch(() => {}), 5000);
}

export function onChannelDelete(channel) {
  if (!channel.guild) return;
  const g = db.guild(channel.guild.id);
  if (g.tickets.open[channel.id]) {
    delete g.tickets.open[channel.id];
    db.save();
  }
}

export async function setMemberAccess(interaction, user, allow) {
  const ticket = getTicket(interaction.channel);
  if (!ticket) return fail(interaction, 'Ovu komandu možeš koristiti samo u tiket kanalu.');
  if (!isStaff(interaction.member)) return fail(interaction, 'Samo staff može dodavati/uklanjati ljude iz tiketa.');
  if (!allow && user.id === ticket.ownerId) return fail(interaction, 'Ne možeš ukloniti vlasnika tiketa.');
  if (allow) await interaction.channel.permissionOverwrites.edit(user.id, Object.fromEntries(MEMBER_PERMS.map((p) => [permName(p), true])));
  else await interaction.channel.permissionOverwrites.delete(user.id);
  return reply(interaction, allow ? `✅ ${user} je dodan/a u tiket.` : `✅ ${user} je uklonjen/a iz tiketa.`, { ephemeral: false });
}

function permName(bit) {
  return Object.keys(PermissionFlagsBits).find((k) => PermissionFlagsBits[k] === bit);
}
