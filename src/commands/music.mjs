import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import { LOOP_LABELS, control, formatDuration, getQueue, memberCanControl, play } from '../features/music.mjs';
import { fail, reply } from '../utils/helpers.mjs';

const simple = (name, description, action, done) => ({
  data: new SlashCommandBuilder().setName(name).setDescription(description).setContexts(InteractionContextType.Guild),
  async execute(interaction) {
    const problem = memberCanControl(interaction.member);
    if (problem) return fail(interaction, problem);
    control(interaction.guild.id, action);
    return reply(interaction, done, { ephemeral: false });
  },
});

const playCommand = {
  data: new SlashCommandBuilder()
    .setName('play')
    .setDescription('Pusti pjesmu (naziv, YouTube/SoundCloud link ili playlista)')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) => o.setName('pjesma').setDescription('Naziv pjesme ili link').setRequired(true).setMaxLength(500)),
  async execute(interaction) {
    const voiceChannel = interaction.member.voice.channel;
    if (!voiceChannel) return fail(interaction, 'Prvo uđi u voice kanal.');
    // searching can take a few seconds
    await interaction.deferReply();
    const { queue, added, playlistTitle } = await play({
      guild: interaction.guild,
      voiceChannel,
      textChannel: interaction.channel,
      query: interaction.options.getString('pjesma', true),
      requestedBy: { id: interaction.user.id, name: interaction.member.displayName },
    });
    const playingNow = queue.current === added[0];
    const text = playlistTitle
      ? `📃 Dodano **${added.length}** pjesama iz playliste **${playlistTitle}**.`
      : playingNow
        ? `🎶 Pokrećem **${added[0].title}** (${formatDuration(added[0].durationMs)})`
        : `➕ Dodano u red (#${queue.tracks.length}): **${added[0].title}** (${formatDuration(added[0].durationMs)})`;
    return reply(interaction, text);
  },
};

const queueCommand = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('Prikaži red pjesama')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((o) => o.setName('stranica').setDescription('Stranica').setMinValue(1)),
  async execute(interaction) {
    const q = getQueue(interaction.guild.id);
    if (!q?.current) return fail(interaction, 'Trenutno ništa ne svira.');
    const perPage = 10;
    const pages = Math.max(1, Math.ceil(q.tracks.length / perPage));
    const page = Math.min(interaction.options.getInteger('stranica') ?? 1, pages);
    const lines = q.tracks
      .slice((page - 1) * perPage, page * perPage)
      .map((t, i) => `**${(page - 1) * perPage + i + 1}.** [${t.title}](${t.url}) · ${formatDuration(t.durationMs)}`);
    const text =
      `**Sada svira:** [${q.current.title}](${q.current.url}) · ${formatDuration(q.positionMs)} / ${formatDuration(q.current.durationMs)}\n` +
      `**Ponavljanje:** ${LOOP_LABELS[q.loop]}\n\n` +
      (lines.join('\n') || '*Red je prazan.*') +
      (pages > 1 ? `\n\nStranica ${page}/${pages}` : '');
    return reply(interaction, text, { ephemeral: false });
  },
};

const loopCommand = {
  data: new SlashCommandBuilder()
    .setName('loop')
    .setDescription('Ponavljanje')
    .setContexts(InteractionContextType.Guild)
    .addStringOption((o) =>
      o
        .setName('nacin')
        .setDescription('Što ponavljati')
        .setRequired(true)
        .addChoices({ name: 'Isključeno', value: 'off' }, { name: 'Pjesma', value: 'track' }, { name: 'Cijeli red', value: 'queue' }),
    ),
  async execute(interaction) {
    const problem = memberCanControl(interaction.member);
    if (problem) return fail(interaction, problem);
    const mode = interaction.options.getString('nacin', true);
    control(interaction.guild.id, 'loop', mode);
    return reply(interaction, `🔁 Ponavljanje: **${LOOP_LABELS[mode]}**`, { ephemeral: false });
  },
};

const removeCommand = {
  data: new SlashCommandBuilder()
    .setName('remove')
    .setDescription('Makni pjesmu iz reda')
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((o) => o.setName('broj').setDescription('Broj pjesme u /queue').setRequired(true).setMinValue(1)),
  async execute(interaction) {
    const problem = memberCanControl(interaction.member);
    if (problem) return fail(interaction, problem);
    const track = control(interaction.guild.id, 'remove', interaction.options.getInteger('broj', true) - 1);
    return reply(interaction, `🗑️ Maknuto: **${track.title}**`, { ephemeral: false });
  },
};

export const commands = [
  playCommand,
  simple('skip', 'Preskoči pjesmu', 'skip', '⏭️ Preskočeno.'),
  simple('stop', 'Zaustavi glazbu, očisti red i izađi iz kanala', 'stop', '⏹️ Glazba zaustavljena.'),
  simple('pause', 'Pauziraj glazbu', 'pause', '⏸️ Pauzirano.'),
  simple('resume', 'Nastavi glazbu', 'resume', '▶️ Nastavljeno.'),
  simple('shuffle', 'Izmiješaj red', 'shuffle', '🔀 Red izmiješan.'),
  queueCommand,
  loopCommand,
  removeCommand,
];

