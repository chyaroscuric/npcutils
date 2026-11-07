import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as db from '../db.js';
import { DEFAULT_WELCOME, buildWelcomePayload } from '../features/members.js';
import { normalizeBanner } from '../features/welcomeBanner.js';
import { fail, reply } from '../utils/helpers.js';

// Acknowledged right away (ephemeral) because these commands talk to Discord and can take >3 s.
export const deferEphemeral = true;

export const data = new SlashCommandBuilder()
  .setName('welcome')
  .setDescription('Poruka kad netko uđe na server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('set')
      .setDescription('Podesi welcome poruku')
      .addChannelOption((o) =>
        o.setName('kanal').setDescription('Kanal za welcome poruke').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('poruka')
          .setDescription('{user} {username} {server} {memberCount} {inviter} {invites}, \\n = novi red')
          .setMaxLength(2000),
      )
      .addStringOption((o) =>
        o
          .setName('banner')
          .setDescription('URL pozadinske slike za automatski banner (avatar i ime se dodaju sami)')
          .setMaxLength(2048),
      )
      .addStringOption((o) =>
        o
          .setName('banner_tekst')
          .setDescription('Tekst na banneru, npr. "Dobrodošao/la kod {server}"')
          .setMaxLength(160),
      ),
  )
  .addSubcommand((s) => s.setName('test').setDescription('Pošalji testnu welcome poruku (za tebe)'))
  .addSubcommand((s) => s.setName('off').setDescription('Isključi welcome poruke'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const g = db.guild(interaction.guild.id);

  if (sub === 'set') {
    const channel = interaction.options.getChannel('kanal', true);
    const message = interaction.options.getString('poruka');
    const bannerUrl = interaction.options.getString('banner');
    const bannerTitle = interaction.options.getString('banner_tekst');
    const previousBanner = normalizeBanner(g.config.welcome?.banner);
    const banner = {
      ...previousBanner,
      enabled: bannerUrl ? true : previousBanner.enabled,
      backgroundUrl: bannerUrl ?? previousBanner.backgroundUrl,
    };
    if (bannerTitle) banner.title = bannerTitle;
    g.config.welcome = { channelId: channel.id, message: message ?? null, banner };
    db.save();
    return reply(
      interaction,
      `✅ Welcome poruke idu u ${channel}.\n**Poruka:**\n${message ?? DEFAULT_WELCOME}` +
        (banner.enabled && banner.backgroundUrl ? '\n\n🖼️ Automatski banner je uključen.' : ''),
    );
  }
  if (sub === 'off') {
    delete g.config.welcome;
    db.save();
    return reply(interaction, '✅ Welcome poruke isključene.');
  }
  if (sub === 'test') {
    const channel = g.config.welcome && interaction.guild.channels.cache.get(g.config.welcome.channelId);
    if (!channel) return fail(interaction, 'Welcome nije podešen. Koristi `/welcome set`.');
    await channel.send(await buildWelcomePayload(interaction.member, g.joins[interaction.user.id]?.inviterId ?? null));
    return reply(interaction, `✅ Testna poruka poslana u ${channel}.`);
  }
}
