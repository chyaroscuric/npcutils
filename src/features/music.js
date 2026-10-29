// Music player: yt-dlp finds/streams the audio, ffmpeg turns it into Ogg Opus, @discordjs/voice plays it.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import zlib from 'node:zlib';
import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  generateDependencyReport,
  joinVoiceChannel,
} from '@discordjs/voice';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import ffmpegStatic from 'ffmpeg-static';
import { dataDir } from '../db.js';
import { extractZip } from '../utils/zip.js';
import { UserError, fail } from '../utils/helpers.js';
import { logActivity } from './activity.js';

let FFMPEG = null;
let ffmpegPromise = null;
let YTDLP = null;
let YTDLP_EXTRA_ARGS = [];
let ytdlpPromise = null;
const MAX_PLAYLIST = 100;
const MAX_QUEUE = 500;
const IDLE_LEAVE = 2 * 60 * 1000; // leave when nothing is playing for 2 min
const ALONE_LEAVE = 60 * 1000; // leave when nobody is listening for 1 min
const COLOR_MUSIC = 0x1db954;

const queues = new Map(); // guildId -> GuildQueue

export const LOOP_LABELS = { off: 'isključeno', track: 'pjesma', queue: 'red' };

// yt-dlp release binaries unpack themselves (~100 MB) into TMPDIR on every run. /tmp on hosting
// panels is often a small tmpfs, so use a folder next to the database instead.
let tmpReady = false;
function childEnv() {
  const tmp = path.join(dataDir(), 'tmp');
  if (!tmpReady) {
    fs.mkdirSync(tmp, { recursive: true });
    // leftovers of yt-dlp processes that were killed (skip/stop/restart)
    for (const name of fs.readdirSync(tmp)) {
      if (name.startsWith('_MEI')) fs.rmSync(path.join(tmp, name), { recursive: true, force: true });
    }
    tmpReady = true;
  }
  // XDG_CACHE_HOME: yt-dlp caches YouTube's player code there, which saves time on every song
  return { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, XDG_CACHE_HOME: path.join(dataDir(), 'cache') };
}

// SIGTERM lets yt-dlp's launcher delete what it unpacked; SIGKILL only if it does not exit.
function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  setTimeout(() => child.exitCode === null && child.signalCode === null && child.kill('SIGKILL'), 5000).unref();
}

function run(bin, args, timeout = 30_000, { allowPartial = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv() });
    let out = '';
    let err = '';
    const timer = setTimeout(() => stopProcess(child), timeout);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e.code === 'ENOENT' ? new Error(`${bin} ne postoji`) : e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      // with --ignore-errors yt-dlp exits 1 when some results failed but still prints the rest
      if (code === 0 || (allowPartial && out.trim())) resolve(out);
      else reject(new Error(lastErrorLine(err) || `${path.basename(bin)} exited with ${code}`));
    });
  });
}

const lastErrorLine = (stderr) =>
  stderr
    .trim()
    .split('\n')
    .filter((l) => !l.startsWith('WARNING'))
    .pop() ?? '';

// Turns a yt-dlp error into something the user can act on.
function explainYtdlpError(message) {
  if (/confirm you.re not a bot|Sign in to confirm/i.test(message)) {
    return 'YouTube blokira IP adresu hostinga ("potvrdi da nisi bot"). Probaj SoundCloud link ili pokreni bota na drugom serveru.';
  }
  if (/private video|video (is )?unavailable|not available/i.test(message)) return 'Taj video nije dostupan (privatan, obrisan ili blokiran).';
  if (/age/i.test(message) && /restrict|confirm your age/i.test(message)) return 'Video je dobno ograničen i ne mogu ga pustiti.';
  if (/Unsupported URL/i.test(message)) return 'Taj link nije podržan.';
  return null;
}

const binDir = () => path.join(dataDir(), 'bin');
const EXE = process.platform === 'win32' ? '.exe' : '';

async function download(url, file, { gunzip = false } = {}) {
  console.log(`[music] Preuzimam ${path.basename(file)}...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status} (${url})`);
  let data = Buffer.from(await res.arrayBuffer());
  if (gunzip) data = zlib.gunzipSync(data);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, data, { mode: 0o755 });
  fs.renameSync(`${file}.tmp`, file);
}

// Tries candidate binaries in order and keeps the first one that runs.
async function firstWorking(name, candidates, versionArgs, parseVersion) {
  for (const candidate of candidates) {
    try {
      const bin = typeof candidate === 'function' ? await candidate() : candidate;
      if (!bin) continue;
      const version = parseVersion((await run(bin, versionArgs, 120_000)).trim());
      return { bin, version };
    } catch (err) {
      console.warn(`[music] ${name}: ${err.message}`);
    }
  }
  throw new UserError(`${name} ne radi na ovom serveru, pa glazba ne može raditi (pogledaj konzolu bota).`);
}

// ffmpeg: FFMPEG_PATH, ffmpeg-static (if its install script managed to download it), our own copy
// in data/bin (downloaded from the same place ffmpeg-static uses), or a system ffmpeg.
export function ensureFfmpeg() {
  ffmpegPromise ??= firstWorking(
    'ffmpeg',
    [
      process.env.FFMPEG_PATH,
      ffmpegStatic && fs.existsSync(ffmpegStatic) ? ffmpegStatic : null,
      async () => {
        const file = path.join(binDir(), `ffmpeg${EXE}`);
        if (!fs.existsSync(file)) {
          const pkg = JSON.parse(fs.readFileSync(createRequire(import.meta.url).resolve('ffmpeg-static/package.json')));
          const release = pkg['ffmpeg-static']['binary-release-tag'];
          await download(
            `https://github.com/eugeneware/ffmpeg-static/releases/download/${release}/ffmpeg-${process.platform}-${process.arch}.gz`,
            file,
            { gunzip: true },
          );
        }
        return file;
      },
      'ffmpeg',
    ],
    ['-hide_banner', '-version'],
    (out) => out.split('\n')[0].split(' ')[2] ?? '?',
  )
    .then(({ bin, version }) => ((FFMPEG = bin), { bin, version }))
    .catch((err) => {
      ffmpegPromise = null;
      throw err;
    });
  return ffmpegPromise;
}

const YTDLP_RELEASES = 'https://github.com/yt-dlp/yt-dlp/releases';
// "onedir" builds start instantly; the single-file builds unpack ~100 MB on every run,
// which made every song slow to start on small hosts.
const YTDLP_ONEDIR = { 'linux-x64': 'yt-dlp_linux', 'linux-arm64': 'yt-dlp_linux_aarch64' };
const YTDLP_ONEFILE = { 'darwin-x64': 'yt-dlp_macos', 'darwin-arm64': 'yt-dlp_macos', 'win32-x64': 'yt-dlp.exe' };

async function latestYtDlpTag() {
  const res = await fetch(`${YTDLP_RELEASES}/latest`, { redirect: 'manual' });
  return res.headers.get('location')?.split('/tag/')[1] ?? null;
}

// Installs/updates our own yt-dlp in data/bin and returns the path of the executable.
async function installYtDlp() {
  const platform = `${process.platform}-${process.arch}`;
  const onefile = YTDLP_ONEFILE[platform];
  if (onefile) {
    const file = path.join(binDir(), onefile);
    if (!fs.existsSync(file)) await download(`${YTDLP_RELEASES}/latest/download/${onefile}`, file);
    else await run(file, ['-U'], 120_000).catch((err) => console.warn('[music] yt-dlp update:', err.message));
    return file;
  }
  const name = YTDLP_ONEDIR[platform];
  if (!name) return null;
  const dir = path.join(binDir(), 'yt-dlp');
  const exe = path.join(dir, name);
  const versionFile = path.join(dir, 'release.txt');
  const installed = fs.existsSync(exe) && fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8').trim() : null;
  const latest = await latestYtDlpTag().catch(() => null);
  if (installed && (!latest || latest === installed)) return exe;

  console.log(`[music] Preuzimam yt-dlp ${latest ?? ''}...`);
  const res = await fetch(`${YTDLP_RELEASES}/latest/download/${name}.zip`);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const fresh = `${dir}.new`;
  fs.rmSync(fresh, { recursive: true, force: true });
  extractZip(Buffer.from(await res.arrayBuffer()), fresh);
  fs.chmodSync(path.join(fresh, name), 0o755);
  fs.writeFileSync(path.join(fresh, 'release.txt'), latest ?? 'unknown');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(fresh, dir);
  // the old single-file download is not needed any more
  fs.rmSync(path.join(binDir(), name), { force: true });
  return exe;
}

// yt-dlp: YTDLP_PATH, our own up-to-date copy in data/bin (downloaded automatically, so it works on
// hosts like Pterodactyl where nothing can be installed), or one installed on the system.
export function ensureYtDlp() {
  ytdlpPromise ??= firstWorking('yt-dlp', [process.env.YTDLP_PATH, installYtDlp, 'yt-dlp'], ['--version'], (out) =>
    out.split('\n').pop(),
  )
    .then(({ bin, version }) => {
      YTDLP = bin;
      // Since 2025.11 YouTube needs a JS runtime to solve its challenges; Node is always here.
      YTDLP_EXTRA_ARGS = version >= '2025.11.12' ? ['--js-runtimes', `node:${process.execPath}`, '--remote-components', 'ejs:github'] : [];
      return { bin, version };
    })
    .catch((err) => {
      ytdlpPromise = null;
      throw err;
    });
  return ytdlpPromise;
}

// YouTube updates break yt-dlp regularly, so look for a new version once a day.
setInterval(() => {
  if (!process.env.YTDLP_PATH && YTDLP?.startsWith(binDir())) installYtDlp().catch((err) => console.warn('[music] yt-dlp update:', err.message));
}, 24 * 60 * 60 * 1000).unref();

// Logged at startup so problems show up in the console before anyone uses /play.
export async function checkSetup() {
  try {
    const [yt, ff] = await Promise.all([ensureYtDlp(), ensureFfmpeg()]);
    console.log(`🎵 Glazba spremna (yt-dlp ${yt.version}, ffmpeg ${ff.version})`);
  } catch (err) {
    console.error('🎵 Glazba NE radi:', err.message);
  }
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
    stream: streamInfo(entry),
  };
}

// Direct audio URL from a full yt-dlp extraction (-f bestaudio), so playback does not need a second
// yt-dlp run. Only plain HTTP(S) formats; HLS etc. are left to the yt-dlp pipe.
function streamInfo(entry) {
  if (!entry.url || !['https', 'http'].includes(entry.protocol) || entry.requested_formats) return null;
  let expiresAt = Date.now() + 60 * 60 * 1000;
  try {
    const expire = Number(new URL(entry.url).searchParams.get('expire'));
    if (expire) expiresAt = expire * 1000;
  } catch {
    return null;
  }
  return { url: entry.url, headers: entry.http_headers ?? {}, acodec: entry.acodec ?? null, expiresAt };
}

const usableStream = (track, marginMs = 60_000) =>
  track.stream && !track.streamFailed && track.stream.expiresAt - Date.now() > marginMs ? track.stream : null;

// When YouTube refuses a video, look for the same song on SoundCloud instead.
export async function soundCloudFallback(track) {
  const title = track.title
    .replace(/[([][^)\]]*(official|video|audio|lyrics?|4k|hd|remaster|visuali[sz]er)[^)\]]*[)\]]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  const out = await run(YTDLP, [...YTDLP_EXTRA_ARGS, '-J', '-f', 'bestaudio/best', '--ignore-errors', '--no-warnings', `scsearch5:${title}`], 60_000, { allowPartial: true });
  const entries = (JSON.parse(out).entries ?? []).filter(Boolean);
  // same song = similar length (avoids 30 s previews and unrelated results)
  const match = entries.find((e) => !track.durationMs || !e.duration || Math.abs(e.duration * 1000 - track.durationMs) < track.durationMs * 0.2);
  const alt = match && toTrack(match, track.requestedBy);
  if (alt) alt.fallback = true;
  return alt;
}

async function fetchStream(url) {
  const out = await run(YTDLP, [...YTDLP_EXTRA_ARGS, '-J', '-f', 'bestaudio/best', '--no-warnings', '--no-playlist', url], 60_000);
  return streamInfo(JSON.parse(out));
}

// Downloads the audio in 10 MB ranges (like yt-dlp does, YouTube throttles single huge requests)
// and writes it into ffmpeg. Retries a failed range a few times so a network hiccup does not end the song.
const CHUNK = 10 * 1024 * 1024;
async function pumpHttp(stream, dest, signal, progress) {
  let total = Infinity;
  let failures = 0;
  while (progress.bytes < total) {
    try {
      const res = await fetch(stream.url, {
        headers: { ...stream.headers, Range: `bytes=${progress.bytes}-${progress.bytes + CHUNK - 1}` },
        signal,
      });
      if (res.status === 416) break;
      if (res.status !== 206 && res.status !== 200) throw new Error(`HTTP ${res.status}`);
      total = Number(res.headers.get('content-range')?.split('/')[1]) || Infinity;
      const before = progress.bytes;
      await pipeline(
        Readable.fromWeb(res.body),
        async function* (source) {
          for await (const chunk of source) {
            progress.bytes += chunk.length;
            yield chunk;
          }
        },
        dest,
        { end: false, signal },
      );
      if (res.status === 200 || progress.bytes === before) break;
      failures = 0;
    } catch (err) {
      if (signal.aborted || dest.destroyed || ++failures > 3) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  dest.end();
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
  await Promise.all([ensureYtDlp(), ensureFfmpeg()]);
  let out;
  try {
    out = await run(YTDLP, [
      ...YTDLP_EXTRA_ARGS,
      '-J',
      '-f',
      'bestaudio/best',
      // a search needs the full extraction to get the audio URL; playlists stay flat (fast)
      ...(isUrl ? ['--flat-playlist'] : []),
      '--no-warnings',
      '--playlist-end',
      String(MAX_PLAYLIST),
      isUrl ? query : `ytsearch1:${query}`,
    ]);
  } catch (err) {
    if (err instanceof UserError) throw err;
    console.warn('[music] resolve:', err.message);
    throw new UserError(explainYtdlpError(err.message) ?? 'Ne mogu pronaći tu pjesmu ili link.');
  }
  const info = JSON.parse(out);
  const entries = info.entries ?? [info];
  const tracks = entries.filter(Boolean).map((e) => toTrack(e, requestedBy)).filter(Boolean);
  if (!tracks.length) throw new UserError('Nema rezultata za to.');
  return { tracks, playlistTitle: isUrl && info._type === 'playlist' ? info.title : null };
}

export class GuildQueue {
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
    this.player.on('error', (err) => console.warn('[music] player:', err.message));

    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    this.connection.subscribe(this.player);
    this.connection.on('error', (err) => console.warn('[music] voice:', err.message));
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
    this.abort?.abort();
    for (const p of this.processes) stopProcess(p);
    this.processes = [];
  }

  createResource(track) {
    const stream = usableStream(track);
    // YouTube's audio is usually Opus already: just repackage it, re-encoding costs a lot of CPU on small hosts
    const opus = (stream?.acodec ?? track.stream?.acodec) === 'opus';
    const ffmpeg = spawn(
      FFMPEG,
      [
        '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-map', '0:a:0',
        ...(opus ? ['-c:a', 'copy'] : ['-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '2']),
        '-f', 'ogg', 'pipe:1',
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const abort = new AbortController();
    this.abort = abort;
    this.processes = [ffmpeg];
    let ffmpegErr = '';
    ffmpeg.stderr.on('data', (d) => (ffmpegErr += d));
    ffmpeg.on('close', (code, signal) => {
      if (code && !signal && !abort.signal.aborted) console.warn('[music] ffmpeg:', lastErrorLine(ffmpegErr) || `exit ${code}`);
    });
    for (const s of [ffmpeg.stdin, ffmpeg.stdout]) s.on('error', () => {});
    ffmpeg.on('error', (err) => console.warn('[music] spawn', err.message));

    if (stream) {
      const progress = { bytes: 0 };
      const { signal } = abort;
      pumpHttp(stream, ffmpeg.stdin, signal, progress).catch((err) => {
        if (signal.aborted) return;
        console.warn('[music] stream:', err.message);
        // nothing arrived (expired / blocked URL): next() retries the song through yt-dlp
        if (progress.bytes === 0) track.streamFailed = true;
        ffmpeg.stdin.destroy();
      });
    } else {
      const ytdlp = spawn(
        YTDLP,
        [...YTDLP_EXTRA_ARGS, '-f', 'bestaudio/best', '-o', '-', '--quiet', '--no-warnings', '--no-playlist', track.url],
        { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv() },
      );
      let stderr = '';
      ytdlp.stderr.on('data', (d) => (stderr += d));
      ytdlp.stdout.pipe(ffmpeg.stdin);
      ytdlp.stdout.on('error', () => {});
      ytdlp.on('error', (err) => console.warn('[music] spawn', err.message));
      ytdlp.on('close', (code, signal) => {
        if (code && !signal) {
          track.failed = true;
          const reason = lastErrorLine(stderr);
          track.error = reason;
          console.warn('[music] yt-dlp:', reason);
          const hint = explainYtdlpError(reason);
          // YouTube refusals are retried on SoundCloud first (see next()); only report other failures here
          if (/youtube\.com|youtu\.be/.test(track.url) && !track.fallback) return;
          this.textChannel
            ?.send({ embeds: [musicEmbed(`❌ Ne mogu pustiti **${escapeMd(track.title)}**, preskačem.${hint ? `\n${hint}` : ''}`)] })
            .catch(() => {});
        }
      });
      this.processes.push(ytdlp);
    }
    return createAudioResource(ffmpeg.stdout, { inputType: StreamType.OggOpus, metadata: track });
  }

  // Looks up the next song's audio URL while the current one plays, so the switch is instant.
  prefetch() {
    const track = this.tracks[0];
    if (!track || track.prefetching || usableStream(track, 10 * 60_000)) return;
    track.prefetching = true;
    fetchStream(track.url)
      .then((stream) => {
        track.stream = stream;
        track.streamFailed = false;
      })
      .catch((err) => console.warn('[music] prefetch:', err.message))
      .finally(() => (track.prefetching = false));
  }

  async next({ skipping = false } = {}) {
    const failed = this.current;
    if (failed?.failed && !failed.fallback && !skipping && /youtube\.com|youtu\.be/.test(failed.url)) {
      failed.fallback = true;
      const alt = await soundCloudFallback(failed).catch((err) => console.warn('[music] soundcloud:', err.message));
      if (alt) {
        this.tracks.unshift(alt);
        this.textChannel
          ?.send({ embeds: [musicEmbed(`⚠️ YouTube ne da **${escapeMd(failed.title)}**, puštam verziju sa SoundClouda: **${escapeMd(alt.title)}**`)] })
          .catch(() => {});
      } else {
        const hint = explainYtdlpError(failed.error ?? '');
        this.textChannel
          ?.send({ embeds: [musicEmbed(`❌ Ne mogu pustiti **${escapeMd(failed.title)}** (ni na SoundCloudu), preskačem.${hint ? `\n${hint}` : ''}`)] })
          .catch(() => {});
      }
    }
    const retry = this.current?.streamFailed && !this.current.retried && !skipping;
    if (retry) {
      // the direct URL did not work: play the same song again through yt-dlp
      this.current.retried = true;
      this.tracks.unshift(this.current);
    } else if (this.current && !this.current.failed && !(skipping && this.loop === 'track')) {
      // a track that failed to load is never looped (otherwise loop=track would retry it forever)
      if (this.loop === 'track') this.tracks.unshift(this.current);
      else if (this.loop === 'queue') this.tracks.push(this.current);
    }
    this.killProcesses();
    const track = this.tracks.shift() ?? null;
    this.current = track;
    // not awaited: editing the old Discord message must not delay the music
    this.disableOldControls();

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
    this.prefetch();
    if (this.textChannel && !retry) {
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
      console.error(`[music] Spajanje na voice nije uspjelo (stanje: ${queue.connection.state.status}).`);
      console.error(generateDependencyReport());
      queue.destroy();
      throw new UserError('Ne mogu se spojiti na voice kanal. Hosting možda blokira UDP promet (pogledaj konzolu bota).');
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
  else {
    queue.prefetch();
    await queue.refreshControls();
  }
  return { queue, added, playlistTitle };
}

const publicTrack = ({ title, url, durationMs, thumbnail, requestedBy }) => ({ title, url, durationMs, thumbnail, requestedBy });

export function snapshot(guildId) {
  const q = getQueue(guildId);
  if (!q) return { connected: false, voiceChannel: null, paused: false, loop: 'off', current: null, positionMs: 0, queue: [] };
  const vc = q.voiceChannel;
  return {
    connected: true,
    voiceChannel: vc ? { id: vc.id, name: vc.name } : null,
    paused: q.paused,
    loop: q.loop,
    current: q.current && publicTrack(q.current),
    positionMs: q.positionMs,
    queue: q.tracks.map(publicTrack),
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
      q.prefetch();
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
      const [removed] = q.tracks.splice(arg, 1);
      q.prefetch();
      return removed;
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
