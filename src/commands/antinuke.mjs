import { ChannelType, EmbedBuilder, InteractionContextType, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { PUNISHMENTS, RULES, canConfigure, getConfig, limitText, saveConfig } from '../features/antinuke.mjs';
import { UserError, reply } from '../utils/helpers.mjs';

export const deferEphemeral = true;

const ruleChoices = Object.entries(RULES).map(([value, r]) => ({ name: r.label, value }));
const punishmentChoices = Object.entries(PUNISHMENTS).map(([value, name]) => ({ name, value }));

export const data = new SlashCommandBuilder()
  .setName('antinuke')
  .setDescription('Zaštita servera od uništavanja (samo vlasnik servera mijenja postavke)')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('status').setDescription('Prikaži postavke anti-nukea'))
  .addSubcommand((s) =>
    s
      .setName('ukljuci')
      .setDescription('Uključi ili isključi anti-nuke')
      .addBooleanOption((o) => o.setName('ukljuceno').setDescription('Uključeno?').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('pravilo')
      .setDescription('Podesi jedno pravilo (limit i kaznu)')
      .addStringOption((o) => o.setName('akcija').setDescription('Pravilo').setRequired(true).addChoices(...ruleChoices))
      .addBooleanOption((o) => o.setName('ukljuceno').setDescription('Je li pravilo uključeno'))
      .addIntegerOption((o) => o.setName('limit').setDescription('Nakon koliko akcija u vremenskom prozoru slijedi kazna (1 = već prva)').setMinValue(0).setMaxValue(50))
      .addStringOption((o) => o.setName('kazna').setDescription('Kazna').addChoices(...punishmentChoices)),
  )
  .addSubcommand((s) =>
    s
      .setName('postavke')
      .setDescription('Općenite postavke')
      .addChannelOption((o) => o.setName('log_kanal').setDescription('Kanal za upozorenja').addChannelTypes(ChannelType.GuildText))
      .addIntegerOption((o) => o.setName('prozor').setDescription('Vremenski prozor za limite, u sekundama (5–3600)').setMinValue(5).setMaxValue(3600))
      .addBooleanOption((o) => o.setName('vrati_promjene').setDescription('Automatski vrati štetu (unban, ponovno napravi kanale i role…)')),
  )
  .addSubcommandGroup((g) =>
    g
      .setName('whitelist')
      .setDescription('Korisnici i role na koje anti-nuke ne reagira')
      .addSubcommand((s) =>
        s
          .setName('dodaj')
          .setDescription('Dodaj na whitelist')
          .addUserOption((o) => o.setName('korisnik').setDescription('Korisnik'))
          .addRoleOption((o) => o.setName('rola').setDescription('Rola')),
      )
      .addSubcommand((s) =>
        s
          .setName('makni')
          .setDescription('Makni s whitelista')
          .addUserOption((o) => o.setName('korisnik').setDescription('Korisnik'))
          .addRoleOption((o) => o.setName('rola').setDescription('Rola')),
      ),
  );

function statusEmbed(guild, cfg) {
  const rules = Object.entries(RULES).map(([key, r]) => {
    const rule = cfg.rules[key];
    const limit = r.limited ? `limit ${rule.limit} (${limitText(rule.limit)})` : 'odmah';
    return `${rule.enabled ? '✅' : '⬛'} **${r.label}** — ${limit}, kazna: ${PUNISHMENTS[rule.punishment]}`;
  });
  const whitelist = [...cfg.whitelistUsers.map((id) => `<@${id}>`), ...cfg.whitelistRoles.map((id) => `<@&${id}>`)];
  return new EmbedBuilder()
    .setColor(cfg.enabled ? 0x57f287 : 0xed4245)
    .setTitle(`🛡️ Anti-nuke: ${cfg.enabled ? 'uključen' : 'isključen'}`)
    .setDescription(rules.join('\n'))
    .addFields(
      { name: 'Vremenski prozor', value: `${cfg.windowSec} s`, inline: true },
      { name: 'Vraćanje štete', value: cfg.revert ? 'uključeno' : 'isključeno', inline: true },
      { name: 'Log kanal', value: cfg.logChannelId ? `<#${cfg.logChannelId}>` : 'nema', inline: true },
      { name: 'Whitelist', value: whitelist.join(', ') || 'nitko (vlasnik i bot su uvijek izuzeti)' },
    )
    .setFooter({ text: 'Moja rola mora biti na vrhu popisa rola da bih mogao kazniti napadača.' });
}

export async function execute(interaction) {
  const guild = interaction.guild;
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();

  if (sub === 'status') {
    return interaction.editReply({ embeds: [statusEmbed(guild, getConfig(guild.id))] });
  }
  if (!canConfigure(guild, interaction.user.id)) throw new UserError('Postavke anti-nukea može mijenjati samo vlasnik servera.');

  let cfg;
  if (sub === 'ukljuci') {
    if (interaction.options.getBoolean('ukljuceno', true) && !guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
      throw new UserError('Trebam permisiju **View Audit Log** (najbolje Administrator) da bih vidio tko što radi.');
    }
    cfg = saveConfig(guild.id, { enabled: interaction.options.getBoolean('ukljuceno', true) });
  } else if (sub === 'pravilo') {
    const key = interaction.options.getString('akcija', true);
    const rule = {};
    const enabled = interaction.options.getBoolean('ukljuceno');
    const limit = interaction.options.getInteger('limit');
    const punishment = interaction.options.getString('kazna');
    if (enabled !== null) rule.enabled = enabled;
    if (limit !== null) rule.limit = limit;
    if (punishment) rule.punishment = punishment;
    cfg = saveConfig(guild.id, { rules: { [key]: rule } });
  } else if (sub === 'postavke') {
    const input = {};
    const log = interaction.options.getChannel('log_kanal');
    const windowSec = interaction.options.getInteger('prozor');
    const revert = interaction.options.getBoolean('vrati_promjene');
    if (log) input.logChannelId = log.id;
    if (windowSec !== null) input.windowSec = windowSec;
    if (revert !== null) input.revert = revert;
    cfg = saveConfig(guild.id, input);
  } else if (group === 'whitelist') {
    const user = interaction.options.getUser('korisnik');
    const role = interaction.options.getRole('rola');
    if (!user && !role) throw new UserError('Odaberi korisnika ili rolu.');
    const current = getConfig(guild.id);
    const change = (list, id) => (sub === 'dodaj' ? [...list, id] : list.filter((x) => x !== id));
    cfg = saveConfig(guild.id, {
      whitelistUsers: user ? change(current.whitelistUsers, user.id) : current.whitelistUsers,
      whitelistRoles: role ? change(current.whitelistRoles, role.id) : current.whitelistRoles,
    });
  }
  await reply(interaction, '✅ Spremljeno.');
  return interaction.followUp({ embeds: [statusEmbed(guild, cfg)], flags: MessageFlags.Ephemeral });
}
