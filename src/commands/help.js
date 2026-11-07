import { EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { COLOR } from '../utils/helpers.js';

export const data = new SlashCommandBuilder().setName('help').setDescription('Popis svih komandi bota')
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
  const botName = interaction.client.user.username;
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`🤖 ${botName} — komande`)
    .setThumbnail(interaction.client.user.displayAvatarURL())
    .addFields(
      { name: '📊 Statistika', value: '`/stats server` • `/stats tiktok` • `/stats youtube` • `/stats twitch` • `/stats setup` • `/stats refresh` • `/stats remove`' },
      { name: '🎫 Tiketi', value: '`/ticket setup` • `/ticket panel` • `/ticket close` • `/ticket add` • `/ticket remove`' },
      { name: '📨 Invite counter', value: '`/invites` • `/leaderboard` • `/invitesadmin bonus` • `/invitesadmin reset`' },
      { name: '👋 Welcome', value: '`/welcome set` • `/welcome test` • `/welcome off`' },
      { name: '🚪 Odlazak', value: '`/goodbye set` • `/goodbye test` • `/goodbye off`' },
      { name: '🎂 Rođendani', value: '`/birthday postavi` • `/birthday ukloni` • `/birthday sljedeci` • `/birthday postavke` • `/birthday test` • `/birthday iskljuci`' },
      { name: '🚀 Boost poruka', value: '`/boost set` • `/boost test` • `/boost off`' },
      { name: '🏷️ Autorole', value: '`/autorole add` • `/autorole remove` • `/autorole list`' },
      { name: '😀 Reaction roles', value: '`/reactionrole create` • `/reactionrole add` • `/reactionrole remove` • `/reactionrole list`' },
      { name: '🎉 Giveaway', value: '`/giveaway start` • `/giveaway end` • `/giveaway reroll` • `/giveaway list` • `/giveaway delete`' },
      { name: '🎵 Glazba', value: '`/play` • `/skip` • `/pause` • `/resume` • `/stop` • `/queue` • `/loop` • `/shuffle` • `/remove`' },
      { name: '🎮 Igre', value: '`/zastava` • `/wordle` • `/kaladont start|stop` • `/toplohladno start|stop` • `/mafia start|stop|stats` • `/fish` • `/ship` • `/counting setup|status|reset|off`' },
      { name: '📈 Leveli', value: '`/rank` • `/top` • `/levels status|ukljuci|postavke|reset`' },
      { name: '📨 Poruke i embedi', value: '`/posalji` — pošalji poruku ili embed kao bot' },
      {
        name: '🔨 Moderacija',
        value: '`/purge` • `/ban` • `/unban` • `/kick` • `/timeout` • `/untimeout` • `/warn` • `/warnings` • `/clearwarns` • `/slowmode` • `/lock` • `/unlock` • `/modlog`',
      },
      { name: '📋 Kloniranje servera', value: '`/klon izvor` • `/klon cilj` • `/klon status` • `/klon pokreni`' },
      { name: '🛡️ Anti-nuke', value: '`/antinuke status` • `/antinuke ukljuci` • `/antinuke pravilo` • `/antinuke postavke` • `/antinuke whitelist`' },
      { name: '🔗 Zaštita od linkova', value: '`/antilink status` • `/antilink ukljuci` • `/antilink pravilo` • `/antilink obavijest` • `/antilink whitelist`' },
    )
    .setFooter({ text: botName });
  if (process.env.DASHBOARD_URL && process.env.CLIENT_SECRET) {
    embed.setDescription(`Sve se može podesiti i preko dashboarda: ${process.env.DASHBOARD_URL}`);
  }
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
