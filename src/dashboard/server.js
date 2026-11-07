// Web dashboard: Discord login + JSON API used by public/app.js. Also serves /health for uptime monitors.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import * as db from '../db.js';
import { recentActivity } from '../features/activity.js';
import * as giveaways from '../features/giveaways.js';
import * as invites from '../features/invites.js';
import { DEFAULT_BOOST, DEFAULT_GOODBYE, DEFAULT_WELCOME, boostPayload, buildWelcomePayload, goodbyePayload } from '../features/members.js';
import { normalizeBanner } from '../features/welcomeBanner.js';
import * as music from '../features/music.js';
import * as antinuke from '../features/antinuke.js';
import * as antilink from '../features/antilink.js';
import * as birthdays from '../features/birthdays.js';
import * as botSettings from '../features/botSettings.js';
import * as counting from '../features/counting.js';
import * as levels from '../features/levels.js';
import * as kaladont from '../features/games/kaladont.js';
import * as toplo from '../features/games/toplo.js';
import { sendMessage } from '../features/messages.js';
import { clearWarns } from '../features/moderation.js';
import * as reactionRoles from '../features/reactionRoles.js';
import { STATS, STATS_DEFINITIONS, getStatsConfig, getStatsSnapshot, removeStats, setupStats, updateStats } from '../features/stats.js';
import * as socialAlerts from '../features/socialAlerts.js';
import { closeTicketChannel, panelPayload } from '../features/tickets.js';
import { parseDuration } from '../utils/duration.js';
import { UserError, roleProblem } from '../utils/helpers.js';

const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_GIVEAWAY = 60 * 24 * 60 * 60 * 1000;
const sessions = new Map(); // sid -> { user, expires }

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((c) => c.trim().split('='))
      .filter(([k, v]) => k && v !== undefined)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]),
  );
}

const avatarOf = (user) => user?.displayAvatarURL?.({ size: 128 }) ?? null;

function userInfo(guild, id) {
  const member = guild.members.cache.get(id);
  const user = member?.user ?? guild.client.users.cache.get(id);
  return { id, name: member?.displayName ?? user?.globalName ?? user?.username ?? `Korisnik ${id.slice(-4)}`, avatarUrl: avatarOf(member ?? user) };
}

const messageUrl = (guildId, channelId, messageId) =>
  `https://discord.com/channels/${guildId}/${channelId}${messageId ? `/${messageId}` : ''}`;

export function startDashboard(client, port) {
  const { CLIENT_SECRET, MANAGER_SECRET } = process.env;
  const baseUrl = (process.env.DASHBOARD_URL || `http://localhost:${port}`).replace(/\/$/, '');
  const secureCookies = baseUrl.startsWith('https://');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.get('/health', (req, res) => {
    const online = client.isReady();
    res.status(online ? 200 : 503).json({ bot: client.user?.username ?? null, online, ping: client.ws.ping, uptime: client.uptime });
  });

  if (!CLIENT_SECRET && !MANAGER_SECRET) {
    console.warn('[dashboard] CLIENT_SECRET nije postavljen, dashboard je isključen (radi samo /health).');
    app.listen(port, process.env.HOST || undefined, () => console.log(`Health endpoint na portu ${port}`));
    return;
  }

  const setCookie = (res, name, value, maxAgeMs) => {
    res.append(
      'Set-Cookie',
      `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secureCookies ? '; Secure' : ''}`,
    );
  };

  // ---------- auth ----------
  app.get('/login', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    setCookie(res, 'oauth_state', state, 10 * 60 * 1000);
    const params = new URLSearchParams({
      client_id: client.application?.id ?? client.user.id,
      redirect_uri: `${baseUrl}/callback`,
      response_type: 'code',
      scope: 'identify',
      state,
    });
    res.redirect(`https://discord.com/oauth2/authorize?${params}`);
  });

  app.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    const cookies = parseCookies(req.headers.cookie);
    if (!code || !state || state !== cookies.oauth_state) return res.redirect('/');
    try {
      const tokenRes = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: client.application?.id ?? client.user.id,
          client_secret: CLIENT_SECRET,
          grant_type: 'authorization_code',
          code: String(code),
          redirect_uri: `${baseUrl}/callback`,
        }),
      });
      if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}: ${await tokenRes.text()}`);
      const token = await tokenRes.json();
      const userRes = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!userRes.ok) throw new Error(`user ${userRes.status}`);
      const user = await userRes.json();
      const sid = crypto.randomBytes(32).toString('hex');
      sessions.set(sid, { userId: user.id, expires: Date.now() + SESSION_TTL });
      setCookie(res, 'sid', sid, SESSION_TTL);
      setCookie(res, 'oauth_state', '', 0);
      res.redirect('/');
    } catch (err) {
      console.error('[dashboard] login', err.message);
      res.status(500).send('Prijava nije uspjela. Provjeri CLIENT_SECRET i redirect URL u Discord Developer Portalu.');
    }
  });

  app.get('/logout', (req, res) => {
    sessions.delete(parseCookies(req.headers.cookie).sid);
    setCookie(res, 'sid', '', 0);
    res.redirect('/');
  });

  // Dashboard files change together with the bot. Serve index.html with a versioned
  // app.js/app.css URL so browsers and CDNs (Cloudflare) cannot keep an old dashboard.
  const publicDir = fileURLToPath(new URL('./public/', import.meta.url));
  const indexFile = path.join(publicDir, 'index.html');
  const assetVersion = () => {
    try {
      const js = fs.statSync(path.join(publicDir, 'app.js')).mtimeMs;
      const css = fs.statSync(path.join(publicDir, 'app.css')).mtimeMs;
      return String(Math.max(js, css));
    } catch {
      return '1';
    }
  };
  const noStore = (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  };
  app.get(['/', '/index.html'], (req, res) => {
    try {
      const html = fs.readFileSync(indexFile, 'utf8').replaceAll('__ASSET_VERSION__', assetVersion());
      noStore(res);
      res.type('html').send(html);
    } catch (err) {
      console.error('[dashboard] index.html', err.message);
      res.status(500).send('Dashboard nije dostupan.');
    }
  });
  app.use(express.static(publicDir, {
    index: false,
    maxAge: 0,
    etag: true,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
  }));

  // ---------- API ----------
  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));

  api.use((req, res, next) => {
    // When running behind the BYOT manager, the manager authenticates the user and
    // forwards their Discord ID. The bot's own OAuth session is not used.
    if (MANAGER_SECRET) {
      if (req.get('X-Manager-Secret') !== MANAGER_SECRET) return res.status(401).json({ error: 'Neovlašten pristup.' });
      const userId = req.get('X-Discord-User');
      if (!userId) return res.status(401).json({ error: 'Nisi prijavljen/a.' });
      if (req.method !== 'GET' && req.get('X-Dashboard') !== '1') return res.status(403).json({ error: 'Neispravan zahtjev.' });
      req.userId = userId;
      return next();
    }
    const sid = parseCookies(req.headers.cookie).sid;
    const session = sid && sessions.get(sid);
    if (!session || session.expires < Date.now()) {
      if (sid) sessions.delete(sid);
      return res.status(401).json({ error: 'Nisi prijavljen/a.', bot: { name: client.user?.username, avatarUrl: avatarOf(client.user) } });
    }
    if (req.method !== 'GET' && req.get('X-Dashboard') !== '1') return res.status(403).json({ error: 'Neispravan zahtjev.' });
    req.userId = session.userId;
    next();
  });

  // The BYOT bot owner manages every guild the bot is in. Guild owners and users
  // explicitly added on the dashboard manage their own guild.
  const isBotOwner = (userId) => Boolean(process.env.BOT_OWNER_ID) && userId === process.env.BOT_OWNER_ID;
  const isDashboardUser = (guild, userId) =>
    isBotOwner(userId) || guild.ownerId === userId || db.guild(guild.id).config.dashboardUsers.includes(userId);
  const hasDashboardAccess = (guild, userId) =>
    isBotOwner(userId) || guild.ownerId === userId || (isDashboardUser(guild, userId) && guild.members.cache.has(userId));

  const manageableGuilds = (userId) => client.guilds.cache.filter((g) => isDashboardUser(g, userId));

  api.get('/me', async (req, res) => {
    const user = await client.users.fetch(req.userId);
    res.json({
      user: { id: user.id, username: user.username, displayName: user.globalName ?? user.username, avatarUrl: avatarOf(user) },
      guilds: manageableGuilds(req.userId).map((g) => ({ id: g.id, name: g.name, iconUrl: g.iconURL({ size: 128 }), memberCount: g.memberCount, isOwner: g.ownerId === req.userId })),
      bot: {
        id: client.user.id,
        name: client.user.username,
        displayName: client.user.globalName ?? client.user.username,
        avatarUrl: avatarOf(client.user),
        inviteUrl: `https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`,
        ping: client.ws.ping,
        uptimeMs: client.uptime,
        status: botSettings.getSettings().status,
        canEditStatus: botSettings.canEdit(client, req.userId),
        statusTypes: Object.entries(botSettings.STATUS_TYPES).map(([key, label]) => ({ key, label })),
        presenceStates: Object.entries(botSettings.PRESENCE_STATES).map(([key, label]) => ({ key, label })),
      },
    });
  });

  // ---------- global bot settings ----------
  api.get('/bot', (req, res) => {
    res.json({
      id: client.user.id,
      name: client.user.username,
      displayName: client.user.globalName ?? client.user.username,
      avatarUrl: avatarOf(client.user),
      status: botSettings.getSettings().status,
      canEditStatus: botSettings.canEdit(client, req.userId),
      statusTypes: Object.entries(botSettings.STATUS_TYPES).map(([key, label]) => ({ key, label })),
      presenceStates: Object.entries(botSettings.PRESENCE_STATES).map(([key, label]) => ({ key, label })),
    });
  });
  api.put('/bot/status', async (req, res) => {
    if (!botSettings.canEdit(client, req.userId)) throw new UserError('Status bota može mijenjati samo vlasnik bota.');
    const input = req.body?.status ?? req.body ?? {};
    const settings = botSettings.saveSettings({ status: input });
    await botSettings.applyStatus(client);
    ok(res, { status: settings.status });
  });

  // every /guilds/:gid route: owner, or a member the owner explicitly added to the dashboard
  api.param('gid', async (req, res, next, gid) => {
    const guild = client.guilds.cache.get(gid);
    if (!guild) return res.status(403).json({ error: 'Nemaš pristup ovom serveru.' });
    const member = guild.members.cache.get(req.userId) ?? (await guild.members.fetch(req.userId).catch(() => null));
    if (!hasDashboardAccess(guild, req.userId) || (!member && !isBotOwner(req.userId))) {
      return res.status(403).json({ error: 'Nemaš pristup ovom serveru. Vlasnik servera te mora dodati na dashboard.' });
    }
    req.guild = guild;
    req.member = member ?? guild.members.me;
    req.g = db.guild(guild.id);
    next();
  });

  const textChannel = (guild, id) => {
    const ch = id && guild.channels.cache.get(id);
    if (!ch || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(ch.type)) throw new UserError('Odaberi tekstualni kanal.');
    return ch;
  };
  const imageUrlOf = (value) => {
    const raw = String(value ?? '').trim();
    if (!raw) return null;
    if (raw.length > 2048) throw new UserError('URL slike je predugačak.');
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
      return url.href;
    } catch {
      throw new UserError('Upiši ispravan URL slike (http ili https).');
    }
  };
  const optionalText = (guild, id) => (id ? textChannel(guild, id) : null);
  const ok = (res, extra = {}) => res.json({ ok: true, ...extra });

  api.get('/guilds/:gid', (req, res) => {
    const { guild, g } = req;
    const channels = [...guild.channels.cache.values()].sort((a, b) => a.rawPosition - b.rawPosition);
    const pick = (types) =>
      channels.filter((c) => types.includes(c.type)).map((c) => ({ id: c.id, name: c.name, parentName: c.parent?.name ?? null }));
    const bots = guild.members.cache.filter((m) => m.user.bot).size;
    const statsCfg = getStatsConfig(guild.id);
    res.json({
      id: guild.id,
      name: guild.name,
      iconUrl: guild.iconURL({ size: 128 }),
      memberCount: guild.memberCount,
      botCount: bots,
      humanCount: guild.memberCount - bots,
      boostCount: guild.premiumSubscriptionCount ?? 0,
      boostTier: guild.premiumTier,
      channels: {
        text: pick([ChannelType.GuildText, ChannelType.GuildAnnouncement]),
        voice: pick([ChannelType.GuildVoice, ChannelType.GuildStageVoice]),
        categories: channels.filter((c) => c.type === ChannelType.GuildCategory).map((c) => ({ id: c.id, name: c.name })),
      },
      roles: guild.roles.cache
        .filter((r) => r.id !== guild.id)
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.color ? r.hexColor : null, assignable: !roleProblem(guild, r) })),
      config: {
        welcome: {
          enabled: Boolean(g.config.welcome),
          channelId: g.config.welcome?.channelId ?? null,
          message: g.config.welcome?.message ?? '',
          imageUrl: g.config.welcome?.imageUrl ?? null,
          banner: normalizeBanner(g.config.welcome?.banner),
          defaultMessage: DEFAULT_WELCOME,
        },
        boost: {
          enabled: Boolean(g.config.boost),
          channelId: g.config.boost?.channelId ?? null,
          message: g.config.boost?.message ?? '',
          imageUrl: g.config.boost?.imageUrl ?? null,
          defaultMessage: DEFAULT_BOOST,
        },
        goodbye: {
          enabled: Boolean(g.config.goodbye),
          channelId: g.config.goodbye?.channelId ?? null,
          message: g.config.goodbye?.message ?? '',
          imageUrl: g.config.goodbye?.imageUrl ?? null,
          defaultMessage: DEFAULT_GOODBYE,
        },
        autoroles: g.config.autoroles ?? [],
        stats: {
          enabled: Boolean(statsCfg),
          categoryName: statsCfg?.categoryName ?? null,
          channels: Object.fromEntries(
            Object.keys(STATS).map((key) => {
              const item = statsCfg?.channels?.[key];
              const ch = item?.channelId && guild.channels.cache.get(item.channelId);
              return [key, {
                enabled: Boolean(item?.enabled),
                template: item?.template ?? STATS[key].defaultTemplate,
                account: item?.account ?? '',
                channel: ch ? { id: ch.id, name: ch.name } : null,
              }];
            }),
          ),
        },
        tickets: {
          enabled: Boolean(g.config.tickets),
          categoryId: g.config.tickets?.categoryId ?? null,
          supportRoleId: g.config.tickets?.supportRoleId ?? null,
          logChannelId: g.config.tickets?.logChannelId ?? null,
          openCount: Object.keys(g.tickets.open).length,
        },
        antinuke: { enabled: antinuke.getConfig(guild.id).enabled },
        antilink: { enabled: antilink.getConfig(guild.id).enabled },
        modLogChannelId: g.config.modLogChannelId ?? null,
        kaladontCount: kaladont.activeGames(guild.id).length,
        toploCount: toplo.activeGames(guild.id).length,
        counting: (() => {
          const c = counting.getConfig(guild.id);
          return c ? { enabled: true, channelId: c.channelId, current: c.current ?? 0, best: c.best ?? 0 } : { enabled: false };
        })(),
        levels: { enabled: levels.getConfig(guild.id).enabled },
        social: { enabled: socialAlerts.getConfig(guild.id).enabled, accountCount: socialAlerts.getConfig(guild.id).accounts.length },
        birthdays: { enabled: birthdays.getConfig(guild.id).enabled, count: Object.keys(g.birthdays ?? {}).length },
      },
      activity: recentActivity(guild.id),
    });
  });

  // ---------- dashboard access ----------
  api.get('/guilds/:gid/access', (req, res) => {
    const ids = req.g.config.dashboardUsers.filter((id) => id !== req.guild.ownerId);
    res.json({
      canEdit: req.guild.ownerId === req.userId || isBotOwner(req.userId),
      owner: userInfo(req.guild, req.guild.ownerId),
      users: ids.map((id) => userInfo(req.guild, id)),
    });
  });
  api.put('/guilds/:gid/access', async (req, res) => {
    if (req.guild.ownerId !== req.userId && !isBotOwner(req.userId)) throw new UserError('Pristup dashboardu može mijenjati samo vlasnik servera ili vlasnik bota.');
    const ids = Array.isArray(req.body?.userIds) ? [...new Set(req.body.userIds.map(String))] : [];
    if (ids.length > 50) throw new UserError('Najviše 50 članova može imati pristup dashboardu.');
    const clean = [];
    for (const id of ids) {
      if (id === req.guild.ownerId) continue;
      const member = req.guild.members.cache.get(id) ?? (await req.guild.members.fetch(id).catch(() => null));
      if (!member) throw new UserError('Jedan od odabranih članova više nije na serveru.');
      if (member.user.bot) throw new UserError('Bot ne može imati pristup dashboardu.');
      clean.push(id);
    }
    req.g.config.dashboardUsers = clean;
    db.save();
    ok(res, { users: clean.map((id) => userInfo(req.guild, id)) });
  });

  // ---------- welcome / boost / autoroles ----------
  for (const kind of ['welcome', 'boost', 'goodbye']) {
    api.put(`/guilds/:gid/${kind}`, (req, res) => {
      const { enabled, channelId, message, imageUrl, banner } = req.body ?? {};
      if (!enabled) delete req.g.config[kind];
      else {
        const channel = textChannel(req.guild, channelId);
        const text = String(message ?? '').trim();
        if (text.length > 2000) throw new UserError('Poruka može imati najviše 2000 znakova.');
        req.g.config[kind] = { channelId: channel.id, message: text || null, imageUrl: imageUrlOf(imageUrl) };
        if (kind === 'welcome') req.g.config[kind].banner = normalizeBanner(banner);
      }
      db.save();
      ok(res);
    });
    api.post(`/guilds/:gid/${kind}/test`, async (req, res) => {
      const cfg = req.g.config[kind];
      const channel = cfg && req.guild.channels.cache.get(cfg.channelId);
      if (!channel) throw new UserError('Prvo uključi i spremi poruku.');
      const payload = kind === 'welcome'
        ? await buildWelcomePayload(req.member, req.g.joins[req.userId]?.inviterId ?? null)
        : kind === 'goodbye'
          ? goodbyePayload(req.member)
          : boostPayload(req.member);
      await channel.send(payload).catch(() => {
        throw new UserError(`Ne mogu slati poruke u #${channel.name}.`);
      });
      ok(res);
    });
  }

  api.put('/guilds/:gid/autoroles', (req, res) => {
    const ids = Array.isArray(req.body?.roleIds) ? [...new Set(req.body.roleIds.map(String))] : [];
    for (const id of ids) {
      const role = req.guild.roles.cache.get(id);
      if (!role) throw new UserError('Jedna od rola više ne postoji.');
      const problem = roleProblem(req.guild, role);
      if (problem) throw new UserError(problem.replace(/\*\*/g, '').replace(/<@&\d+>/g, role.name));
    }
    req.g.config.autoroles = ids;
    db.save();
    ok(res);
  });

  // ---------- stats ----------
  const statsSnapshot = async (guild) => {
    const snapshot = await getStatsSnapshot(guild);
    return { ...snapshot, definitions: STATS_DEFINITIONS };
  };
  api.get('/guilds/:gid/stats', async (req, res) => {
    res.json(await statsSnapshot(req.guild));
  });
  api.put('/guilds/:gid/stats', async (req, res) => {
    if (!req.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) throw new UserError('Bot treba permisiju Manage Channels.');
    const body = req.body ?? {};
    for (const [key, def] of Object.entries(STATS)) {
      const item = body.channels?.[key];
      if (def.kind === 'social' && item?.enabled && !String(item.account ?? '').trim()) {
        throw new UserError(`Upiši korisničko ime ili kanal za ${def.label}.`);
      }
    }
    await req.guild.members.fetch();
    await setupStats(req.guild, body);
    ok(res, await statsSnapshot(req.guild));
  });
  api.post('/guilds/:gid/stats', async (req, res) => {
    if (!req.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) throw new UserError('Bot treba permisiju Manage Channels.');
    await req.guild.members.fetch();
    await setupStats(req.guild);
    ok(res, await statsSnapshot(req.guild));
  });
  api.post('/guilds/:gid/stats/refresh', async (req, res) => {
    await updateStats(req.guild);
    ok(res, await statsSnapshot(req.guild));
  });
  api.delete('/guilds/:gid/stats', async (req, res) => {
    await removeStats(req.guild);
    ok(res);
  });

  // ---------- counting ----------
  api.get('/guilds/:gid/counting', (req, res) => {
    const cfg = counting.getConfig(req.guild.id);
    const channel = cfg && req.guild.channels.cache.get(cfg.channelId);
    res.json({
      enabled: Boolean(cfg),
      channelId: cfg?.channelId ?? null,
      channelName: channel?.name ?? null,
      current: cfg?.current ?? 0,
      best: cfg?.best ?? 0,
    });
  });
  api.put('/guilds/:gid/counting', (req, res) => {
    const channel = textChannel(req.guild, req.body?.channelId);
    const cfg = counting.setup(req.guild.id, channel.id);
    ok(res, { enabled: true, channelId: cfg.channelId, channelName: channel.name, current: cfg.current, best: cfg.best });
  });
  api.post('/guilds/:gid/counting/reset', (req, res) => {
    const cfg = counting.reset(req.guild.id);
    if (!cfg) throw new UserError('Brojanje nije uključeno.');
    ok(res, { current: cfg.current, best: cfg.best });
  });
  api.delete('/guilds/:gid/counting', (req, res) => {
    counting.disable(req.guild.id);
    ok(res);
  });

  // ---------- levels ----------
  const levelsPayload = (guild) => {
    const cfg = levels.getConfig(guild.id);
    const top = levels.top(guild.id, 10);
    const decorate = (list) => list.map((u) => ({ ...u, user: userInfo(guild, u.userId) }));
    return { config: cfg, top: { text: decorate(top.text), voice: decorate(top.voice) } };
  };
  api.get('/guilds/:gid/levels', (req, res) => {
    res.json(levelsPayload(req.guild));
  });
  api.put('/guilds/:gid/levels', (req, res) => {
    const body = req.body ?? {};
    if ('channelId' in body) {
      const channel = body.channelId ? req.guild.channels.cache.get(body.channelId) : null;
      if (body.channelId && (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type))) {
        throw new UserError('Odaberi tekstualni kanal za obavijesti o levelu.');
      }
      body.channelId = channel ? channel.id : null;
    }
    ok(res, { config: levels.saveConfig(req.guild.id, body) });
  });
  api.delete('/guilds/:gid/levels/:userId', (req, res) => {
    ok(res, { removed: levels.resetUser(req.guild.id, req.params.userId) });
  });
  api.delete('/guilds/:gid/levels', (req, res) => {
    levels.resetAll(req.guild.id);
    ok(res);
  });

  // ---------- tickets ----------
  api.put('/guilds/:gid/tickets', (req, res) => {
    const { categoryId, supportRoleId, logChannelId } = req.body ?? {};
    const category = req.guild.channels.cache.get(categoryId);
    if (category?.type !== ChannelType.GuildCategory) throw new UserError('Odaberi kategoriju za tikete.');
    if (supportRoleId && !req.guild.roles.cache.has(supportRoleId)) throw new UserError('Support rola ne postoji.');
    req.g.config.tickets = {
      categoryId: category.id,
      supportRoleId: supportRoleId || null,
      logChannelId: optionalText(req.guild, logChannelId)?.id ?? null,
    };
    db.save();
    ok(res);
  });
  api.delete('/guilds/:gid/tickets', (req, res) => {
    delete req.g.config.tickets;
    db.save();
    ok(res);
  });
  api.post('/guilds/:gid/tickets/panel', async (req, res) => {
    if (!req.g.config.tickets) throw new UserError('Prvo spremi postavke tiketa.');
    const channel = textChannel(req.guild, req.body?.channelId);
    const title = String(req.body?.title ?? '').slice(0, 256);
    const description = String(req.body?.description ?? '').slice(0, 2000);
    const message = await channel.send(panelPayload(title, description)).catch(() => {
      throw new UserError(`Ne mogu slati poruke u #${channel.name}.`);
    });
    ok(res, { url: message.url });
  });
  api.get('/guilds/:gid/tickets', (req, res) => {
    const open = Object.entries(req.g.tickets.open)
      .filter(([channelId]) => req.guild.channels.cache.has(channelId))
      .map(([channelId, t]) => ({
        channelId,
        channelName: req.guild.channels.cache.get(channelId).name,
        number: t.number,
        url: messageUrl(req.guild.id, channelId),
        owner: userInfo(req.guild, t.ownerId),
        reason: t.reason ?? '',
        createdAt: t.createdAt,
      }))
      .sort((a, b) => b.createdAt - a.createdAt);
    res.json({ open });
  });
  api.post('/guilds/:gid/tickets/:channelId/close', async (req, res) => {
    const channel = req.guild.channels.cache.get(req.params.channelId);
    if (!channel) throw new UserError('Taj kanal više ne postoji.');
    await closeTicketChannel(channel, { id: req.member.id, name: req.member.displayName });
    ok(res);
  });

  // ---------- invites ----------
  api.get('/guilds/:gid/invites', async (req, res) => {
    const ids = Object.keys(req.g.invites);
    const missing = ids.filter((id) => !req.guild.members.cache.has(id) && !client.users.cache.has(id)).slice(0, 50);
    await Promise.all(missing.map((id) => client.users.fetch(id).catch(() => null)));
    const leaderboard = ids
      .map((id) => ({ user: userInfo(req.guild, id), ...invites.stats(req.g, id) }))
      .sort((a, b) => b.total - a.total || b.regular - a.regular);
    res.json({ leaderboard });
  });
  api.get('/guilds/:gid/members', (req, res) => {
    const q = String(req.query.q ?? '').toLowerCase().trim();
    const found = req.guild.members.cache
      .filter((m) => !m.user.bot && (!q || m.displayName.toLowerCase().includes(q) || m.user.username.toLowerCase().includes(q)))
      .first(20)
      .map((m) => ({ id: m.id, name: m.displayName, username: m.user.username, avatarUrl: avatarOf(m) }));
    res.json({ members: found });
  });
  api.post('/guilds/:gid/invites/:userId/bonus', (req, res) => {
    const amount = Number(req.body?.amount);
    if (!Number.isInteger(amount) || amount === 0 || Math.abs(amount) > 100000) throw new UserError('Upiši cijeli broj različit od nule.');
    ok(res, { stats: invites.addBonus(req.guild.id, req.params.userId, amount) });
  });
  api.delete('/guilds/:gid/invites/:userId', (req, res) => {
    invites.reset(req.guild.id, req.params.userId);
    ok(res);
  });
  api.delete('/guilds/:gid/invites', (req, res) => {
    invites.reset(req.guild.id);
    ok(res);
  });

  // ---------- reaction roles ----------
  api.get('/guilds/:gid/reactionroles', (req, res) => {
    const messages = Object.entries(req.g.reactionRoles).map(([messageId, entry]) => ({
      messageId,
      channelId: entry.channelId,
      channelName: req.guild.channels.cache.get(entry.channelId)?.name ?? 'obrisan-kanal',
      url: messageUrl(req.guild.id, entry.channelId, messageId),
      managed: Boolean(entry.managed),
      title: entry.managed ? entry.title : null,
      description: entry.managed ? entry.baseDescription : null,
      roles: Object.entries(entry.roles).map(([key, r]) => ({
        key,
        emoji: r.emoji,
        emojiUrl: /^\d+$/.test(key) ? `https://cdn.discordapp.com/emojis/${key}.webp?size=48` : null,
        roleId: r.roleId,
      })),
    }));
    res.json({ messages });
  });
  api.post('/guilds/:gid/reactionroles', async (req, res) => {
    const channel = textChannel(req.guild, req.body?.channelId);
    const title = String(req.body?.title ?? '').trim().slice(0, 256);
    if (!title) throw new UserError('Upiši naslov poruke.');
    const message = await reactionRoles.createManagedMessage(channel, title, String(req.body?.description ?? '').slice(0, 1500));
    ok(res, { messageId: message.id, url: message.url });
  });
  api.post('/guilds/:gid/reactionroles/:messageId/roles', async (req, res) => {
    const entry = req.g.reactionRoles[req.params.messageId];
    const channel = textChannel(req.guild, entry?.channelId ?? req.body?.channelId);
    const role = req.guild.roles.cache.get(req.body?.roleId);
    if (!role) throw new UserError('Odaberi rolu.');
    await reactionRoles.addReactionRole(channel, req.params.messageId, String(req.body?.emoji ?? ''), role);
    ok(res);
  });
  api.delete('/guilds/:gid/reactionroles/:messageId/roles/:key', async (req, res) => {
    await reactionRoles.removeReactionRole(req.guild, req.params.messageId, req.params.key);
    ok(res);
  });
  api.delete('/guilds/:gid/reactionroles/:messageId', async (req, res) => {
    await reactionRoles.deleteReactionRoleMessage(req.guild, req.params.messageId);
    ok(res);
  });

  // ---------- giveaways ----------
  api.get('/guilds/:gid/giveaways', (req, res) => {
    const list = Object.entries(req.g.giveaways).map(([messageId, gw]) => ({
      messageId,
      channelId: gw.channelId,
      channelName: req.guild.channels.cache.get(gw.channelId)?.name ?? 'obrisan-kanal',
      url: messageUrl(req.guild.id, gw.channelId, messageId),
      prize: gw.prize,
      description: gw.description,
      winnerCount: gw.winners,
      endsAt: gw.endsAt,
      ended: gw.ended,
      entrantCount: gw.entrants.length,
      host: { id: gw.hostId, name: userInfo(req.guild, gw.hostId).name },
      winners: gw.winnerIds.map((id) => ({ id, name: userInfo(req.guild, id).name })),
    }));
    const active = list.filter((g) => !g.ended).sort((a, b) => a.endsAt - b.endsAt);
    const ended = list.filter((g) => g.ended).sort((a, b) => b.endsAt - a.endsAt);
    res.json({ giveaways: [...active, ...ended] });
  });
  api.post('/guilds/:gid/giveaways', async (req, res) => {
    const { channelId, prize, winnerCount, duration, description } = req.body ?? {};
    const channel = textChannel(req.guild, channelId);
    const durationMs = parseDuration(duration ?? '');
    if (!durationMs || durationMs < 10_000 || durationMs > MAX_GIVEAWAY) {
      throw new UserError('Neispravno trajanje. Primjeri: 30m, 2h, 1d, 1d12h (najmanje 10 s, najviše 60 dana).');
    }
    const winners = Number(winnerCount);
    if (!Number.isInteger(winners) || winners < 1 || winners > 50) throw new UserError('Broj pobjednika mora biti od 1 do 50.');
    const prizeText = String(prize ?? '').trim().slice(0, 200);
    if (!prizeText) throw new UserError('Upiši nagradu.');
    const message = await giveaways
      .createGiveaway({
        channel,
        hostId: req.member.id,
        prize: prizeText,
        winners,
        durationMs,
        description: String(description ?? '').trim().slice(0, 1000) || null,
      })
      .catch(() => {
        throw new UserError(`Ne mogu slati poruke u #${channel.name}.`);
      });
    ok(res, { messageId: message.id, url: message.url });
  });
  const findGiveaway = (req) => {
    const gw = req.g.giveaways[req.params.messageId];
    if (!gw) throw new UserError('Taj giveaway ne postoji.');
    return gw;
  };
  api.post('/guilds/:gid/giveaways/:messageId/end', async (req, res) => {
    if (findGiveaway(req).ended) throw new UserError('Giveaway je već završen.');
    await giveaways.endGiveaway(req.guild.id, req.params.messageId);
    ok(res);
  });
  api.post('/guilds/:gid/giveaways/:messageId/reroll', async (req, res) => {
    if (!findGiveaway(req).ended) throw new UserError('Giveaway još traje.');
    const count = req.body?.count ? Number(req.body.count) : undefined;
    const winners = await giveaways.reroll(req.guild.id, req.params.messageId, count);
    ok(res, { winners: (winners ?? []).map((id) => ({ id, name: userInfo(req.guild, id).name })) });
  });
  api.delete('/guilds/:gid/giveaways/:messageId', async (req, res) => {
    findGiveaway(req);
    await giveaways.deleteGiveaway(req.guild.id, req.params.messageId);
    ok(res);
  });

  // ---------- anti-nuke ----------
  api.get('/guilds/:gid/antinuke', (req, res) => {
    const me = req.guild.members.me;
    res.json({
      canEdit: antinuke.canConfigure(req.guild, req.userId),
      owner: userInfo(req.guild, req.guild.ownerId),
      botCanSeeAuditLog: me.permissions.has(PermissionFlagsBits.ViewAuditLog),
      botRoleIsHighest: me.roles.highest.position === Math.max(...req.guild.roles.cache.map((r) => r.position)),
      rules: Object.entries(antinuke.RULES).map(([key, r]) => ({ key, label: r.label, limited: r.limited })),
      punishments: Object.entries(antinuke.PUNISHMENTS).map(([key, label]) => ({ key, label })),
      config: antinuke.getConfig(req.guild.id),
      whitelistMembers: antinuke.getConfig(req.guild.id).whitelistUsers.map((id) => userInfo(req.guild, id)),
      incidents: antinuke.incidents(req.guild.id),
    });
  });
  api.put('/guilds/:gid/antinuke', (req, res) => {
    if (!antinuke.canConfigure(req.guild, req.userId)) throw new UserError('Anti-nuke postavke može mijenjati samo vlasnik servera.');
    const body = req.body ?? {};
    if (body.logChannelId) textChannel(req.guild, body.logChannelId);
    if (body.enabled && !req.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
      throw new UserError('Bot treba permisiju View Audit Log (najbolje Administrator).');
    }
    ok(res, { config: antinuke.saveConfig(req.guild.id, body) });
  });

  // ---------- anti-link ----------
  api.get('/guilds/:gid/antilink', (req, res) => {
    res.json({
      config: antilink.getConfig(req.guild.id),
      modLogChannelId: req.g.config.modLogChannelId ?? null,
      canDelete: req.guild.members.me.permissions.has(PermissionFlagsBits.ManageMessages),
    });
  });
  api.put('/guilds/:gid/antilink', (req, res) => {
    const body = req.body ?? {};
    const roles = Array.isArray(body.whitelistRoles) ? body.whitelistRoles : [];
    const channels = Array.isArray(body.whitelistChannels) ? body.whitelistChannels : [];
    for (const id of roles) {
      if (!req.guild.roles.cache.has(String(id))) throw new UserError('Jedna od odabranih rola više ne postoji.');
    }
    for (const id of channels) {
      if (!req.guild.channels.cache.has(String(id))) throw new UserError('Jedan od odabranih kanala više ne postoji.');
    }
    ok(res, { config: antilink.saveConfig(req.guild.id, { ...body, whitelistRoles: roles, whitelistChannels: channels }) });
  });

  // ---------- moderation ----------
  api.get('/guilds/:gid/moderation', (req, res) => {
    const warnings = Object.entries(req.g.warns ?? {})
      .filter(([, list]) => list.length)
      .map(([userId, list]) => ({
        user: userInfo(req.guild, userId),
        warnings: list.map((w) => ({ id: w.id, reason: w.reason, at: w.at, by: userInfo(req.guild, w.by) })),
      }))
      .sort((a, b) => b.warnings.at(-1).at - a.warnings.at(-1).at);
    res.json({ modLogChannelId: req.g.config.modLogChannelId ?? null, warnings });
  });
  api.put('/guilds/:gid/moderation', (req, res) => {
    req.g.config.modLogChannelId = optionalText(req.guild, req.body?.modLogChannelId)?.id ?? null;
    db.save();
    ok(res);
  });
  api.delete('/guilds/:gid/warnings/:userId', (req, res) => {
    ok(res, { removed: clearWarns(req.guild.id, req.params.userId) });
  });
  api.delete('/guilds/:gid/warnings/:userId/:warnId', (req, res) => {
    ok(res, { removed: clearWarns(req.guild.id, req.params.userId, Number(req.params.warnId)) });
  });

  // ---------- games ----------
  api.get('/guilds/:gid/games', (req, res) => {
    res.json({
      kaladont: kaladont.activeGames(req.guild.id).map((k) => ({
        ...k,
        channelName: req.guild.channels.cache.get(k.channelId)?.name ?? 'obrisan-kanal',
        lastUser: k.lastUserId ? userInfo(req.guild, k.lastUserId) : null,
      })),
      toplo: toplo.activeGames(req.guild.id).map((k) => ({
        ...k,
        channelName: req.guild.channels.cache.get(k.channelId)?.name ?? 'obrisan-kanal',
      })),
    });
  });
  api.post('/guilds/:gid/games/kaladont', async (req, res) => {
    await kaladont.start(textChannel(req.guild, req.body?.channelId));
    ok(res);
  });
  api.delete('/guilds/:gid/games/kaladont/:channelId', (req, res) => {
    // works for deleted channels too
    kaladont.stop({ id: req.params.channelId, guild: req.guild });
    ok(res);
  });
  api.post('/guilds/:gid/games/toplo', async (req, res) => {
    await toplo.start(textChannel(req.guild, req.body?.channelId));
    ok(res);
  });
  api.delete('/guilds/:gid/games/toplo/:channelId', (req, res) => {
    toplo.stop({ id: req.params.channelId, guild: req.guild });
    ok(res);
  });

  // ---------- social notifications ----------
  const socialPayload = (guild) => {
    const cfg = socialAlerts.getConfig(guild.id);
    const channel = cfg.channelId && guild.channels.cache.get(cfg.channelId);
    const role = cfg.roleId && guild.roles.cache.get(cfg.roleId);
    return {
      config: cfg,
      channel: channel ? { id: channel.id, name: channel.name } : null,
      role: role ? { id: role.id, name: role.name } : null,
      accounts: cfg.accounts.map((a) => socialAlerts.accountSummary(a)),
      platforms: Object.entries(socialAlerts.PLATFORMS).map(([key, def]) => ({ key, label: def.label, events: def.events })),
      defaultMessage: socialAlerts.DEFAULT_MESSAGE,
      pollMinutes: socialAlerts.pollMinutes,
    };
  };
  api.get('/guilds/:gid/social', (req, res) => res.json(socialPayload(req.guild)));
  api.put('/guilds/:gid/social', (req, res) => {
    const body = req.body ?? {};
    const enabled = Boolean(body.enabled);
    let channelId = null;
    if (body.channelId) channelId = textChannel(req.guild, body.channelId).id;
    if (enabled && !channelId) throw new UserError('Odaberi kanal za obavijesti.');
    let roleId = null;
    if (body.roleId) {
      const role = req.guild.roles.cache.get(String(body.roleId));
      if (!role) throw new UserError('Odabrana rola više ne postoji.');
      roleId = role.id;
    }
    socialAlerts.saveConfig(req.guild.id, {
      enabled,
      channelId,
      roleId,
      message: String(body.message ?? '').slice(0, 2000),
    });
    ok(res, socialPayload(req.guild));
  });
  api.post('/guilds/:gid/social/accounts', (req, res) => {
    const body = req.body ?? {};
    if (!socialAlerts.PLATFORMS[body.platform]) throw new UserError('Odaberi platformu.');
    try {
      const account = socialAlerts.addAccount(req.guild.id, body);
      ok(res, { account: socialAlerts.accountSummary(account), ...socialPayload(req.guild) });
    } catch (err) {
      throw err instanceof UserError ? err : new UserError(err.message);
    }
  });
  api.put('/guilds/:gid/social/accounts/:id', (req, res) => {
    try {
      const account = socialAlerts.updateAccount(req.guild.id, req.params.id, req.body ?? {});
      ok(res, { account: socialAlerts.accountSummary(account), ...socialPayload(req.guild) });
    } catch (err) {
      throw err instanceof UserError ? err : new UserError(err.message);
    }
  });
  api.delete('/guilds/:gid/social/accounts/:id', (req, res) => {
    socialAlerts.removeAccount(req.guild.id, req.params.id);
    ok(res, socialPayload(req.guild));
  });
  api.post('/guilds/:gid/social/check', async (req, res) => {
    const result = await socialAlerts.checkGuild(req.guild, { notify: Boolean(req.body?.notify) });
    ok(res, { ...result, ...socialPayload(req.guild) });
  });
  api.post('/guilds/:gid/social/test', async (req, res) => {
    try {
      await socialAlerts.testNotification(req.guild, req.body?.accountId);
      ok(res);
    } catch (err) {
      throw err instanceof UserError ? err : new UserError(err.message);
    }
  });

  // ---------- birthdays ----------
  const birthdayPayload = (guild) => {
    const cfg = birthdays.getConfig(guild.id);
    const channel = cfg.channelId && guild.channels.cache.get(cfg.channelId);
    const role = cfg.roleId && guild.roles.cache.get(cfg.roleId);
    const today = birthdays.localParts(new Date(), cfg.timezone);
    return {
      config: cfg,
      channel: channel ? { id: channel.id, name: channel.name } : null,
      role: role ? { id: role.id, name: role.name } : null,
      today,
      defaultMessage: birthdays.DEFAULT_MESSAGE,
      birthdays: birthdays.listBirthdays(guild.id, { timeZone: cfg.timezone }).map((entry) => ({
        ...entry,
        user: userInfo(guild, entry.userId),
        next: entry.next
          ? { ...entry.next, date: entry.next.date.toISOString(), age: birthdays.ageOn(entry, entry.next.year) }
          : null,
      })),
    };
  };
  api.get('/guilds/:gid/birthdays', (req, res) => res.json(birthdayPayload(req.guild)));
  api.put('/guilds/:gid/birthdays', (req, res) => {
    const body = req.body ?? {};
    const current = birthdays.getConfig(req.guild.id);
    const input = {};
    if ('enabled' in body) input.enabled = Boolean(body.enabled);
    if ('channelId' in body) {
      input.channelId = body.channelId ? textChannel(req.guild, body.channelId).id : null;
    }
    const nextEnabled = 'enabled' in body ? Boolean(body.enabled) : current.enabled;
    const nextChannel = 'channelId' in input ? input.channelId : current.channelId;
    if (nextEnabled && !nextChannel) throw new UserError('Odaberi kanal za rođendanske čestitke.');
    if ('roleId' in body) {
      if (body.roleId) {
        const role = req.guild.roles.cache.get(String(body.roleId));
        if (!role) throw new UserError('Odabrana rola više ne postoji.');
        const problem = roleProblem(req.guild, role);
        if (problem) throw new UserError(problem.replace(/\*\*/g, '').replace(/<@&\d+>/g, role.name));
        input.roleId = role.id;
      } else input.roleId = null;
    }
    if ('hour' in body) input.hour = Number(body.hour);
    if ('message' in body) input.message = String(body.message ?? '').slice(0, 2000);
    birthdays.saveConfig(req.guild.id, input);
    ok(res, birthdayPayload(req.guild));
  });
  api.delete('/guilds/:gid/birthdays/:userId', (req, res) => {
    ok(res, { removed: birthdays.removeBirthday(req.guild.id, req.params.userId), ...birthdayPayload(req.guild) });
  });
  api.post('/guilds/:gid/birthdays/test', async (req, res) => {
    try {
      await birthdays.sendTest(req.guild, req.member);
      ok(res);
    } catch (err) {
      throw err instanceof UserError ? err : new UserError(err.message);
    }
  });

  // ---------- send message / embed ----------
  api.post('/guilds/:gid/messages/send', async (req, res) => {
    const channel = textChannel(req.guild, req.body?.channelId);
    try {
      const message = await sendMessage(channel, req.body ?? {});
      ok(res, { url: message.url, messageId: message.id, channelId: channel.id });
    } catch (err) {
      throw err instanceof UserError ? err : new UserError(err.message || `Ne mogu slati poruke u #${channel.name}.`);
    }
  });

  // ---------- music ----------
  api.get('/guilds/:gid/music', (req, res) => res.json(music.snapshot(req.guild.id)));
  api.post('/guilds/:gid/music/play', async (req, res) => {
    const query = String(req.body?.query ?? '').trim().slice(0, 500);
    if (!query) throw new UserError('Upiši naziv pjesme ili link.');
    let voiceChannel = null;
    if (!music.getQueue(req.guild.id)) {
      voiceChannel = req.guild.channels.cache.get(req.body?.voiceChannelId);
      if (!voiceChannel?.isVoiceBased()) throw new UserError('Odaberi voice kanal.');
    }
    const { added } = await music.play({
      guild: req.guild,
      voiceChannel,
      textChannel: null,
      query,
      requestedBy: { id: req.member.id, name: req.member.displayName },
    });
    ok(res, { added: added.length, title: added[0].title });
  });
  for (const action of ['pause', 'resume', 'skip', 'stop', 'shuffle']) {
    api.post(`/guilds/:gid/music/${action}`, (req, res) => {
      music.control(req.guild.id, action);
      ok(res);
    });
  }
  api.put('/guilds/:gid/music/loop', (req, res) => {
    music.control(req.guild.id, 'loop', req.body?.mode);
    ok(res);
  });
  api.delete('/guilds/:gid/music/queue/:index', (req, res) => {
    music.control(req.guild.id, 'remove', Number(req.params.index));
    ok(res);
  });

  api.use((req, res) => res.status(404).json({ error: 'Ne postoji.' }));
  api.use((err, req, res, next) => {
    if (err instanceof UserError) return res.status(400).json({ error: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Neispravan JSON.' });
    console.error('[dashboard]', err);
    res.status(500).json({ error: 'Došlo je do greške na serveru. Pokušaj ponovno.' });
  });

  app.use('/api', api);
  app.listen(port, process.env.HOST || undefined, () => console.log(`🌐 Dashboard: ${baseUrl}`));

  // forget expired sessions
  setInterval(() => {
    for (const [sid, s] of sessions) if (s.expires < Date.now()) sessions.delete(sid);
  }, 60 * 60 * 1000).unref();
}
