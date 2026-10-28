// Music player: yt-dlp finds/streams the audio, ffmpeg turns it into Ogg Opus, @discordjs/voice plays it.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} from '@discordjs/voice';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import ffmpegStatic from 'ffmpeg-static';
import { dataDir } from '../db.js';
import { UserError, fail } from '../utils/helpers.js';
import { logActivity } from './activity.js';

const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg';
let YTDLP = process.env.YTDLP_PATH || null;
let ytdlpPromise = null;
const MAX_PLAYLIST = 100;
const MAX_QUEUE = 500;
const IDLE_LEAVE = 2 * 60 * 1000; // leave when nothing is playing for 2 min
const ALONE_LEAVE = 60 * 1000; // leave when nobody is listening for 1 min
const COLOR_MUSIC = 0x1db954;

const queues = new Map(); // guildId -> GuildQueue

export const LOOP_LABELS = { off: 'isključeno', track: 'pjesma', queue: 'red' };

function run(bin, args, timeout = 30_000) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeout);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) =>
      reject(e.code === 'ENOENT' ? new UserError(`Na serveru nije instaliran \`${bin}\` (potreban za glazbu).`) : e),
    );
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(err.trim().split('\n').pop() || `${bin} exited with ${code}`));
    });
  });
}

const YTDLP_RELEASES = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
const YTDLP_ASSETS = {
  'linux-x64': 'yt-dlp_linux',
  'linux-arm64': 'yt-dlp_linux_aarch64',
  'darwin-x64': 'yt-dlp_macos',
  'darwin-arm64': 'yt-dlp_macos',
  'win32-x64': 'yt-dlp.exe',
};

// Finds yt-dlp: YTDLP_PATH, then one installed on the system, otherwise downloads the standalone
// binary into data/bin (works on hosts like Pterodactyl where nothing can be installed).
export function ensureYtDlp() {
  ytdlpPromise ??= (async () => {
    if (YTDLP) return YTDLP;
    try {
      await run('yt-dlp', ['--version'], 10_000);
      return (YTDLP = 'yt-dlp');
    } catch {
      // not installed
    }
    const asset = YTDLP_ASSETS[`${process.platform}-${process.arch}`];
    if (!asset) throw new UserError('yt-dlp nije instaliran, a za ovaj sistem ga ne mogu sam preuzeti.');
    const file = path.join(dataDir(), 'bin', asset);
    if (!fs.existsSync(file)) {
      console.log(`[music] Preuzimam ${asset}...`);
      const res = await fetch(YTDLP_RELEASES + asset);
      if (!res.ok) throw new Error(`yt-dlp download ${res.status}`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(`${file}.tmp`, Buffer.from(await res.arrayBuffer()), { mode: 0o755 });
      fs.renameSync(`${file}.tmp`, file);
    } else {
      // YouTube changes often; keep our own copy up to date
      run(file, ['-U'], 120_000).catch((err) => console.warn('[music] yt-dlp update', err.message));
    }
    return (YTDLP = file);
  })().catch((err) => {
    ytdlpPromise = null;
    if (err instanceof UserError) throw err;
    console.error('[music] yt-dlp', err);
    throw new UserError('Ne mogu pripremiti yt-dlp (potreban za glazbu). Pokušaj ponovno kasnije.');
  });
  return ytdlpPromise;
}

export function formatDuration(ms) {
  if (ms == null) return 'uživo';
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

function toTrack(entry, requestedBy) {
  const id = entry.id;
  const url =
    entry.webpage_url ??
    (entry.url?.startsWith('http') ? entry.url : null) ??
    (entry.ie_key === 'Youtube' && id ? `https://www.youtube.com/watch?v=${id}` : null);
  if (!url) return null;
  return {
    title: entry.title ?? 'Nepoznata pjesma',
    url,
    durationMs: entry.duration ? Math.round(entry.duration * 1000) : null,
    thumbnail: entry.thumbnail ?? entry.thumbnails?.at(-1)?.url ?? (entry.ie_key === 'Youtube' && id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null),
    requestedBy,
  };
}

// A YouTube "Mix" (list=RD...) is endless auto-generated radio, so only the video itself is added.
function stripMixPlaylist(query) {
  try {
    const url = new URL(query);
    if (url.searchParams.get('v') && url.searchParams.get('list')?.startsWith('RD')) {
      url.searchParams.delete('list');
      url.searchParams.delete('index');
      url.searchParams.delete('start_radio');
      return url.toString();
    }
  } catch {
    // not a URL
  }
  return query;
}

// Search text or URL (video, playlist, SoundCloud, ...) -> list of tracks.
export async function resolveTracks(query, requestedBy) {
  query = stripMixPlaylist(query.trim());
  const isUrl = /^https?:\/\//i.test(query);
  await ensureYtDlp();
  let out;
  try {
    out = await run(YTDLP, [
      '-J',
      '--flat-playlist',
      '--no-warnings',
      '--playlist-end',
      String(MAX_PLAYLIST),
      isUrl ? query : `ytsearch1:${query}`,
    ]);
  } catch (err) {
    if (err instanceof UserError) throw err;
    console.warn('[music] resolve', err.message);
    throw new UserError('Ne mogu pronaći tu pjesmu ili link.');
  }
  const info = JSON.parse(out);
  const entries = info.entries ?? [info];
  const tracks = entries.filter(Boolean).map((e) => toTrack(e, requestedBy)).filter(Boolean);
  if (!tracks.length) throw new UserError('Nema rezultata za to.');
  return { tracks, playlistTitle: isUrl && info._type === 'playlist' ? info.title : null };
}

class GuildQueue {
  constructor(guild, voiceChannel, textChannel) {
    this.guild = guild;
    this.voiceChannelId = voiceChannel.id;
    this.textChannel = textChannel;
    this.tracks = [];
    this.current = null;
    this.loop = 'off';
    this.processes = [];
    this.npMessage = null;
    this.leaveTimer = null;
    this.startedAt = 0;
    this.pausedAt = 0;
    this.pausedTotal = 0;

    this.player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    this.player.on(AudioPlayerStatus.Idle, () => {
      const skipping = this.skipping;
      this.skipping = false;
      this.next({ skipping }).catch((err) => console.error('[music]', err));
    });
    this.player.on('error', (err) => console.warn('[music] player', err.message));

    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    this.connection.subscribe(this.player);
    this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        // moved to another channel / short network hiccup
        await Promise.race([
          entersState(this.connection, VoiceConnectionStatus.Signalling, 5000),
          entersState(this.connection, VoiceConnectionStatus.Connecting, 5000),
        ]);
      } catch {
        this.destroy();
      }
    });
    this.connection.on(VoiceConnectionStatus.Destroyed, () => this.destroy());
  }

  get voiceChannel() {
    return this.guild.channels.cache.get(this.guild.members.me?.voice.channelId ?? this.voiceChannelId) ?? null;
  }

  get paused() {
    return this.player.state.status === AudioPlayerStatus.Paused || this.player.state.status === AudioPlayerStatus.AutoPaused;
  }

  get positionMs() {
    if (!this.current || !this.startedAt) return 0;
    const pausedNow = this.pausedAt ? Date.now() - this.pausedAt : 0;
    return Math.max(0, Date.now() - this.startedAt - this.pausedTotal - pausedNow);
  }

  async ready() {
    await entersState(this.connection, VoiceConnectionStatus.Ready, 20_000);
  }

  killProcesses() {
    for (const p of this.processes) p.kill('SIGKILL');
    this.processes = [];
  }

  createResource(track) {
    const ytdlp = spawn(YTDLP, ['-f', 'bestaudio/best', '-o', '-', '--quiet', '--no-warnings', '--no-playlist', track.url], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const ffmpeg = spawn(
      FFMPEG,
      ['-loglevel', 'error', '-i', 'pipe:0', '-vn', '-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-f', 'ogg', 'pipe:1'],
      { stdio: ['pipe', 'pipe', 'ignore'] },
    );
    let stderr = '';
    ytdlp.stderr.on('data', (d) => (stderr += d));
    ytdlp.stdout.pipe(ffmpeg.stdin);
    for (const stream of [ytdlp.stdout, ffmpeg.stdin, ffmpeg.stdout]) stream.on('error', () => {});
    for (const p of [ytdlp, ffmpeg]) p.on('error', (err) => console.warn('[music] spawn', err.message));
    ytdlp.on('close', (code, signal) => {
      if (code && !signal) {
        track.failed = true;
        console.warn('[music] yt-dlp', stderr.trim().split('\n').pop());
        this.textChannel?.send({ embeds: [musicEmbed(`❌ Ne mogu pustiti **${escapeMd(track.title)}**, preskačem.`)] }).catch(() => {});
      }
    });
    this.processes = [ytdlp, ffmpeg];
    return createAudioResource(ffmpeg.stdout, { inputType: StreamType.OggOpus, metadata: track });
  }

  async next({ skipping = false } = {}) {
    // a track that failed to load is never looped (otherwise loop=track would retry it forever)
    if (this.current && !this.current.failed && !(skipping && this.loop === 'track')) {
      if (this.loop === 'track') this.tracks.unshift(this.current);
      else if (this.loop === 'queue') this.tracks.push(this.current);
    }
    this.killProcesses();
    const track = this.tracks.shift() ?? null;
    this.current = track;
    await this.disableOldControls();

    if (!track) {
      this.startedAt = 0;
      this.scheduleLeave(IDLE_LEAVE);
      return;
    }
    this.cancelLeave();
    this.startedAt = Date.now();
    this.pausedAt = 0;
    this.pausedTotal = 0;
    this.player.play(this.createResource(track));
    if (this.textChannel) {
      this.npMessage = await this.textChannel.send(nowPlayingPayload(this)).catch(() => null);
    }
  }

  async disableOldControls() {
    const old = this.npMessage;
    this.npMessage = null;
    if (old) await old.edit({ components: [] }).catch(() => {});
  }

  async refreshControls() {
    if (this.npMessage) await this.npMessage.edit(nowPlayingPayload(this)).catch(() => {});
  }

  pause() {
    if (!this.current || this.paused) return false;
    this.player.pause();
    this.pausedAt = Date.now();
    return true;
  }

  resume() {
    if (!this.current || !this.paused) return false;
    this.player.unpause();
    if (this.pausedAt) this.pausedTotal += Date.now() - this.pausedAt;
    this.pausedAt = 0;
    return true;
  }

  skip() {
    if (!this.current) return false;
    // stop() makes the player go Idle -> next(); the flag makes loop=track move on instead of repeating
    this.skipping = true;
    this.player.stop(true);
    return true;
  }

  shuffle() {
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }
  }

  scheduleLeave(ms, reason = 'ništa ne svira') {
    this.cancelLeave();
    this.leaveTimer = setTimeout(() => {
      this.textChannel?.send({ embeds: [musicEmbed(`👋 Izlazim iz voice kanala jer ${reason}.`)] }).catch(() => {});
      this.destroy();
    }, ms);
  }

  cancelLeave() {
    clearTimeout(this.leaveTimer);
    this.leaveTimer = null;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelLeave();
    this.tracks = [];
    this.current = null;
    this.killProcesses();
    this.player.removeAllListeners();
    this.player.stop(true);
    this.disableOldControls();
    if (this.connection.state.status !== VoiceConnectionStatus.Destroyed) this.connection.destroy();
    if (queues.get(this.guild.id) === this) queues.delete(this.guild.id);
  }
}

const escapeMd = (text) => text.replace(/([*_`~|\\[\]])/g, '\\$1');

function musicEmbed(text) {
  return new EmbedBuilder().setColor(COLOR_MUSIC).setDescription(text);
}

export function nowPlayingPayload(queue) {
  const t = queue.current;
  const embed = new EmbedBuilder()
    .setColor(COLOR_MUSIC)
    .setAuthor({ name: 'Sada svira' })
    .setTitle(t.title.slice(0, 256))
    .setURL(t.url)
    .addFields(
      { name: 'Trajanje', value: formatDuration(t.durationMs), inline: true },
      { name: 'Pustio/la', value: `<@${t.requestedBy.id}>`, inline: true },
      { name: 'U redu', value: String(queue.tracks.length), inline: true },
    );
  if (t.thumbnail) embed.setThumbnail(t.thumbnail);
  if (queue.loop !== 'off') embed.setFooter({ text: `Ponavljanje: ${LOOP_LABELS[queue.loop]}` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('music:toggle').setEmoji(queue.paused ? '▶️' : '⏸️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music:skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music:stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('music:loop').setEmoji('🔁').setStyle(queue.loop === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success),
    new ButtonBuilder().setCustomId('music:shuffle').setEmoji('🔀').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row], allowedMentions: { parse: [] } };
}

export function getQueue(guildId) {
  return queues.get(guildId) ?? null;
}

// Adds query to the queue (joining voiceChannel if needed). Used by /play and the dashboard.
export async function play({ guild, voiceChannel, textChannel, query, requestedBy }) {
  let queue = getQueue(guild.id);
  if (queue && voiceChannel && queue.voiceChannel && queue.voiceChannel.id !== voiceChannel.id) {
    throw new UserError(`Već sviram u kanalu ${queue.voiceChannel}. Uđi tamo ili zaustavi glazbu.`);
  }
  if (!queue && !voiceChannel) throw new UserError('Odaberi voice kanal.');
  if (!queue) {
    const me = guild.members.me;
    const perms = voiceChannel.permissionsFor(me);
    if (!perms?.has(['ViewChannel', 'Connect', 'Speak'])) {
      throw new UserError(`Nemam permisiju za ulazak ili govor u ${voiceChannel}.`);
    }
  }

  const { tracks, playlistTitle } = await resolveTracks(query, requestedBy);

  queue = getQueue(guild.id);
  if (!queue) {
    queue = new GuildQueue(guild, voiceChannel, textChannel);
    queues.set(guild.id, queue);
    try {
      await queue.ready();
    } catch {
      queue.destroy();
      throw new UserError('Ne mogu se spojiti na voice kanal. Pokušaj ponovno.');
    }
  } else if (textChannel) {
    queue.textChannel = textChannel;
  }

  const room = MAX_QUEUE - queue.tracks.length;
  if (room <= 0) throw new UserError(`Red je pun (max ${MAX_QUEUE} pjesama).`);
  const added = tracks.slice(0, room);
  queue.tracks.push(...added);
  logActivity(guild.id, 'music', `${requestedBy.name} je dodao/la ${playlistTitle ? `playlistu ${playlistTitle}` : added[0].title}`);

  if (!queue.current) await queue.next();
  else await queue.refreshControls();
  return { queue, added, playlistTitle };
}

export function snapshot(guildId) {
  const q = getQueue(guildId);
  if (!q) return { connected: false, voiceChannel: null, paused: false, loop: 'off', current: null, positionMs: 0, queue: [] };
  const vc = q.voiceChannel;
  return {
    connected: true,
    voiceChannel: vc ? { id: vc.id, name: vc.name } : null,
    paused: q.paused,
    loop: q.loop,
    current: q.current,
    positionMs: q.positionMs,
    queue: q.tracks,
  };
}

// Controls shared by slash commands, buttons and the dashboard. Throw UserError when not possible.
export function control(guildId, action, arg) {
  const q = getQueue(guildId);
  if (!q) throw new UserError('Trenutno ništa ne svira.');
  switch (action) {
    case 'pause':
      if (!q.pause()) throw new UserError('Glazba je već pauzirana.');
      break;
    case 'resume':
      if (!q.resume()) throw new UserError('Glazba nije pauzirana.');
      break;
    case 'toggle':
      if (!q.pause()) q.resume();
      break;
    case 'skip':
      if (!q.skip()) throw new UserError('Nema što preskočiti.');
      return;
    case 'stop':
      q.destroy();
      return;
    case 'shuffle':
      if (q.tracks.length < 2) throw new UserError('U redu nema dovoljno pjesama za miješanje.');
      q.shuffle();
      break;
    case 'loop':
      if (!LOOP_LABELS[arg]) throw new UserError('Nepoznat način ponavljanja.');
      q.loop = arg;
      break;
    case 'cycleLoop':
      q.loop = { off: 'queue', queue: 'track', track: 'off' }[q.loop];
      break;
    case 'remove': {
      if (!Number.isInteger(arg) || arg < 0 || arg >= q.tracks.length) throw new UserError('Nema pjesme na tom mjestu u redu.');
      return q.tracks.splice(arg, 1)[0];
    }
    default:
      throw new UserError('Nepoznata akcija.');
  }
  q.refreshControls();
}

// The member must be in the same voice channel as the bot to control it from Discord.
export function memberCanControl(member) {
  const q = getQueue(member.guild.id);
  if (!q) return 'Trenutno ništa ne svira.';
  if (member.voice.channelId !== q.voiceChannel?.id) return `Moraš biti u ${q.voiceChannel ?? 'istom voice kanalu'} da upravljaš glazbom.`;
  return null;
}

export async function handleComponent(interaction) {
  const action = interaction.customId.split(':')[1];
  const problem = memberCanControl(interaction.member);
  if (problem) return fail(interaction, problem);
  try {
    control(interaction.guild.id, action === 'loop' ? 'cycleLoop' : action);
  } catch (err) {
    if (err instanceof UserError) return fail(interaction, err.message);
    throw err;
  }
  const q = getQueue(interaction.guild.id);
  if (q?.current && interaction.message.id === q.npMessage?.id) return interaction.update(nowPlayingPayload(q));
  return interaction.deferUpdate();
}

// Leave when everyone else left the voice channel, come back to normal when someone joins.
export function onVoiceStateUpdate(oldState, newState) {
  const q = getQueue((newState ?? oldState).guild.id);
  if (!q) return;
  const channel = q.voiceChannel;
  if (!channel) return;
  const listeners = channel.members.filter((m) => !m.user.bot).size;
  if (listeners === 0) q.scheduleLeave(ALONE_LEAVE, 'nitko ne sluša');
  else if (q.current) q.cancelLeave();
}
