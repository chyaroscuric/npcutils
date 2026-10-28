// "Pogodi državu": the bot shows a flag, the first person to type the country's name wins.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { CONTINENTS, COUNTRIES, flagUrl } from '../../data/countries.js';
import { UserError, fail } from '../../utils/helpers.js';
import { normalize, pick } from './text.js';

const ROUND_MS = 60_000;
const COLOR_ROUND = 0x22a7f0;
const COLOR_WIN = 0x57f287;
const COLOR_LOST = 0x4f545c;

const rounds = new Map(); // channelId -> round
const lastCountry = new Map(); // channelId -> iso2, so the same flag does not come twice in a row

export const continentLabel = (key) => CONTINENTS[key] ?? 'Svi kontinenti';

export function acceptedAnswers(country) {
  return new Set([country.hr, country.en, ...country.aliases].map(normalize));
}

export function isCorrect(country, text) {
  return acceptedAnswers(country).has(normalize(text));
}

function pickCountry(channelId, continent) {
  const pool = COUNTRIES.filter((c) => (!continent || c.continent === continent) && c.iso2 !== lastCountry.get(channelId));
  return pick(pool);
}

const answer = (country) => `${country.hr} (${country.en})`;

function roundPayload(round) {
  const lines = [`Upiši ime države u chat. Imaš **${ROUND_MS / 1000} sekundi**.`];
  if (round.hint) {
    const name = round.country.hr;
    lines.push(`\n💡 **Pomoć:** ${CONTINENTS[round.country.continent]} · počinje s **${name[0]}** · ${name.replace(/\s/g, '').length} slova`);
  }
  const embed = new EmbedBuilder()
    .setColor(COLOR_ROUND)
    .setTitle('🌍 Pogodi državu')
    .setDescription(lines.join('\n'))
    .addFields({ name: 'Kontinent', value: continentLabel(round.continent), inline: true })
    .setImage(flagUrl(round.country.iso2));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('flag:skip').setLabel('Preskoči').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('flag:hint').setLabel('Pomoć').setStyle(ButtonStyle.Secondary).setDisabled(round.hint),
  );
  return { embeds: [embed], components: [row] };
}

const againRow = (continent) =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`flag:again:${continent ?? 'svi'}`)
      .setLabel('Igraj ponovno')
      .setStyle(ButtonStyle.Primary),
  );

export async function startRound(channel, continent) {
  if (rounds.has(channel.id)) throw new UserError('U ovom kanalu već traje igra. Pogodi zastavu ili klikni Preskoči.');
  const round = { country: pickCountry(channel.id, continent), continent, startedAt: Date.now(), hint: false };
  rounds.set(channel.id, round);
  lastCountry.set(channel.id, round.country.iso2);
  try {
    round.message = await channel.send(roundPayload(round));
  } catch {
    rounds.delete(channel.id);
    throw new UserError('Ne mogu slati poruke u ovaj kanal.');
  }
  round.startedAt = Date.now();
  round.timer = setTimeout(() => endRound(channel, { reason: 'timeout' }).catch((err) => console.error('[flags]', err)), ROUND_MS);
  return round;
}

async function endRound(channel, { winner, winnerMessage, reason }) {
  const round = rounds.get(channel.id);
  if (!round) return;
  rounds.delete(channel.id);
  clearTimeout(round.timer);
  await round.message?.edit({ components: [] }).catch(() => {});

  const embed = new EmbedBuilder().setThumbnail(flagUrl(round.country.iso2, 320));
  if (winner) {
    const seconds = ((Date.now() - round.startedAt) / 1000).toFixed(1);
    embed
      .setColor(COLOR_WIN)
      .setTitle('✅ Točno!')
      .setDescription(`${winner} je pogodio/la!\n**Točan odgovor:** ${answer(round.country)}\n**Vrijeme:** \`${seconds} s\``);
  } else {
    embed
      .setColor(COLOR_LOST)
      .setTitle(reason === 'skip' ? '⏭️ Preskočeno' : '⏰ Vrijeme je isteklo')
      .setDescription(`**Točan odgovor:** ${answer(round.country)}`);
  }
  const payload = { embeds: [embed], components: [againRow(round.continent)], allowedMentions: { parse: [] } };
  if (winnerMessage) await winnerMessage.reply(payload).catch(() => channel.send(payload));
  else await channel.send(payload).catch(() => {});
}

export async function onMessage(message) {
  const round = rounds.get(message.channelId);
  if (!round) return false;
  const text = message.content.trim();
  if (!text || text.length > 40 || /^[!/.?<@]/.test(text)) return true;
  if (isCorrect(round.country, text)) await endRound(message.channel, { winner: message.author, winnerMessage: message });
  else await message.react('❌').catch(() => {});
  return true;
}

export async function handleComponent(interaction) {
  const [, action, arg] = interaction.customId.split(':');
  const channel = interaction.channel;

  if (action === 'again') {
    if (rounds.has(channel.id)) return fail(interaction, 'Igra u ovom kanalu već traje.');
    await interaction.update({ components: [] });
    await startRound(channel, arg === 'svi' ? null : arg);
    return;
  }

  const round = rounds.get(channel.id);
  if (!round || round.message?.id !== interaction.message.id) {
    return fail(interaction, 'Ova runda je već završila.');
  }
  if (action === 'hint') {
    round.hint = true;
    return interaction.update(roundPayload(round));
  }
  if (action === 'skip') {
    await interaction.deferUpdate();
    await endRound(channel, { reason: 'skip' });
  }
}
