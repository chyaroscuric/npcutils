import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { addBonus, reset } from '../features/invites.js';
import { reply } from '../utils/helpers.js';

export const data = new SlashCommandBuilder()
  .setName('invitesadmin')
  .setDescription('Upravljanje invite-ovima')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('bonus')
      .setDescription('Dodaj (ili oduzmi s minusom) bonus invite-ove')
      .addUserOption((o) => o.setName('korisnik').setDescription('Korisnik').setRequired(true))
      .addIntegerOption((o) => o.setName('broj').setDescription('Koliko (npr. 5 ili -3)').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('reset')
      .setDescription('Resetiraj invite-ove jednog korisnika ili cijelog servera')
      .addUserOption((o) => o.setName('korisnik').setDescription('Ako ne odabereš nikoga, resetira se cijeli server')),
  );

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const user = interaction.options.getUser('korisnik');

  if (sub === 'bonus') {
    const amount = interaction.options.getInteger('broj', true);
    const s = addBonus(interaction.guild.id, user.id, amount);
    return reply(interaction, `✅ ${user} sada ima **${s.total}** invite-ova (bonus: ${s.bonus}).`);
  }
  if (sub === 'reset') {
    reset(interaction.guild.id, user?.id);
    return reply(interaction, user ? `✅ Invite-ovi za ${user} su resetirani.` : '✅ Svi invite-ovi na serveru su resetirani.');
  }
}
