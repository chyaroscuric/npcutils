import { EmbedBuilder, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as levels from '../features/levels.js';
import { COLOR, UserError, reply } from '../utils/helpers.js';

export const deferEphemeral = true;

const fmt = (n) => new Intl.NumberFormat('hr-HR').format(Number(n) || 0);
const fmtVoice = (ms) => {
  let s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
  const d = Math.floor(s / 86400); s -= d * 86400;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  return [d ? `${d}d` : '', h ? `${h}h` : '', `${m}m`].filter(Boolean).join(' ');
};

const levelsData = new SlashCommandBuilder()
  .setName('levels')
  .setDescription('Leveli za poruke i vrijeme u voice kanalu')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) => s.setName('status').setDescription('Prikaži postavke levela'))
  .addSubcommand((s) =>
    s
      .setName('ukljuci')
      .setDescription('Uključi ili isključi levele')
      .addBooleanOption((o) => o.setName('ukljuceno').setDescription('Uključeno?').setRequired(true)),
  )
  .addSubcommand((s) =>
    s
      .setName('postavke')
      .setDescription('Podesi XP i cooldown')
      .addIntegerOption((o) => o.setName('xp_poruka').setDescription('XP po poruci (1–100)').setMinValue(1).setMaxValue(100))
      .addIntegerOption((o) => o.setName('xp_minuta').setDescription('XP po minuti u voice kanalu (0–100)').setMinValue(0).setMaxValue(100))
      .addIntegerOption((o) => o.setName('cooldown').setDescription('Sekunde između XP-a za poruke (0–3600)').setMinValue(0).setMaxValue(3600))
      .addBooleanOption((o) => o.setName('obavijest').setDescription('Objavi kad netko dosegne novi level')),
  )
  .addSubcommand((s) =>
    s
      .setName('reset')
      .setDescription('Resetiraj statistiku')
      .addUserOption((o) => o.setName('korisnik').setDescription('Samo ovaj član'))
      .addBooleanOption((o) => o.setName('sve').setDescription('Resetiraj sve članove')),
  );

const rankData = new SlashCommandBuilder()
  .setName('rank')
  .setDescription('Prikaži level, XP, poruke i vrijeme u voice kanalu')
  .setContexts(InteractionContextType.Guild)
  .addUserOption((o) => o.setName('korisnik').setDescription('Član (zadano: ti)'));

const topData = new SlashCommandBuilder()
  .setName('top')
  .setDescription('Top članovi po broju poruka i vremenu u voice kanalu')
  .setContexts(InteractionContextType.Guild)
  .addStringOption((o) =>
    o
      .setName('vrsta')
      .setDescription('Što prikazati')
      .addChoices({ name: 'Oboje', value: 'both' }, { name: 'Samo tekst', value: 'text' }, { name: 'Samo voice', value: 'voice' }),
  )
  .addIntegerOption((o) => o.setName('broj').setDescription('Koliko članova (5–25)').setMinValue(5).setMaxValue(25));

function statusEmbed(guild, cfg) {
  return new EmbedBuilder()
    .setColor(cfg.enabled ? 0x57f287 : 0xed4245)
    .setTitle(`📈 Leveli: ${cfg.enabled ? 'uključeni' : 'isključeni'}`)
    .addFields(
      { name: 'XP po poruci', value: String(cfg.xpPerMessage), inline: true },
      { name: 'XP po minuti u voiceu', value: String(cfg.xpPerMinuteVoice), inline: true },
      { name: 'Cooldown za poruke', value: `${cfg.cooldownSec} s`, inline: true },
      { name: 'Obavijest o levelu', value: cfg.announce ? 'uključena' : 'isključena', inline: true },
    )
    .setFooter({ text: 'Level se računa iz ukupnog XP-a (poruke + voice).' });
}

function topLines(entries, guild, key) {
  if (!entries.length) return 'Još nema podataka.';
  return entries
    .map((u, i) => {
      const member = guild.members.cache.get(u.userId);
      const name = member?.displayName ?? `Korisnik ${u.userId.slice(-4)}`;
      const value = key === 'messages' ? `${fmt(u.messages)} poruka` : fmtVoice(u.voiceMs);
      return `**#${i + 1}** ${name} — ${value}`;
    })
    .join('\n');
}

async function executeLevels(interaction) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  if (sub === 'status') return interaction.editReply({ embeds: [statusEmbed(guild, levels.getConfig(guild.id))] });
  if (sub === 'ukljuci') {
    const cfg = levels.saveConfig(guild.id, { enabled: interaction.options.getBoolean('ukljuceno', true) });
    await reply(interaction, '✅ Spremljeno.');
    return interaction.followUp({ embeds: [statusEmbed(guild, cfg)] });
  }
  if (sub === 'postavke') {
    const input = {};
    for (const [opt, key] of [['xp_poruka', 'xpPerMessage'], ['xp_minuta', 'xpPerMinuteVoice'], ['cooldown', 'cooldownSec']]) {
      const v = interaction.options.getInteger(opt);
      if (v !== null) input[key] = v;
    }
    const announce = interaction.options.getBoolean('obavijest');
    if (announce !== null) input.announce = announce;
    const cfg = levels.saveConfig(guild.id, input);
    await reply(interaction, '✅ Spremljeno.');
    return interaction.followUp({ embeds: [statusEmbed(guild, cfg)] });
  }
  if (sub === 'reset') {
    const user = interaction.options.getUser('korisnik');
    const all = interaction.options.getBoolean('sve');
    if (!user && !all) throw new UserError('Odaberi člana ili postavi `sve` na true.');
    if (all) levels.resetAll(guild.id);
    else levels.resetUser(guild.id, user.id);
    return reply(interaction, all ? '✅ Statistika svih članova je resetirana.' : `✅ Statistika za ${user} je resetirana.`);
  }
}

async function executeRank(interaction) {
  const user = interaction.options.getUser('korisnik') ?? interaction.user;
  const r = levels.rank(interaction.guild.id, user.id);
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(`📈 ${user.username}`)
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .addFields(
      { name: 'Level', value: String(r.level), inline: true },
      { name: 'XP', value: fmt(r.xp), inline: true },
      { name: 'Rang', value: r.rank ? `#${r.rank} / ${r.total}` : '—', inline: true },
      { name: 'Poruke', value: fmt(r.messages), inline: true },
      { name: 'Vrijeme u voiceu', value: fmtVoice(r.voiceMs), inline: true },
      { name: 'Do sljedećeg levela', value: fmt(Math.max(0, levels.xpForLevel(r.level + 1) - r.xp)) + ' XP', inline: true },
    );
  return interaction.editReply({ embeds: [embed] });
}

async function executeTop(interaction) {
  const guild = interaction.guild;
  const limit = interaction.options.getInteger('broj') ?? 10;
  const kind = interaction.options.getString('vrsta') ?? 'both';
  await guild.members.fetch().catch(() => {});
  const t = levels.top(guild.id, limit);
  const embed = new EmbedBuilder().setColor(COLOR).setTitle('🏆 Top članovi');
  if (kind !== 'voice') embed.addFields({ name: '💬 TOP TEXT', value: topLines(t.text, guild, 'messages') });
  if (kind !== 'text') embed.addFields({ name: '🎙️ TOP VOICE', value: topLines(t.voice, guild, 'voiceMs') });
  const me = levels.rank(guild.id, interaction.user.id);
  embed.setFooter({ text: `Tvoj rang: ${me.rank ? `#${me.rank}` : '—'} · Level ${me.level} · ${fmt(me.xp)} XP` });
  return interaction.editReply({ embeds: [embed] });
}

export const commands = [
  { deferEphemeral: true, data: levelsData, execute: executeLevels },
  { deferEphemeral: true, data: rankData, execute: executeRank },
  { deferEphemeral: true, data: topData, execute: executeTop },
];
