import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as db from '../db.js';
import { fail, reply, roleProblem } from '../utils/helpers.js';

export const data = new SlashCommandBuilder()
  .setName('autorole')
  .setDescription('Role koje svaki novi član dobije automatski')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Dodaj autorole (npr. Member)')
      .addRoleOption((o) => o.setName('rola').setDescription('Rola').setRequired(true))
      .addBooleanOption((o) => o.setName('daj_postojecima').setDescription('Daj ovu rolu i svim postojećim članovima (bez botova)')),
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Makni autorole')
      .addRoleOption((o) => o.setName('rola').setDescription('Rola').setRequired(true)),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Popis autorola'));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const g = db.guild(interaction.guild.id);
  g.config.autoroles ??= [];

  if (sub === 'add') {
    const role = interaction.options.getRole('rola', true);
    const problem = roleProblem(interaction.guild, role);
    if (problem) return fail(interaction, problem);
    if (!g.config.autoroles.includes(role.id)) g.config.autoroles.push(role.id);
    db.save();

    if (!interaction.options.getBoolean('daj_postojecima')) {
      return reply(interaction, `✅ Svaki novi član će dobiti ${role}.`);
    }
    await reply(interaction, `✅ Svaki novi član će dobiti ${role}. Dajem rolu postojećim članovima...`);
    const members = await interaction.guild.members.fetch();
    let given = 0;
    for (const member of members.values()) {
      if (member.user.bot || member.roles.cache.has(role.id)) continue;
      await member.roles.add(role, 'NPC Utils autorole').then(() => given++, () => {});
    }
    return reply(interaction, `✅ ${role} dana za **${given}** postojećih članova.`);
  }
  if (sub === 'remove') {
    const role = interaction.options.getRole('rola', true);
    g.config.autoroles = g.config.autoroles.filter((id) => id !== role.id);
    db.save();
    return reply(interaction, `✅ ${role} više nije autorole.`);
  }
  if (sub === 'list') {
    const list = g.config.autoroles.map((id) => `<@&${id}>`).join('\n');
    return reply(interaction, list ? `**Autorole:**\n${list}` : 'Nema podešenih autorola. Dodaj s `/autorole add`.');
  }
}
