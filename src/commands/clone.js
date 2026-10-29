import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { cloneServer, endSession, plan, session, validate } from '../features/clone.js';
import { UserError, fail, reply } from '../utils/helpers.js';

export const data = new SlashCommandBuilder()
  .setName('klon')
  .setDescription('Kopiraj role, kanale i postavke s jednog servera na drugi')
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('izvor').setDescription('Ovaj server je izvor (s njega se kopira) — treba Administrator'))
  .addSubcommand((s) => s.setName('cilj').setDescription('Ovaj server je cilj (briše se i u njega se kopira) — samo vlasnik'))
  .addSubcommand((s) => s.setName('status').setDescription('Prikaži odabrani izvor i cilj'))
  .addSubcommand((s) =>
    s
      .setName('pokreni')
      .setDescription('Obriši cilj i kopiraj izvor u njega (traži potvrdu)')
      .addBooleanOption((o) => o.setName('profil').setDescription('Kopiraj ime, ikonu i opis servera (zadano: da)'))
      .addBooleanOption((o) => o.setName('emojiji').setDescription('Kopiraj i emojije (zadano: ne)'))
      .addBooleanOption((o) => o.setName('postavke_bota').setDescription('Kopiraj postavke ovog bota: welcome, tiketi, autorole… (zadano: da)')),
  );

function describe(client, id) {
  const guild = id && client.guilds.cache.get(id);
  return guild ? `**${guild.name}** (\`${id}\`)` : id ? `\`${id}\` (bot više nije tamo)` : '*nije postavljen*';
}

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const s = session(interaction.user.id);

  if (sub === 'izvor') {
    if (!interaction.memberPermissions.has('Administrator')) throw new UserError('Za izvor trebaš **Administrator** na ovom serveru.');
    s.sourceId = interaction.guild.id;
    return reply(interaction, `✅ Izvor: **${interaction.guild.name}**\nSad na serveru u koji kopiraš upiši \`/klon cilj\`.`);
  }
  if (sub === 'cilj') {
    if (interaction.guild.ownerId !== interaction.user.id) throw new UserError('Samo **vlasnik** ovog servera ga može postaviti kao cilj.');
    s.targetId = interaction.guild.id;
    return reply(interaction, `⚠️ Cilj: **${interaction.guild.name}**\n\`/klon pokreni\` će ovdje **obrisati sve kanale i role** prije kopiranja.`);
  }
  if (sub === 'status') {
    return reply(interaction, `**Izvor:** ${describe(interaction.client, s.sourceId)}\n**Cilj:** ${describe(interaction.client, s.targetId)}`);
  }

  // pokreni: show exactly what will happen and ask for confirmation
  const { source, target } = await validate(interaction.client, interaction.user.id);
  s.options = {
    profile: interaction.options.getBoolean('profil') ?? true,
    emojis: interaction.options.getBoolean('emojiji') ?? false,
    botSettings: interaction.options.getBoolean('postavke_bota') ?? true,
  };
  const p = plan(source, target);
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle(`⚠️ Obrisati ${target.name} i kopirati ${source.name}?`)
    .setDescription(
      `Na **${target.name}** bit će obrisano **${p.deleteChannels}** kanala i **${p.deleteRoles}** rola. Poruke u tim kanalima nestaju zauvijek.\n\n` +
        `Zatim se kopira **${p.createRoles}** rola i **${p.createChannels}** kanala s **${source.name}**` +
        `${s.options.emojis ? `, i do **${p.emojis}** emojija` : ''}.\n` +
        `Profil servera: **${s.options.profile ? 'da' : 'ne'}** · Postavke bota: **${s.options.botSettings ? 'da' : 'ne'}**\n\n` +
        'Članovi i poruke se ne kopiraju. Rola bota mora biti na vrhu na oba servera.',
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`clone:confirm:${interaction.user.id}`).setLabel(`Obriši i kopiraj`).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`clone:cancel:${interaction.user.id}`).setLabel('Odustani').setStyle(ButtonStyle.Secondary),
  );
  return interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
}

export async function handleComponent(interaction) {
  const [, action, userId] = interaction.customId.split(':');
  if (interaction.user.id !== userId) return fail(interaction, 'Ovo nije tvoje kloniranje.');
  if (action === 'cancel') return interaction.update({ content: 'Kloniranje otkazano.', embeds: [], components: [] });

  const { source, target } = await validate(interaction.client, userId);
  const options = session(userId).options ?? { profile: true, emojis: false, botSettings: true };
  await interaction.update({ content: '🚀 Počinjem kloniranje…', embeds: [], components: [] });
  // the interaction token lasts 15 minutes; a very big server may take longer, so progress is best-effort
  const progress = (text) => interaction.editReply({ content: text }).catch(() => {});
  const keepChannelId = interaction.guildId === target.id ? interaction.channelId : null;

  let result;
  try {
    result = await cloneServer({ source, target, keepChannelId, options, progress });
  } catch (err) {
    console.error('[clone]', err);
    await progress(`❌ Kloniranje nije uspjelo: \`${err.message}\``);
    return;
  }
  endSession(userId);

  const summary =
    `✅ **Kloniranje gotovo:** ${source.name} → ${target.name}\n` +
    `Role: **${result.roles}** · Kanali: **${result.channels}**${options.emojis ? ` · Emojiji: **${result.emojis}**` : ''}` +
    (result.failed.length ? `\n\nNije uspjelo (${result.failed.length}): ${result.failed.slice(0, 15).join(', ')}${result.failed.length > 15 ? '…' : ''}` : '');
  if (keepChannelId) {
    // this channel is not part of the copy: remove it and report by DM
    await interaction.user.send(summary).catch(() => {});
    await interaction.channel.delete('Kloniranje servera').catch(() => {});
  } else {
    await progress(summary);
  }
}
