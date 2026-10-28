// Wordle in Croatian: guess the 5-letter word in 6 tries.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { WORDS } from '../../data/words.mjs';
import { UserError, fail } from '../../utils/helpers.mjs';
import { isWord, ready } from './dictionary.mjs';
import { WORD_RE, clean, letters, normalize, pick, upper } from './text.mjs';

const LENGTH = 5;
const TRIES = 6;
const SQUARE = { correct: '🟩', present: '🟨', absent: '⬛' };

const games = new Map(); // `${guildId}:${userId}` -> game

// Standard Wordle colouring, including repeated letters (each letter of the answer is "used" once).
// Letters are compared without diacritics, so typing "c" counts for "č"/"ć" (s = š, z = ž, d = đ).
export function score(guess, answer) {
  const g = letters(guess).map(normalize);
  const a = letters(answer).map(normalize);
  const result = Array(g.length).fill('absent');
  const left = new Map();
  g.forEach((ch, i) => {
    if (ch === a[i]) result[i] = 'correct';
    else left.set(a[i], (left.get(a[i]) ?? 0) + 1);
  });
  g.forEach((ch, i) => {
    if (result[i] === 'correct') return;
    if (left.get(ch) > 0) {
      result[i] = 'present';
      left.set(ch, left.get(ch) - 1);
    }
  });
  return result;
}

function payload(game, user) {
  const rows = game.guesses.map(({ word, result }) => `${result.map((r) => SQUARE[r]).join('')}  \`${upper(word)}\``);
  while (rows.length < TRIES) rows.push('⬜⬜⬜⬜⬜');

  const absent = new Set();
  const found = new Set();
  for (const { word, result } of game.guesses) {
    letters(word).forEach((ch, i) => (result[i] === 'absent' ? absent : found).add(normalize(ch)));
  }
  for (const ch of found) absent.delete(ch);

  const embed = new EmbedBuilder()
    .setAuthor({ name: `Wordle — ${user.username}`, iconURL: user.displayAvatarURL() })
    .setDescription(rows.join('\n'))
    .setFooter({ text: `Pokušaj ${game.guesses.length}/${TRIES}` });
  if (absent.size) embed.addFields({ name: 'Nema slova', value: [...absent].sort().map((c) => c.toUpperCase()).join(' ') });

  if (game.status === 'won') {
    embed.setColor(0x57f287).setTitle(`🎉 Pogođeno iz ${game.guesses.length}. pokušaja`);
  } else if (game.status === 'lost' || game.status === 'quit') {
    embed.setColor(0xed4245).setTitle(`Riječ je bila: ${game.answer.toUpperCase()}`);
  } else {
    embed.setColor(0x5865f2).setTitle('🟩 Wordle').setDescription(`${rows.join('\n')}\n\nPogodi riječ od ${LENGTH} slova. Klikni **Pogodi**.`);
  }

  const active = game.status === 'playing';
  const components = active
    ? [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`wordle:guess:${game.userId}`).setLabel('Pogodi').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`wordle:quit:${game.userId}`).setLabel('Odustani').setStyle(ButtonStyle.Secondary),
        ),
      ]
    : [];
  return { embeds: [embed], components };
}

export async function startGame(interaction) {
  const key = `${interaction.guild.id}:${interaction.user.id}`;
  const existing = games.get(key);
  if (existing?.status === 'playing') {
    throw new UserError(`Već igraš Wordle: ${existing.url ?? 'pogledaj gore u chatu'}. Klikni Odustani ako želiš novu igru.`);
  }
  ready(); // start loading the dictionary for guess validation
  const game = { userId: interaction.user.id, answer: pick(WORDS), guesses: [], status: 'playing' };
  games.set(key, game);
  const message = await interaction.editReply(payload(game, interaction.user));
  game.url = message.url;
}

// Returns an error text, or null when the guess may be played.
export function validateGuess(guess) {
  if (letters(guess).length !== LENGTH) return `Riječ mora imati točno ${LENGTH} slova.`;
  if (!WORD_RE.test(guess)) return 'Koristi samo slova (č, ć, đ, š, ž su dopuštena).';
  if (!WORDS.some((w) => normalize(w) === normalize(guess)) && !isWord(guess)) return `Ne poznajem riječ **${guess.toUpperCase()}**.`;
  return null;
}

export async function handleComponent(interaction) {
  const [, action, ownerId] = interaction.customId.split(':');
  if (interaction.user.id !== ownerId) return fail(interaction, 'Ovo nije tvoja igra. Pokreni svoju s `/wordle`.');
  const game = games.get(`${interaction.guild.id}:${ownerId}`);
  if (!game || game.status !== 'playing') return fail(interaction, 'Ova igra je završila. Pokreni novu s `/wordle`.');

  if (action === 'guess') {
    const modal = new ModalBuilder()
      .setCustomId(`wordle:modal:${ownerId}`)
      .setTitle(`Wordle — pokušaj ${game.guesses.length + 1}/${TRIES}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('guess')
            .setLabel(`Riječ od ${LENGTH} slova`)
            .setStyle(TextInputStyle.Short)
            .setMinLength(LENGTH)
            .setMaxLength(LENGTH)
            .setRequired(true),
        ),
      );
    return interaction.showModal(modal);
  }
  if (action === 'quit') {
    game.status = 'quit';
    return interaction.update(payload(game, interaction.user));
  }
  if (action === 'modal') {
    const guess = clean(interaction.fields.getTextInputValue('guess'));
    const problem = validateGuess(guess);
    if (problem) return fail(interaction, problem);
    game.guesses.push({ word: guess, result: score(guess, game.answer) });
    if (normalize(guess) === normalize(game.answer)) game.status = 'won';
    else if (game.guesses.length >= TRIES) game.status = 'lost';
    return interaction.update(payload(game, interaction.user));
  }
}
