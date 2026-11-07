import { EmbedBuilder, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as mafia from '../features/games/mafia.js';
import { COLOR, UserError, reply } from '../utils/helpers.js';

export const deferEphemeral = true;

const data = new SlashCommandBuilder()
  .setName('mafia')
  .setDescription('Mafija — društvena igra s ulogama, noćnim akcijama i glasanjem')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('start').setDescription('Otvori okupljanje za mafiju u ovom kanalu'))
  .addSubcommand((s) => s.setName('stop').setDescription('Zaustavi mafiju u ovom kanalu'))
  .addSubcommand((s) =>
    s
      .setName('stats')
      .setDescription('Prikaži mafija bodove')
      .addUserOption((o) => o.setName('korisnik').setDescription('Član (zadano: ti)')),
  );

function statsEmbed(user, score) {
  return new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`🔪 Mafija statistika — ${user.username}`)
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .addFields(
      { name: 'Bodovi', value: String(score.points), inline: true },
      { name: 'Pobjede', value: String(score.wins), inline: true },
      { name: 'Odigrane igre', value: String(score.games), inline: true },
    );
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  if (sub === 'start') {
    const game = await mafia.start(interaction.channel, interaction.member);
    return reply(interaction, `🕵️ Mafija je otvorena! Klikni **Pridruži se** u poruci iznad. Potrebno je barem 4 igrača, a pokreće ju <@${game.hostId}>.`);
  }
  if (sub === 'stop') {
    const active = mafia.getGame(interaction.channel.id);
    if (!active) throw new UserError('U ovom kanalu ne traje mafija.');
    const allowed = active.hostId === interaction.user.id || interaction.member.permissions.has(PermissionFlagsBits.ManageChannels);
    if (!allowed) throw new UserError('Mafiju može zaustaviti samo domaćin ili moderator.');
    const game = mafia.stop(interaction.channel);
    await game.message?.edit({
      embeds: [
        new EmbedBuilder()
          .setColor(0x4f545c)
          .setTitle('🛑 Mafija je zaustavljena')
          .setDescription(`Igra je prekinuta. Bilo je ${game.players.length} igrača.`),
      ],
      components: [],
    }).catch(() => {});
    return reply(interaction, '✅ Mafija je zaustavljena.');
  }
  const user = interaction.options.getUser('korisnik') ?? interaction.user;
  return interaction.editReply({ embeds: [statsEmbed(user, mafia.stats(interaction.guild.id, user.id))] });
}

export const commands = [{ deferEphemeral: true, data, execute }];
