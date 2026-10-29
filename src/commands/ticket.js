import { ChannelType, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as db from '../db.js';
import { askClose, panelPayload, setMemberAccess } from '../features/tickets.js';
import { fail, isAdmin, reply } from '../utils/helpers.js';

export const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Tiket sistem')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('setup')
      .setDescription('(Admin) Podesi tikete')
      .addChannelOption((o) =>
        o.setName('kategorija').setDescription('Kategorija u kojoj se otvaraju tiketi').addChannelTypes(ChannelType.GuildCategory).setRequired(true),
      )
      .addRoleOption((o) => o.setName('support_rola').setDescription('Rola koja vidi i odgovara na tikete'))
      .addChannelOption((o) =>
        o.setName('log_kanal').setDescription('Kanal gdje se šalju transkripti zatvorenih tiketa').addChannelTypes(ChannelType.GuildText),
      ),
  )
  .addSubcommand((s) =>
    s
      .setName('panel')
      .setDescription('(Admin) Pošalji poruku s gumbom za otvaranje tiketa')
      .addChannelOption((o) => o.setName('kanal').setDescription('Kanal (default: ovaj)').addChannelTypes(ChannelType.GuildText))
      .addStringOption((o) => o.setName('naslov').setDescription('Naslov poruke').setMaxLength(256))
      .addStringOption((o) => o.setName('opis').setDescription('Tekst poruke (\\n za novi red)').setMaxLength(2000)),
  )
  .addSubcommand((s) => s.setName('close').setDescription('Zatvori ovaj tiket'))
  .addSubcommand((s) =>
    s
      .setName('add')
      .setDescription('Dodaj osobu u ovaj tiket')
      .addUserOption((o) => o.setName('korisnik').setDescription('Koga dodati').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('remove')
      .setDescription('Ukloni osobu iz ovog tiketa')
      .addUserOption((o) => o.setName('korisnik').setDescription('Koga ukloniti').setRequired(true)),
  );

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'setup' || sub === 'panel') {
    if (!isAdmin(interaction.member)) return fail(interaction, 'Treba ti permisija **Manage Server**.');
  }

  if (sub === 'setup') {
    const category = interaction.options.getChannel('kategorija', true);
    const role = interaction.options.getRole('support_rola');
    const log = interaction.options.getChannel('log_kanal');
    db.guild(interaction.guild.id).config.tickets = {
      categoryId: category.id,
      supportRoleId: role?.id ?? null,
      logChannelId: log?.id ?? null,
    };
    db.save();
    return reply(
      interaction,
      `✅ Tiketi podešeni!\n**Kategorija:** ${category}\n**Support rola:** ${role ?? 'nema (samo admini)'}\n**Log kanal:** ${log ?? 'nema'}\n\nSad pošalji panel s \`/ticket panel\`.`,
    );
  }

  if (sub === 'panel') {
    if (!db.guild(interaction.guild.id).config.tickets) return fail(interaction, 'Prvo pokreni `/ticket setup`.');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const channel = interaction.options.getChannel('kanal') ?? interaction.channel;
    const title = interaction.options.getString('naslov');
    const description = interaction.options.getString('opis')?.replace(/\\n/g, '\n');
    try {
      await channel.send(panelPayload(title, description));
    } catch {
      return fail(interaction, `Ne mogu slati poruke u ${channel}.`);
    }
    return reply(interaction, `✅ Tiket panel poslan u ${channel}.`);
  }

  if (sub === 'close') return askClose(interaction);
  if (sub === 'add') return setMemberAccess(interaction, interaction.options.getUser('korisnik', true), true);
  if (sub === 'remove') return setMemberAccess(interaction, interaction.options.getUser('korisnik', true), false);
}
