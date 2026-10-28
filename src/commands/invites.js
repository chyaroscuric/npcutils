import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js';
import * as db from '../db.js';
import { stats } from '../features/invites.js';
import { COLOR } from '../utils/helpers.js';

export const data = new SlashCommandBuilder()
  .setName('invites')
  .setDescription('Koliko invite-ova netko ima')
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) => o.setName('korisnik').setDescription('Čije invite-ove provjeriti (default: tvoje)'));

export async function execute(interaction) {
  const user = interaction.options.getUser('korisnik') ?? interaction.user;
  const g = db.guild(interaction.guild.id);
  const s = stats(g, user.id);
  const invitedBy = g.joins[user.id]?.inviterId;

  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
    .setDescription(
      `${user} ima **${s.total}** invite-ova.\n\n` +
        `✅ **${s.regular}** pravih\n❌ **${s.left}** izašlo\n💩 **${s.fake}** lažnih (novi računi)\n✨ **${s.bonus}** bonus`,
    );
  if (invitedBy) embed.addFields({ name: 'Njega/nju je pozvao/la', value: `<@${invitedBy}>` });
  await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}
