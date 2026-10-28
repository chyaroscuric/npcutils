// Giveaways with a join button. State is stored in the DB so they survive restarts.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import * as db from '../db.js';
import { fail } from '../utils/helpers.js';

const COLOR_ACTIVE = 0xfee75c;
const COLOR_ENDED = 0x2b2d31;
const KEEP_ENDED = 30 * 24 * 60 * 60 * 1000; // keep ended giveaways 30 days for /giveaway reroll

let client;

export function start(discordClient) {
  client = discordClient;
  setInterval(() => tick().catch((err) => console.error('[giveaway]', err)), 10_000);
  tick().catch((err) => console.error('[giveaway]', err));
}

async function tick() {
  for (const guildId of db.allGuildIds()) {
    const g = db.guild(guildId);
    for (const [messageId, gw] of Object.entries(g.giveaways)) {
      if (!gw.ended && gw.endsAt <= Date.now()) {
        await endGiveaway(guildId, messageId).catch((err) => console.error('[giveaway] end', err));
      } else if (gw.ended && Date.now() - gw.endsAt > KEEP_ENDED) {
        delete g.giveaways[messageId];
        db.save();
      }
    }
  }
}

const ts = (ms, style) => `<t:${Math.floor(ms / 1000)}:${style}>`;

export function giveawayPayload(gw) {
  const embed = new EmbedBuilder()
    .setTitle(`🎉 ${gw.prize}`)
    .setColor(gw.ended ? COLOR_ENDED : COLOR_ACTIVE)
    .setFooter({ text: `${gw.winners} ${gw.winners === 1 ? 'pobjednik' : 'pobjednika'} • NPC Utils Giveaway` })
    .setTimestamp(gw.endsAt);
  const lines = [];
  if (gw.description) lines.push(gw.description, '');
  if (gw.ended) {
    lines.push(`**Završen:** ${ts(gw.endsAt, 'R')}`);
    lines.push(
      `**Pobjednici:** ${gw.winnerIds.length ? gw.winnerIds.map((id) => `<@${id}>`).join(', ') : 'nema dovoljno sudionika'}`,
    );
  } else {
    lines.push('Klikni na 🎉 gumb ispod da sudjeluješ!', '');
    lines.push(`**Završava:** ${ts(gw.endsAt, 'R')} (${ts(gw.endsAt, 'f')})`);
  }
  lines.push(`**Organizator:** <@${gw.hostId}>`);
  lines.push(`**Sudionika:** ${gw.entrants.length}`);
  embed.setDescription(lines.join('\n'));

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('giveaway:join')
      .setEmoji('🎉')
      .setLabel(gw.ended ? 'Završeno' : 'Sudjeluj')
      .setStyle(gw.ended ? ButtonStyle.Secondary : ButtonStyle.Success)
      .setDisabled(gw.ended),
  );
  return { embeds: [embed], components: [row] };
}

export async function createGiveaway({ channel, hostId, prize, winners, durationMs, description }) {
  const gw = {
    channelId: channel.id,
    hostId,
    prize,
    description: description ?? null,
    winners,
    endsAt: Date.now() + durationMs,
    entrants: [],
    winnerIds: [],
    ended: false,
  };
  const message = await channel.send(giveawayPayload(gw));
  db.guild(channel.guild.id).giveaways[message.id] = gw;
  db.save();
  return message;
}

export async function handleComponent(interaction) {
  const gw = db.guild(interaction.guild.id).giveaways[interaction.message.id];
  if (!gw || gw.ended) return fail(interaction, 'Ovaj giveaway je završen.');
  const idx = gw.entrants.indexOf(interaction.user.id);
  if (idx === -1) gw.entrants.push(interaction.user.id);
  else gw.entrants.splice(idx, 1);
  db.save();
  await interaction.update(giveawayPayload(gw));
  await interaction.followUp({
    content: idx === -1 ? '🎉 Prijavljen/a si u giveaway! Sretno!' : '👋 Odjavljen/a si iz giveawaya.',
    flags: MessageFlags.Ephemeral,
  });
}

function pickWinners(entrants, count, guild) {
  // prefer people still on the server
  const pool = entrants.filter((id) => guild.members.cache.has(id));
  const result = [];
  while (result.length < count && pool.length) {
    result.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return result;
}

async function fetchMessage(guild, gw, messageId) {
  const channel = guild.channels.cache.get(gw.channelId);
  return channel?.messages.fetch(messageId).catch(() => null);
}

export async function endGiveaway(guildId, messageId) {
  const g = db.guild(guildId);
  const gw = g.giveaways[messageId];
  const guild = client.guilds.cache.get(guildId);
  if (!gw || gw.ended || !guild) return null;

  gw.ended = true;
  gw.endsAt = Math.min(gw.endsAt, Date.now());
  gw.winnerIds = pickWinners(gw.entrants, gw.winners, guild);
  db.save();

  const message = await fetchMessage(guild, gw, messageId);
  if (!message) return gw;
  await message.edit(giveawayPayload(gw));
  await message.reply({
    content: gw.winnerIds.length
      ? `🎉 Čestitamo ${gw.winnerIds.map((id) => `<@${id}>`).join(', ')}! Osvojili ste **${gw.prize}**!`
      : `😢 Giveaway za **${gw.prize}** je završen, ali nije bilo dovoljno sudionika.`,
    allowedMentions: { users: gw.winnerIds },
  });
  return gw;
}

export async function reroll(guildId, messageId, count) {
  const g = db.guild(guildId);
  const gw = g.giveaways[messageId];
  const guild = client.guilds.cache.get(guildId);
  if (!gw || !gw.ended) return null;

  const others = gw.entrants.filter((id) => !gw.winnerIds.includes(id));
  const winners = pickWinners(others.length ? others : gw.entrants, count ?? gw.winners, guild);
  gw.winnerIds = winners;
  db.save();

  const message = await fetchMessage(guild, gw, messageId);
  if (message) {
    await message.edit(giveawayPayload(gw));
    await message.reply({
      content: winners.length
        ? `🔄 Novi pobjednik/ci: ${winners.map((id) => `<@${id}>`).join(', ')}! Osvojili ste **${gw.prize}**!`
        : '😢 Nema dovoljno sudionika za reroll.',
      allowedMentions: { users: winners },
    });
  }
  return winners;
}

export async function deleteGiveaway(guildId, messageId) {
  const g = db.guild(guildId);
  const gw = g.giveaways[messageId];
  if (!gw) return false;
  const guild = client.guilds.cache.get(guildId);
  const message = guild && (await fetchMessage(guild, gw, messageId));
  await message?.delete().catch(() => {});
  delete g.giveaways[messageId];
  db.save();
  return true;
}

export function onMessageDelete(message) {
  if (!message.guildId) return;
  const g = db.guild(message.guildId);
  if (g.giveaways[message.id]) {
    delete g.giveaways[message.id];
    db.save();
  }
}
