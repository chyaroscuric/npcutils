// BYOT manager: Discord login, bot registry, one isolated bot process per token,
// and a reverse proxy that serves each bot's normal dashboard under /b/<botId>/.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

try {
  process.loadEnvFile();
} catch {
  // no .env file
}

// Load these after .env, because they read DATA_DIR / BOT_PORT_START at import time.
const store = await import('./store.js');
const bots = await import('./bots.js');

const PORT = Number(process.env.PORT) || 3000;
const CLIENT_ID = process.env.CLIENT_ID || '';
const CLIENT_SECRET = process.env.CLIENT_SECRET || '';
const BASE_URL = (process.env.DASHBOARD_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SECURE = BASE_URL.startsWith('https://');
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const sessions = new Map();
process.env.MANAGER_SECRET ||= crypto.randomBytes(32).toString('hex');
process.env.DASHBOARD_URL = BASE_URL;

const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const DASHBOARD_CSS = fileURLToPath(new URL('../dashboard/public/app.css', import.meta.url));

store.load();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
// Only manager API routes are JSON. /b/:id/* is proxied and must keep its raw body.
app.use('/api', express.json({ limit: '100kb' }));

const cookies = (header = '') =>
  Object.fromEntries(
    header
      .split(';')
      .map((c) => c.trim().split('='))
      .filter(([k, v]) => k && v !== undefined)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );

const setCookie = (res, name, value, maxAgeMs) => {
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${SECURE ? '; Secure' : ''}`);
};

const sessionOf = (req) => {
  const sid = cookies(req.headers.cookie).sid;
  const session = sid && sessions.get(sid);
  return session && session.expires > Date.now() ? session : null;
};

const auth = (req, res, next) => {
  const session = sessionOf(req);
  if (!session) return res.status(401).json({ error: 'Nisi prijavljen/a.' });
  req.userId = session.userId;
  req.user = session.user;
  next();
};

const authPage = (req, res, next) => {
  const session = sessionOf(req);
  if (!session) return res.redirect('/login');
  req.userId = session.userId;
  req.user = session.user;
  next();
};

const botOwned = (id, userId) => {
  const bot = store.get(id);
  return bot && bot.ownerId === userId ? bot : null;
};

// ---------- OAuth ----------
app.get('/login', (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET) return res.status(500).send('CLIENT_ID i CLIENT_SECRET nisu postavljeni.');
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(res, 'oauth_state', state, 10 * 60 * 1000);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: `${BASE_URL}/callback`,
    response_type: 'code',
    scope: 'identify',
    state,
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

app.get('/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || state !== cookies(req.headers.cookie).oauth_state) return res.redirect('/');
  try {
    const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: `${BASE_URL}/callback`,
      }),
    });
    if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}`);
    const token = await tokenRes.json();
    const userRes = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
    if (!userRes.ok) throw new Error(`user ${userRes.status}`);
    const user = await userRes.json();
    const sid = crypto.randomBytes(32).toString('hex');
    sessions.set(sid, { userId: user.id, user: { id: user.id, username: user.username, displayName: user.global_name ?? user.username, avatarUrl: avatarOf(user) }, expires: Date.now() + SESSION_TTL });
    setCookie(res, 'sid', sid, SESSION_TTL);
    setCookie(res, 'oauth_state', '', 0);
    res.redirect('/');
  } catch (err) {
    console.error('[manager] login', err.message);
    res.status(500).send('Prijava nije uspjela. Provjeri CLIENT_ID, CLIENT_SECRET i redirect URL.');
  }
});

app.get('/logout', (req, res) => {
  sessions.delete(cookies(req.headers.cookie).sid);
  setCookie(res, 'sid', '', 0);
  res.redirect('/');
});

const avatarOf = (user) => (user?.id && user?.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null);

// ---------- API ----------
app.get('/api/me', auth, (req, res) => {
  const list = store.list().filter((b) => b.ownerId === req.userId).map((b) => ({
    id: b.id,
    name: b.name,
    avatarUrl: b.avatarUrl,
    createdAt: b.createdAt,
    ...bots.status(b.id),
  }));
  res.json({ user: req.user, bots: list });
});

app.post('/api/bots', auth, async (req, res) => {
  if (req.get('X-Manager') !== '1') return res.status(403).json({ error: 'Neispravan zahtjev.' });
  const token = String(req.body?.token ?? '').trim();
  if (!token || token.length < 20) return res.status(400).json({ error: 'Upiši ispravan bot token.' });
  try {
    const userRes = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bot ${token}` } });
    if (!userRes.ok) return res.status(400).json({ error: 'Token nije ispravan ili je istekao.' });
    const user = await userRes.json();
    if (!user.bot) return res.status(400).json({ error: 'To nije token bota.' });
    const appRes = await fetch('https://discord.com/api/v10/applications/@me', { headers: { Authorization: `Bot ${token}` } });
    const application = appRes.ok ? await appRes.json() : null;
    const existing = store.get(user.id);
    if (existing && existing.ownerId !== req.userId) return res.status(409).json({ error: 'Taj bot je već dodan na panel.' });
    const record = {
      id: user.id,
      name: application?.name || user.username,
      avatarUrl: avatarOf(user),
      applicationId: application?.id || user.id,
      ownerId: req.userId,
      token: store.encrypt(token),
      createdAt: existing?.createdAt ?? Date.now(),
      autoStart: true,
    };
    store.add(record);
    if (existing) await bots.restart(record, token);
    else await bots.start(record, token);
    res.json({ ok: true, bot: { id: record.id, name: record.name, avatarUrl: record.avatarUrl, ...bots.status(record.id) } });
  } catch (err) {
    console.error('[manager] add bot', err);
    res.status(500).json({ error: 'Bota nije moguće dodati. Provjeri token i pokušaj ponovno.' });
  }
});

app.post('/api/bots/:id/:action', auth, async (req, res) => {
  if (req.get('X-Manager') !== '1') return res.status(403).json({ error: 'Neispravan zahtjev.' });
  const bot = botOwned(req.params.id, req.userId);
  if (!bot) return res.status(404).json({ error: 'Bot ne postoji.' });
  const action = req.params.action;
  if (!['start', 'stop', 'restart'].includes(action)) return res.status(400).json({ error: 'Nepoznata akcija.' });
  try {
    if (action === 'stop') await bots.stop(bot.id);
    else if (action === 'start') await bots.start(bot, store.tokenOf(bot.id));
    else await bots.restart(bot, store.tokenOf(bot.id));
    res.json({ ok: true, ...bots.status(bot.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/bots/:id/logs', auth, (req, res) => {
  const bot = botOwned(req.params.id, req.userId);
  if (!bot) return res.status(404).json({ error: 'Bot ne postoji.' });
  res.json({ logs: bots.logs(bot.id), ...bots.status(bot.id) });
});

app.delete('/api/bots/:id', auth, async (req, res) => {
  if (req.get('X-Manager') !== '1') return res.status(403).json({ error: 'Neispravan zahtjev.' });
  const bot = botOwned(req.params.id, req.userId);
  if (!bot) return res.status(404).json({ error: 'Bot ne postoji.' });
  await bots.stop(bot.id);
  store.remove(bot.id);
  fs.rmSync(store.botsDir(bot.id), { recursive: true, force: true });
  res.json({ ok: true });
});

app.get('/api/health', (req, res) => {
  res.json({ online: true, bots: store.list().map((b) => ({ id: b.id, name: b.name, ...bots.status(b.id) })) });
});

// ---------- per-bot dashboard proxy ----------
function proxyToBot(req, res, bot, attempt = 0) {
  const port = bots.portOf(bot.id);
  const status = bots.status(bot.id);
  if (!port || !status.running) {
    if (attempt === 0) {
      return bots.start(bot, store.tokenOf(bot.id))
        .then(() => proxyToBot(req, res, bot, 1))
        .catch(() => res.status(502).send('Bot se nije pokrenuo. Otvori logove na panelu.'));
    }
    return res.status(502).send('Bot trenutno nije pokrenut.');
  }
  const headers = {
    ...req.headers,
    host: `127.0.0.1:${port}`,
    'accept-encoding': 'identity',
    'x-manager-secret': process.env.MANAGER_SECRET,
    'x-discord-user': req.userId,
  };
  const upstream = http.request({ hostname: '127.0.0.1', port, path: req.url || '/', method: req.method, headers }, (up) => {
    const type = String(up.headers['content-type'] || '');
    if (type.includes('text/html')) {
      const chunks = [];
      up.on('data', (c) => chunks.push(c));
      up.on('end', () => {
        let html = Buffer.concat(chunks).toString('utf8');
        if (!/<base\s/i.test(html)) html = html.replace(/<head[^>]*>/i, (m) => `${m}<base href="/b/${bot.id}/">`);
        const body = Buffer.from(html, 'utf8');
        const out = { ...up.headers };
        delete out['content-length'];
        out['content-length'] = String(body.length);
        res.writeHead(up.statusCode || 200, out);
        res.end(body);
      });
      return;
    }
    res.writeHead(up.statusCode || 200, up.headers);
    up.pipe(res);
  });
  upstream.on('error', () => res.status(502).send('Bot panel nije dostupan.'));
  req.pipe(upstream);
}

app.use('/b/:botId', authPage, async (req, res) => {
  const bot = botOwned(req.params.botId, req.userId);
  if (!bot) return res.status(403).send('Nemaš pristup ovom botu.');
  if (req.path === '/login') return res.redirect('/login');
  if (req.path === '/logout') return res.redirect('/logout');
  proxyToBot(req, res, bot);
});

// ---------- static UI ----------
app.get('/app.css', (req, res) => res.sendFile(DASHBOARD_CSS));
app.use(express.static(PUBLIC_DIR, { index: 'index.html', maxAge: 0, etag: true }));

// ---------- startup ----------
async function importEnvBot() {
  const token = process.env.DISCORD_TOKEN;
  const ownerId = process.env.BOT_OWNER_ID;
  if (token && !ownerId) console.warn('[manager] DISCORD_TOKEN postoji, ali BOT_OWNER_ID nije postavljen; bot nije uvezen.');
  if (!token || !ownerId || store.list().length) return;
  try {
    const userRes = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bot ${token}` } });
    if (!userRes.ok) return;
    const user = await userRes.json();
    if (!user.bot) return;
    const appRes = await fetch('https://discord.com/api/v10/applications/@me', { headers: { Authorization: `Bot ${token}` } });
    const application = appRes.ok ? await appRes.json() : null;
    store.add({
      id: user.id,
      name: application?.name || user.username,
      avatarUrl: avatarOf(user),
      applicationId: application?.id || user.id,
      ownerId,
      token: store.encrypt(token),
      createdAt: Date.now(),
      autoStart: true,
    });
    console.log(`[manager] Uvezen bot iz .env: ${user.username}`);
  } catch (err) {
    console.warn('[manager] env bot:', err.message);
  }
}

await importEnvBot();
for (const bot of store.list()) {
  if (bot.autoStart === false) continue;
  try {
    bots.start(bot, store.tokenOf(bot.id)).catch((err) => console.error(`[manager] start ${bot.name}:`, err.message));
  } catch (err) {
    console.error(`[manager] start ${bot.name}:`, err.message);
  }
}

app.listen(PORT, () => console.log(`🌐 BYOT manager: ${BASE_URL}`));

setInterval(() => {
  for (const [sid, s] of sessions) if (s.expires < Date.now()) sessions.delete(sid);
}, 60 * 60 * 1000).unref();

async function shutdown(code = 0) {
  await bots.stopAll().catch(() => {});
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
