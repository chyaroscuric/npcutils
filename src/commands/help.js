import { EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { COLOR } from '../utils/helpers.js';

export const data = new SlashCommandBuilder().setName('help').setDescription('Popis svih Jaankeza Utils komandi')
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('🤖 Jaankeza Utils — komande')
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
      { name: '🎵 Glazba', value: '`/play` • `/skip` • `/pause` • `/resume` • `/stop` • `/queue` • `/loop` • `/shuffle` • `/remove`' },
      { name: '🎮 Igre', value: '`/zastava` • `/wordle` • `/kaladont start|stop` • `/ship`' },
      {
        name: '🔨 Moderacija',
        value: '`/purge` • `/ban` • `/unban` • `/kick` • `/timeout` • `/untimeout` • `/warn` • `/warnings` • `/clearwarns` • `/slowmode` • `/lock` • `/unlock` • `/modlog`',
      },
      { name: '📋 Kloniranje servera', value: '`/klon izvor` • `/klon cilj` • `/klon status` • `/klon pokreni`' },
      { name: '🛡️ Anti-nuke', value: '`/antinuke status` • `/antinuke ukljuci` • `/antinuke pravilo` • `/antinuke postavke` • `/antinuke whitelist`' },
    )
    .setFooter({ text: 'Jaankeza Utils' });
  if (process.env.DASHBOARD_URL && process.env.CLIENT_SECRET) {
    embed.setDescription(`Sve se može podesiti i preko dashboarda: ${process.env.DASHBOARD_URL}`);
  }
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
