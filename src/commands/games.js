import { AttachmentBuilder, EmbedBuilder, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { CONTINENTS } from '../data/countries.js';
import { startRound } from '../features/games/flags.js';
import * as kaladont from '../features/games/kaladont.js';
import { comment, renderShip, shipName, shipPercent } from '../features/games/ship.js';
import { startGame } from '../features/games/wordle.js';
import { UserError, reply } from '../utils/helpers.js';

const zastava = {
  deferEphemeral: true,
  data: new SlashCommandBuilder()
    .setName('zastava')
    .setDescription('Pogodi državu po zastavi')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName('kontinent')
        .setDescription('Samo države s jednog kontinenta')
        .addChoices({ name: 'Svi', value: 'svi' }, ...Object.entries(CONTINENTS).map(([value, name]) => ({ name, value }))),
    ),
  async execute(interaction) {
    const continent = interaction.options.getString('kontinent');
    await startRound(interaction.channel, continent && continent !== 'svi' ? continent : null);
    return reply(interaction, '🌍 Igra je počela. Pogodite državu u chatu.');
  },
};

const wordle = {
  data: new SlashCommandBuilder().setName('wordle').setDescription('Pogodi riječ od 5 slova u 6 pokušaja').setContexts(InteractionContextType.Guild),
  async execute(interaction) {
    await interaction.deferReply();
    try {
      await startGame(interaction);
    } catch (err) {
      // the public "thinking…" message should not stay behind
      await interaction.deleteReply().catch(() => {});
      throw err;
    }
  },
};

const kaladontCommand = {
  deferEphemeral: true,
  data: new SlashCommandBuilder()
    .setName('kaladont')
    .setDescription('Igra kaladont u ovom kanalu')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((s) => s.setName('start').setDescription('Pokreni kaladont u ovom kanalu'))
    .addSubcommand((s) => s.setName('stop').setDescription('Zaustavi kaladont u ovom kanalu')),
  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'start') {
      await kaladont.start(interaction.channel);
      return reply(interaction, '✅ Kaladont je pokrenut u ovom kanalu.');
    }
    const game = kaladont.stop(interaction.channel);
    await interaction.channel.send({
      embeds: [new EmbedBuilder().setColor(0x4f545c).setTitle('🛑 Kaladont je zaustavljen').setDescription(`Zadnja riječ: **${game.lastWord}** · ${game.streak} poteza`)],
    });
    return reply(interaction, '✅ Zaustavljeno.');
  },
};

const ship = {
  data: new SlashCommandBuilder()
    .setName('ship')
    .setDescription('Koliko ste kompatibilni?')
    .setContexts(InteractionContextType.Guild)
    .addUserOption((o) => o.setName('korisnik1').setDescription('Prva osoba').setRequired(true))
    .addUserOption((o) => o.setName('korisnik2').setDescription('Druga osoba (default: ti)')),
  async execute(interaction) {
    const a = interaction.options.getUser('korisnik1', true);
    const b = interaction.options.getUser('korisnik2') ?? interaction.user;
    if (a.id === b.id) throw new UserError('Odaberi dvije različite osobe.');
    await interaction.deferReply();
    const percent = shipPercent(a.id, b.id);
    const nameA = interaction.guild.members.cache.get(a.id)?.displayName ?? a.username;
    const nameB = interaction.guild.members.cache.get(b.id)?.displayName ?? b.username;
    const image = await renderShip(a.displayAvatarURL({ extension: 'png', size: 512 }), b.displayAvatarURL({ extension: 'png', size: 512 }), percent);
    const embed = new EmbedBuilder()
      .setColor(0xdd2e44)
      .setTitle(`💘 ${shipName(nameA, nameB)}`)
      .setDescription(`**${nameA}** + **${nameB}** = **${percent}%**\n${comment(percent)}`)
      .setImage('attachment://ship.png');
    return interaction.editReply({ embeds: [embed], files: [new AttachmentBuilder(image, { name: 'ship.png' })] });
  },
};

export const commands = [zastava, wordle, kaladontCommand, ship];
