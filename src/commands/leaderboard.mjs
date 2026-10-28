import { EmbedBuilder, InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { leaderboard } from '../features/invites.mjs';
import { COLOR } from '../utils/helpers.mjs';

export const data = new SlashCommandBuilder()
  .setName('leaderboard')
  .setDescription('Top 10 po broju invite-ova')
  .setContexts(InteractionContextType.Guild);

const MEDALS = ['🥇', '🥈', '🥉'];

export async function execute(interaction) {
  const top = leaderboard(interaction.guild.id, 10);
  const lines = top.map(
    (s, i) => `${MEDALS[i] ?? `**${i + 1}.**`} <@${s.id}> — **${s.total}** invite-ova (${s.regular} pravih, ${s.left} izašlo, ${s.bonus} bonus)`,
  );
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`📨 Invite leaderboard — ${interaction.guild.name}`)
    .setDescription(lines.join('\n') || 'Još nitko nikoga nije pozvao.');
  await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}
