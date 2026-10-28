import { EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { COLOR } from '../utils/helpers.js';

export const data = new SlashCommandBuilder().setName('help').setDescription('Popis svih NPC Utils komandi')
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('🤖 NPC Utils — komande')
    .setThumbnail(interaction.client.user.displayAvatarURL())
    .addFields(
      { name: '📊 Statistika', value: '`/stats setup` • `/stats refresh` • `/stats remove`' },
      { name: '🎫 Tiketi', value: '`/ticket setup` • `/ticket panel` • `/ticket close` • `/ticket add` • `/ticket remove`' },
      { name: '📨 Invite counter', value: '`/invites` • `/leaderboard` • `/invitesadmin bonus` • `/invitesadmin reset`' },
      { name: '👋 Welcome', value: '`/welcome set` • `/welcome test` • `/welcome off`' },
      { name: '🚀 Boost poruka', value: '`/boost set` • `/boost test` • `/boost off`' },
      { name: '🏷️ Autorole', value: '`/autorole add` • `/autorole remove` • `/autorole list`' },
      { name: '😀 Reaction roles', value: '`/reactionrole create` • `/reactionrole add` • `/reactionrole remove` • `/reactionrole list`' },
      { name: '🎉 Giveaway', value: '`/giveaway start` • `/giveaway end` • `/giveaway reroll` • `/giveaway list` • `/giveaway delete`' },
    )
    .setFooter({ text: 'NPC Utils' });
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
