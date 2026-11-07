// Starts one isolated Node process per BYOT bot.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { botsDir } from './store.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const PORT_START = Number(process.env.BOT_PORT_START) || 4100;
const MAX_LOG_LINES = 400;
const children = new Map(); // botId -> { child, port, status, startedAt, error, logs, token, stopRequested, restarts, timer }

function freePort(start) {
  return new Promise((resolve, reject) => {
    let port = start;
    const tryPort = () => {
      const srv = net.createServer();
      srv.once('error', () => { port += 1; tryPort(); });
      srv.once('listening', () => srv.close(() => resolve(port)));
      srv.listen(port, '127.0.0.1');
    };
    tryPort();
  });
}

function appendLog(entry, line) {
  const text = String(line).replace(/\r/g, '');
  for (const part of text.split('\n')) {
    if (!part) continue;
    entry.logs.push(part);
    if (entry.logs.length > MAX_LOG_LINES) entry.logs.shift();
    try {
      fs.appendFileSync(path.join(botsDir(entry.botId), 'bot.log'), `${part}\n`);
    } catch {
      // data dir may not exist yet
    }
  }
}

async function healthy(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1500) });
    const json = await res.json();
    return Boolean(json.online);
  } catch {
    return false;
  }
}

async function waitReady(entry, timeoutMs = 25_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (!entry.child || entry.child.exitCode !== null) return false;
    if (await healthy(entry.port)) return true;
    await new Promise((r) => setTimeout(r, 800));
  }
  return false;
}

function envFor(bot, token, port) {
  return {
    ...process.env,
    DISCORD_TOKEN: token,
    DATA_DIR: botsDir(bot.id),
    PORT: String(port),
    HOST: '127.0.0.1',
    MANAGER_SECRET: process.env.MANAGER_SECRET,
    DASHBOARD_URL: `${process.env.DASHBOARD_URL || 'http://localhost'}/b/${bot.id}`,
    CLIENT_SECRET: '',
    GUILD_ID: '',
    BOT_OWNER_ID: bot.ownerId || '',
    ROLE: 'bot',
  };
}

export async function start(bot, token) {
  const current = children.get(bot.id);
  if (current?.child && current.child.exitCode === null) return current;
  if (current?.timer) clearTimeout(current.timer);
  const port = await freePort(PORT_START);
  fs.mkdirSync(botsDir(bot.id), { recursive: true });
  const entry = {
    botId: bot.id,
    port,
    status: 'starting',
    startedAt: Date.now(),
    error: null,
    logs: current?.logs ?? [],
    token,
    stopRequested: false,
    restarts: current?.restarts ?? 0,
    child: null,
    timer: null,
  };
  children.set(bot.id, entry);
  const child = spawn(process.execPath, ['src/bot.js'], {
    cwd: ROOT,
    env: envFor(bot, token, port),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  entry.child = child;
  child.stdout.on('data', (d) => appendLog(entry, d.toString()));
  child.stderr.on('data', (d) => appendLog(entry, d.toString()));
  child.once('error', (err) => {
    entry.status = 'error';
    entry.error = err.message;
    appendLog(entry, `[manager] ${err.message}`);
  });
  child.once('exit', (code, signal) => {
    entry.status = entry.stopRequested ? 'stopped' : 'error';
    if (!entry.stopRequested) entry.error = `Proces je izašao (${signal || code}).`;
    entry.child = null;
    if (!entry.stopRequested && entry.restarts < 5) {
      entry.restarts += 1;
      entry.timer = setTimeout(() => {
        start(bot, entry.token).catch((err) => appendLog(entry, `[manager] restart: ${err.message}`));
      }, 5000);
      entry.timer.unref?.();
    }
  });
  const ready = await waitReady(entry);
  if (ready) {
    entry.status = 'running';
    entry.error = null;
  } else if (entry.child) {
    entry.status = 'error';
    entry.error = 'Bot se nije javio u vremenu. Provjeri log.';
  }
  return entry;
}

export async function stop(botId) {
  const entry = children.get(botId);
  if (!entry?.child) return false;
  entry.stopRequested = true;
  if (entry.timer) clearTimeout(entry.timer);
  if (entry.child.exitCode !== null) {
    entry.status = 'stopped';
    entry.child = null;
    return true;
  }
  entry.child.kill('SIGTERM');
  await new Promise((resolve) => {
    const t = setTimeout(() => {
      entry.child?.kill('SIGKILL');
      resolve();
    }, 10_000);
    entry.child.once('exit', () => { clearTimeout(t); resolve(); });
  });
  entry.status = 'stopped';
  entry.child = null;
  return true;
}

export async function restart(bot, token) {
  await stop(bot.id);
  const entry = children.get(bot.id);
  if (entry) entry.restarts = 0;
  return start(bot, token);
}

export function status(botId) {
  const e = children.get(botId);
  if (!e) return { running: false, status: 'stopped', port: null, startedAt: null, error: null };
  return {
    running: Boolean(e.child && e.child.exitCode === null),
    status: e.status,
    port: e.port,
    startedAt: e.startedAt,
    error: e.error,
    pid: e.child?.pid ?? null,
  };
}

export const logs = (botId) => children.get(botId)?.logs ?? [];
export const portOf = (botId) => children.get(botId)?.port ?? null;

export async function stopAll() {
  for (const id of [...children.keys()]) await stop(id).catch(() => {});
}
