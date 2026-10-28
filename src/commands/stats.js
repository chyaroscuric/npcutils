import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { computeStats, removeStats, setupStats, updateStats } from '../features/stats.js';
import { fail } from '../utils/helpers.js';
import * as db from '../db.js';

// Acknowledged right away (ephemeral) because these commands talk to Discord and can take >3 s.
export const deferEphemeral = true;

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Kanali sa brojem članova, botova i boostova')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('setup').setDescription('Napravi (ili ponovno napravi) stats kanale na vrhu servera'))
  .addSubcommand((s) => s.setName('refresh').setDescription('Odmah osvježi brojeve'))
  .addSubcommand((s) => s.setName('remove').setDescription('Obriši stats kanale'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    return fail(interaction, 'Trebam permisiju **Manage Channels**.');
  }

  if (sub === 'setup') {
    await guild.members.fetch();
    await setupStats(guild);
    const s = computeStats(guild);
    return interaction.editReply(
      `✅ Stats kanali napravljeni! (👥 ${s.members} • 🤖 ${s.bots} • 🚀 ${s.boosts})\nBrojevi se ažuriraju automatski (Discord dopušta promjenu imena kanala najviše 2x u 10 min, pa može kasniti par minuta).`,
    );
  }
  if (sub === 'refresh') {
    if (!db.guild(guild.id).config.stats) return interaction.editReply('❌ Stats kanali nisu podešeni. Koristi `/stats setup`.');
    await guild.members.fetch();
    await updateStats(guild);
    return interaction.editReply('✅ Osvježeno (ako je kanal nedavno preimenovan, promjena stiže za par minuta).');
  }
  if (sub === 'remove') {
    const removed = await removeStats(guild);
    return interaction.editReply(removed ? '✅ Stats kanali obrisani.' : '❌ Stats kanali nisu bili podešeni.');
  }
}
