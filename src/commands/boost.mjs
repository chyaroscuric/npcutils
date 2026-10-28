import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as db from '../db.mjs';
import { DEFAULT_BOOST, boostPayload } from '../features/members.mjs';
import { fail, reply } from '../utils/helpers.mjs';

// Acknowledged right away (ephemeral) because these commands talk to Discord and can take >3 s.
export const deferEphemeral = true;

export const data = new SlashCommandBuilder()
  .setName('boost')
  .setDescription('Poruka kad netko boosta server')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('set')
      .setDescription('Podesi boost poruku')
      .addChannelOption((o) =>
        o.setName('kanal').setDescription('Kanal za boost poruke').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true),
      )
      .addStringOption((o) =>
        o.setName('poruka').setDescription('{user} {username} {server} {boosts} {level}, \\n = novi red').setMaxLength(2000),
      ),
  )
  .addSubcommand((s) => s.setName('test').setDescription('Pošalji testnu boost poruku (za tebe)'))
  .addSubcommand((s) => s.setName('off').setDescription('Isključi boost poruke'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const g = db.guild(interaction.guild.id);

  if (sub === 'set') {
    const channel = interaction.options.getChannel('kanal', true);
    const message = interaction.options.getString('poruka');
    g.config.boost = { channelId: channel.id, message: message ?? null };
    db.save();
    return reply(interaction, `✅ Boost poruke idu u ${channel}.\n**Poruka:**\n${message ?? DEFAULT_BOOST}`);
  }
  if (sub === 'off') {
    delete g.config.boost;
    db.save();
    return reply(interaction, '✅ Boost poruke isključene.');
  }
  if (sub === 'test') {
    const channel = g.config.boost && interaction.guild.channels.cache.get(g.config.boost.channelId);
    if (!channel) return fail(interaction, 'Boost poruka nije podešena. Koristi `/boost set`.');
    await channel.send(boostPayload(interaction.member));
    return reply(interaction, `✅ Testna poruka poslana u ${channel}.`);
  }
}
