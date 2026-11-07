// "Toplo-hladno": the bot picks a secret Croatian word and every guess gets a
// percentage showing how close it is. It is a channel game, like kaladont.
import { EmbedBuilder } from 'discord.js';
import * as db from '../../db.js';
import { UserError } from '../../utils/helpers.js';
import { hasRound } from './flags.js';
import { randomSecret, similarity, similarityBar, similarityLabel } from './similarity.js';
import { WORD_RE, clean, normalize } from './text.js';

const COLOR_HOT = 0xed4245;
const COLOR_WARM = 0xf59e0b;
const COLOR_COLD = 0x3b82f6;
const COLOR_WIN = 0x57f287;
const MIN_LENGTH = 2;
const MAX_LENGTH = 30;
const MAX_GUESSES = 50;

const queues = new Map(); // channelId -> promise, keeps guesses in order

const games = (guildId) => (db.guild(guildId).toplo ??= {});

export function activeGames(guildId) {
  return Object.entries(games(guildId)).map(([channelId, game]) => ({
    channelId,
    secretLength: Array.from(game.secret).length,
    guessCount: game.guesses.length,
    best: game.best ? { word: game.best.word, percent: game.best.percent } : null,
    startedAt: game.startedAt,
  }));
}

export function validateGuess(game, word) {
  if (!word) return 'Upiši riječ.';
  if (word.length < MIN_LENGTH) return `Riječ mora imati barem ${MIN_LENGTH} slova.`;
  if (word.length > MAX_LENGTH) return `Riječ može imati najviše ${MAX_LENGTH} slova.`;
  if (!WORD_RE.test(word)) return 'Koristi samo slova (bez brojeva i znakova).';
  if (game.guesses.some((g) => normalize(g.word) === normalize(word))) return `**${word}** je već bio pokušaj.`;
  return null;
}

function newGame() {
  return { secret: randomSecret(), startedAt: Date.now(), guesses: [], best: null };
}

function startEmbed() {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🌡️ Toplo-hladno je počelo')
    .setDescription(
      'Pogodite **tajnu riječ** pisanjem po jedne riječi u chat.\n' +
        'Bot će za svaki pokušaj reći koliko je blizu: **0%** je potpuno nepovezano, **100%** je pogodak.\n\n' +
        '🔥 vruće · 🌡️ toplo · 😊 mlako · ❄️ hladno · 🧊 ledeno',
    )
    .setFooter({ text: 'Pokušajte riječi iz iste teme — sinonim pomaže.' });
}

function guessEmbed(game, word, percent, author, count) {
  const label = similarityLabel(percent);
  const color = percent >= 75 ? COLOR_HOT : percent >= 40 ? COLOR_WARM : COLOR_COLD;
  const hint =
    percent >= 95 ? 'Gotovo! Još jedan korak.' :
    percent >= 75 ? 'Vrlo blizu — razmišljaj o istoj temi.' :
    percent >= 50 ? 'Ima veze. Probaj bliži pojam.' :
    percent >= 25 ? 'Malo je povezano, ali još je hladno.' :
    'Potpuno druga tema. Probaj nešto srodno.';
  const best = game.best && game.best.percent > percent ? `Najbolje: **${game.best.word}** (${game.best.percent}%)` : 'Novi najbolji pokušaj!';
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(`${label} — ${percent}%`)
    .setDescription(`**${word}**\n\`${similarityBar(percent)}\`\n${hint}`)
    .setFooter({ text: `${author.username} · pokušaj #${count} · ${best}`, iconURL: author.displayAvatarURL() });
}

function winEmbed(word, author, count) {
  return new EmbedBuilder()
    .setColor(COLOR_WIN)
    .setTitle('🎉 Pogodak!')
    .setDescription(`${author} je pogodio/la tajnu riječ **${word}** u **${count}** pokušaja.`)
    .setFooter({ text: 'Nova runda počinje odmah.' });
}

export async function start(channel) {
  const all = games(channel.guild.id);
  if (all[channel.id]) throw new UserError('Toplo-hladno već traje u ovom kanalu. Zaustavi ga s `/toplohladno stop`.');
  if (hasRound(channel.id)) throw new UserError('U ovom kanalu traje pogađanje zastava. Pokreni igru u drugom kanalu.');
  if (db.guild(channel.guild.id).kaladont?.[channel.id]) {
    throw new UserError('U ovom kanalu traje kaladont. Zaustavi ga s `/kaladont stop`.');
  }
  const game = newGame();
  all[channel.id] = game;
  db.save();
  await channel.send({ embeds: [startEmbed()] });
}

export function stop(channel) {
  const all = games(channel.guild.id);
  const game = all[channel.id];
  if (!game) throw new UserError('U ovom kanalu ne traje toplo-hladno.');
  delete all[channel.id];
  db.save();
  return game;
}

async function handleGuess(message) {
  const all = games(message.guild.id);
  const game = all[message.channelId];
  if (!game) return;
  const word = clean(message.content);
  if (!WORD_RE.test(word)) return;
  const problem = validateGuess(game, word);
  if (problem) {
    await message.react('🔁').catch(() => {});
    const reply = await message.reply({ content: problem, allowedMentions: { repliedUser: false } }).catch(() => null);
    if (reply) setTimeout(() => reply.delete().catch(() => {}), 8000).unref?.();
    return;
  }
  const percent = similarity(game.secret, word);
  game.guesses.push({ word, percent, userId: message.author.id, at: Date.now() });
  if (game.guesses.length > MAX_GUESSES) game.guesses.shift();
  if (!game.best || percent > game.best.percent) game.best = { word, percent, userId: message.author.id };
  db.save();

  if (percent >= 100) {
    const finished = game.guesses.length;
    await message.channel.send({ embeds: [winEmbed(word, message.author, finished)], allowedMentions: { parse: [] } });
    const next = newGame();
    all[message.channelId] = next;
    db.save();
    await message.channel.send({ embeds: [startEmbed().setTitle('🌡️ Nova runda')] });
    return;
  }

  await message.react(percent >= 75 ? '🔥' : percent >= 40 ? '🌡️' : '❄️').catch(() => {});
  await message.channel.send({
    embeds: [guessEmbed(game, word, percent, message.author, game.guesses.length)],
    allowedMentions: { parse: [] },
  });
}

export function onMessage(message) {
  if (!db.guild(message.guild.id).toplo?.[message.channelId]) return false;
  const queue = (queues.get(message.channelId) ?? Promise.resolve())
    .then(() => handleGuess(message))
    .catch((err) => console.error('[toplo]', err));
  queues.set(message.channelId, queue);
  return true;
}
