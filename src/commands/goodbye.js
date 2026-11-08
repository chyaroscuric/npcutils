import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as db from '../db.js';
import { DEFAULT_GOODBYE, GOODBYE_BANNER, buildGoodbyePayload } from '../features/members.js';
import { normalizeBanner } from '../features/welcomeBanner.js';
import { fail, reply } from '../utils/helpers.js';

// Acknowledged right away (ephemeral) because sending the test message talks to Discord.
export const deferEphemeral = true;

export const data = new SlashCommandBuilder()
  .setName('goodbye')
  .setDescription('Poruka kad netko napusti server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('set')
      .setDescription('Podesi poruku odlaska')
      .addChannelOption((o) =>
        o.setName('kanal').setDescription('Kanal za poruke odlaska').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true),
      )
      .addStringOption((o) =>
        o
          .setName('poruka')
          .setDescription('{user} {username} {server} {memberCount} {inviter} {invites} {joined}, \\n = novi red')
          .setMaxLength(2000),
      )
      .addStringOption((o) =>
        o
          .setName('banner')
          .setDescription('URL pozadinske slike za automatski banner odlaska')
          .setMaxLength(2048),
      )
      .addStringOption((o) =>
        o
          .setName('banner_tekst')
          .setDescription('Tekst na banneru, npr. "Dovidenja od {server}"')
          .setMaxLength(160),
      ),
  )
  .addSubcommand((s) => s.setName('test').setDescription('Pošalji testnu poruku odlaska (za tebe)'))
  .addSubcommand((s) => s.setName('off').setDescription('Isključi poruke odlaska'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const g = db.guild(interaction.guild.id);

  if (sub === 'set') {
    const channel = interaction.options.getChannel('kanal', true);
    const message = interaction.options.getString('poruka');
    const bannerUrl = interaction.options.getString('banner');
    const bannerTitle = interaction.options.getString('banner_tekst');
    const previousBanner = normalizeBanner(g.config.goodbye?.banner, GOODBYE_BANNER);
    const banner = {
      ...previousBanner,
      enabled: bannerUrl ? true : previousBanner.enabled,
      backgroundUrl: bannerUrl ?? previousBanner.backgroundUrl,
    };
    if (bannerTitle) banner.title = bannerTitle;
    g.config.goodbye = { channelId: channel.id, message: message ?? null, banner };
    db.save();
    return reply(
      interaction,
      `✅ Poruke odlaska idu u ${channel}.\n**Poruka:**\n${message ?? DEFAULT_GOODBYE}` +
        (banner.enabled && banner.backgroundUrl ? '\n\n🖼️ Automatski banner odlaska je uključen.' : ''),
    );
  }
  if (sub === 'off') {
    delete g.config.goodbye;
    db.save();
    return reply(interaction, '✅ Poruke odlaska su isključene.');
  }
  if (sub === 'test') {
    const channel = g.config.goodbye && interaction.guild.channels.cache.get(g.config.goodbye.channelId);
    if (!channel) return fail(interaction, 'Poruka odlaska nije podešena. Koristi `/goodbye set`.');
    await channel.send(await buildGoodbyePayload(interaction.member));
    return reply(interaction, `✅ Testna poruka odlaska poslana u ${channel}.`);
  }
}
