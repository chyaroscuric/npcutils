// Kaladont: every word must start with the last two letters of the previous one.
// A word ending in "nt" (like "kaladont") cannot be continued, so whoever writes it wins.
import { EmbedBuilder } from 'discord.js';
import * as db from '../../db.js';
import { WORDS } from '../../data/words.js';
import { UserError } from '../../utils/helpers.js';
import { countStartingWith, isWord, ready } from './dictionary.js';
import { WORD_RE, clean, pick } from './text.js';

const COLOR_GAME = 0x5865f2;
const COLOR_ERROR = 0xf0883e;
const COLOR_WIN = 0x57f287;
const ERROR_TTL = 10_000;
const MIN_LENGTH = 3;

const queues = new Map(); // channelId -> promise, so moves in one channel are handled in order

const games = (guildId) => (db.guild(guildId).kaladont ??= {});
export const required = (word) => word.slice(-2);

export function activeGames(guildId) {
  return Object.entries(games(guildId)).map(([channelId, g]) => ({
    channelId,
    lastWord: g.lastWord,
    lastUserId: g.lastUserId,
    streak: g.streak,
    usedCount: g.used.length,
  }));
}

// A start word that does not end the game right away and can be continued.
function startWord() {
  const options = WORDS.filter((w) => !w.endsWith('nt') && countStartingWith(required(w)) >= 20);
  return pick(options.length ? options : WORDS);
}

// Returns the reason a move is not allowed, or null.
export function checkMove(game, userId, word) {
  if (game.lastUserId === userId) return { title: '⛔ Nije tvoj red!', text: 'Moraš pričekati da netko drugi upiše riječ.' };
  if (word.length < MIN_LENGTH) return { title: '⛔ Prekratko', text: `Riječ mora imati barem ${MIN_LENGTH} slova.` };
  if (!word.startsWith(required(game.lastWord))) {
    return { title: '⛔ Krivi početak', text: `Riječ mora počinjati s **${required(game.lastWord)}**.` };
  }
  if (game.used.includes(word)) return { title: '⛔ Već iskorišteno', text: `Riječ **${word}** je već bila u ovoj igri.` };
  if (!isWord(word)) return { title: '⛔ Ne poznajem tu riječ', text: `**${word}** nije u mom rječniku.` };
  return null;
}

function newGame() {
  const word = startWord();
  return { lastWord: word, lastUserId: null, used: [word], streak: 0 };
}

function startEmbed(game, title = '🔤 Kaladont je počeo') {
  return new EmbedBuilder()
    .setColor(COLOR_GAME)
    .setTitle(title)
    .setDescription(
      `Prva riječ: **${game.lastWord}**\nIduća riječ mora počinjati s **${required(game.lastWord)}**.\n\n` +
        'Pišite po jednu riječ. Isti igrač ne smije dvaput zaredom, a tko napiše riječ koja završava na **-nt** (npr. *kaladont*), pobjeđuje.',
    );
}

export async function start(channel) {
  await ready();
  const all = games(channel.guild.id);
  if (all[channel.id]) throw new UserError('Kaladont već traje u ovom kanalu. Zaustavi ga s `/kaladont stop`.');
  const game = newGame();
  all[channel.id] = game;
  db.save();
  await channel.send({ embeds: [startEmbed(game)] });
}

export function stop(channel) {
  const all = games(channel.guild.id);
  const game = all[channel.id];
  if (!game) throw new UserError('U ovom kanalu ne traje kaladont.');
  delete all[channel.id];
  db.save();
  return game;
}

async function rejectMove(message, game, problem) {
  await message.react('❌').catch(() => {});
  const embed = new EmbedBuilder()
    .setColor(COLOR_ERROR)
    .setTitle(problem.title)
    .setDescription(problem.text)
    .addFields(
      { name: '🔥 Streak', value: `${game.streak} poteza`, inline: true },
      { name: '🔤 Potrebna slova', value: `'${required(game.lastWord)}'`, inline: true },
    )
    .setFooter({ text: `${message.author.username} · greška`, iconURL: message.author.displayAvatarURL() });
  const reply = await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => null);
  if (reply) setTimeout(() => reply.delete().catch(() => {}), ERROR_TTL).unref();
}

async function handleMove(message) {
  const all = games(message.guild.id);
  const game = all[message.channelId];
  if (!game) return;
  const word = clean(message.content);
  // normal chat (sentences, emojis, links) is ignored
  if (!WORD_RE.test(word)) return;

  const problem = checkMove(game, message.author.id, word);
  if (problem) return rejectMove(message, game, problem);

  game.lastWord = word;
  game.lastUserId = message.author.id;
  game.used.push(word);
  game.streak++;
  db.save();
  await message.react('✅').catch(() => {});

  const deadEnd = word.endsWith('nt') || countStartingWith(required(word)) === 0;
  if (!deadEnd) return;
  const embed = new EmbedBuilder()
    .setColor(COLOR_WIN)
    .setTitle('🏆 KALADONT!')
    .setDescription(
      `${message.author} je pobijedio/la riječju **${word}**: nema riječi koja počinje s **${required(word)}**.\n` +
        `Igra je trajala **${game.streak}** poteza.`,
    );
  await message.channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  const next = newGame();
  all[message.channelId] = next;
  db.save();
  await message.channel.send({ embeds: [startEmbed(next, '🔤 Nova runda')] });
}

export function onMessage(message) {
  if (!db.guild(message.guild.id).kaladont?.[message.channelId]) return false;
  const queue = (queues.get(message.channelId) ?? Promise.resolve())
    .then(() => handleMove(message))
    .catch((err) => console.error('[kaladont]', err));
  queues.set(message.channelId, queue);
  return queue;
}
