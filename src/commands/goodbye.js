import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as db from '../db.js';
import { DEFAULT_GOODBYE, goodbyePayload } from '../features/members.js';
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
    g.config.goodbye = { channelId: channel.id, message: message ?? null };
    db.save();
    return reply(interaction, `✅ Poruke odlaska idu u ${channel}.\n**Poruka:**\n${message ?? DEFAULT_GOODBYE}`);
  }
  if (sub === 'off') {
    delete g.config.goodbye;
    db.save();
    return reply(interaction, '✅ Poruke odlaska su isključene.');
  }
  if (sub === 'test') {
    const channel = g.config.goodbye && interaction.guild.channels.cache.get(g.config.goodbye.channelId);
    if (!channel) return fail(interaction, 'Poruka odlaska nije podešena. Koristi `/goodbye set`.');
    await channel.send(goodbyePayload(interaction.member));
    return reply(interaction, `✅ Testna poruka odlaska poslana u ${channel}.`);
  }
}
