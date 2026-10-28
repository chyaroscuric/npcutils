import { ChannelType, InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import * as db from '../db.js';
import { createGiveaway, deleteGiveaway, endGiveaway, reroll } from '../features/giveaways.js';
import { parseDuration } from '../utils/duration.js';
import { fail, reply } from '../utils/helpers.js';

const MAX_DURATION = 60 * 24 * 60 * 60 * 1000;
const idOption = (o) => o.setName('poruka_id').setDescription('ID giveaway poruke').setRequired(true);

// Acknowledged right away (ephemeral) because these commands talk to Discord and can take >3 s.
export const deferEphemeral = true;

export const data = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('Giveaway')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommand((s) =>
    s
      .setName('start')
      .setDescription('Pokreni giveaway')
      .addStringOption((o) => o.setName('trajanje').setDescription('npr. 30m, 2h, 1d, 1w, 1d12h').setRequired(true))
      .addIntegerOption((o) => o.setName('pobjednika').setDescription('Broj pobjednika').setMinValue(1).setMaxValue(50).setRequired(true))
      .addStringOption((o) => o.setName('nagrada').setDescription('Što se osvaja').setRequired(true).setMaxLength(200))
      .addStringOption((o) => o.setName('opis').setDescription('Dodatni opis / uvjeti').setMaxLength(1000))
      .addChannelOption((o) =>
        o.setName('kanal').setDescription('Kanal (default: ovaj)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      ),
  )
  .addSubcommand((s) => s.setName('end').setDescription('Završi giveaway odmah').addStringOption(idOption))
  .addSubcommand((s) =>
    s
      .setName('reroll')
      .setDescription('Izvuci nove pobjednike')
      .addStringOption(idOption)
      .addIntegerOption((o) => o.setName('pobjednika').setDescription('Koliko novih pobjednika (default: isto kao prije)').setMinValue(1).setMaxValue(50)),
  )
  .addSubcommand((s) => s.setName('list').setDescription('Aktivni giveawayi'))
  .addSubcommand((s) => s.setName('delete').setDescription('Obriši giveaway (bez izvlačenja)').addStringOption(idOption));

export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  const g = db.guild(guildId);
  const messageId = interaction.options.getString('poruka_id')?.trim();

  if (sub === 'start') {
    const durationMs = parseDuration(interaction.options.getString('trajanje', true));
    if (!durationMs || durationMs < 10_000 || durationMs > MAX_DURATION) {
      return fail(interaction, 'Neispravno trajanje. Primjeri: `30m`, `2h`, `1d`, `1w`, `1d12h` (min 10s, max 60 dana).');
    }
    const channel = interaction.options.getChannel('kanal') ?? interaction.channel;
    try {
      const message = await createGiveaway({
        channel,
        hostId: interaction.user.id,
        prize: interaction.options.getString('nagrada', true),
        winners: interaction.options.getInteger('pobjednika', true),
        description: interaction.options.getString('opis')?.replace(/\\n/g, '\n'),
        durationMs,
      });
      return reply(interaction, `✅ Giveaway pokrenut: ${message.url}\nID: \`${message.id}\``);
    } catch {
      return fail(interaction, `Ne mogu slati poruke u ${channel}.`);
    }
  }

  if (sub === 'list') {
    const active = Object.entries(g.giveaways).filter(([, gw]) => !gw.ended);
    const lines = active.map(
      ([id, gw]) =>
        `**${gw.prize}** — završava <t:${Math.floor(gw.endsAt / 1000)}:R> — ${gw.entrants.length} sudionika — [link](https://discord.com/channels/${guildId}/${gw.channelId}/${id}) (\`${id}\`)`,
    );
    return reply(interaction, lines.join('\n') || 'Nema aktivnih giveawaya.');
  }

  const gw = g.giveaways[messageId];
  if (!gw) return fail(interaction, 'Ne mogu naći giveaway s tim ID-em.');

  if (sub === 'end') {
    if (gw.ended) return fail(interaction, 'Taj giveaway je već završen. Za nove pobjednike koristi `/giveaway reroll`.');
    await endGiveaway(guildId, messageId);
    return reply(interaction, '✅ Giveaway završen.');
  }
  if (sub === 'reroll') {
    if (!gw.ended) return fail(interaction, 'Giveaway još traje. Završi ga s `/giveaway end`.');
    const winners = await reroll(guildId, messageId, interaction.options.getInteger('pobjednika'));
    return reply(interaction, winners?.length ? `✅ Novi pobjednici: ${winners.map((id) => `<@${id}>`).join(', ')}` : '❌ Nema dovoljno sudionika.');
  }
  if (sub === 'delete') {
    await deleteGiveaway(guildId, messageId);
    return reply(interaction, '✅ Giveaway obrisan.');
  }
}
