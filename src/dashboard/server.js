// Web dashboard: Discord login + JSON API used by public/app.js. Also serves /health for uptime monitors.
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import * as db from '../db.js';
import { recentActivity } from '../features/activity.js';
import * as giveaways from '../features/giveaways.js';
import * as invites from '../features/invites.js';
import { DEFAULT_BOOST, DEFAULT_WELCOME, boostPayload, welcomePayload } from '../features/members.js';
import * as music from '../features/music.js';
import * as reactionRoles from '../features/reactionRoles.js';
import { STATS, removeStats, setupStats } from '../features/stats.js';
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
  const { CLIENT_SECRET } = process.env;
  const baseUrl = (process.env.DASHBOARD_URL || `http://localhost:${port}`).replace(/\/$/, '');
  const secureCookies = baseUrl.startsWith('https://');
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.get('/health', (req, res) => {
    const online = client.isReady();
    res.status(online ? 200 : 503).json({ bot: client.user?.username ?? null, online, ping: client.ws.ping, uptime: client.uptime });
  });

  if (!CLIENT_SECRET) {
    console.warn('[dashboard] CLIENT_SECRET nije postavljen, dashboard je isključen (radi samo /health).');
    app.listen(port, () => console.log(`Health endpoint na portu ${port}`));
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

  app.use(express.static(fileURLToPath(new URL('./public/', import.meta.url)), { index: 'index.html', maxAge: '1h' }));

  // ---------- API ----------
  const api = express.Router();
  api.use(express.json({ limit: '100kb' }));

  api.use((req, res, next) => {
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

  const manageableGuilds = (userId) =>
    client.guilds.cache.filter((g) => g.members.cache.get(userId)?.permissions.has(PermissionFlagsBits.ManageGuild));

  api.get('/me', async (req, res) => {
    const user = await client.users.fetch(req.userId);
    res.json({
      user: { id: user.id, username: user.username, displayName: user.globalName ?? user.username, avatarUrl: avatarOf(user) },
      guilds: manageableGuilds(req.userId).map((g) => ({ id: g.id, name: g.name, iconUrl: g.iconURL({ size: 128 }), memberCount: g.memberCount })),
      bot: {
        id: client.user.id,
        name: client.user.username,
        avatarUrl: avatarOf(client.user),
        inviteUrl: `https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands`,
        ping: client.ws.ping,
        uptimeMs: client.uptime,
      },
    });
  });

  // every /guilds/:gid route: the user must have Manage Server on that server right now
  api.param('gid', async (req, res, next, gid) => {
    const guild = client.guilds.cache.get(gid);
    const member = guild && (guild.members.cache.get(req.userId) ?? (await guild.members.fetch(req.userId).catch(() => null)));
    if (!member?.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return res.status(403).json({ error: 'Nemaš pristup ovom serveru.' });
    }
    req.guild = guild;
    req.member = member;
    req.g = db.guild(guild.id);
    next();
  });

  const textChannel = (guild, id) => {
    const ch = id && guild.channels.cache.get(id);
    if (!ch || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(ch.type)) throw new UserError('Odaberi tekstualni kanal.');
    return ch;
  };
  const optionalText = (guild, id) => (id ? textChannel(guild, id) : null);
  const ok = (res, extra = {}) => res.json({ ok: true, ...extra });

  api.get('/guilds/:gid', (req, res) => {
    const { guild, g } = req;
    const channels = [...guild.channels.cache.values()].sort((a, b) => a.rawPosition - b.rawPosition);
    const pick = (types) =>
      channels.filter((c) => types.includes(c.type)).map((c) => ({ id: c.id, name: c.name, parentName: c.parent?.name ?? null }));
    const bots = guild.members.cache.filter((m) => m.user.bot).size;
    const statsCfg = g.config.stats;
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
          defaultMessage: DEFAULT_WELCOME,
        },
        boost: {
          enabled: Boolean(g.config.boost),
          channelId: g.config.boost?.channelId ?? null,
          message: g.config.boost?.message ?? '',
          defaultMessage: DEFAULT_BOOST,
        },
        autoroles: g.config.autoroles ?? [],
        stats: {
          enabled: Boolean(statsCfg),
          channels: Object.fromEntries(
            Object.keys(STATS).map((key) => {
              const ch = statsCfg?.[key] && guild.channels.cache.get(statsCfg[key]);
              return [key, ch ? { id: ch.id, name: ch.name } : null];
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
      },
      activity: recentActivity(guild.id),
    });
  });

  // ---------- welcome / boost / autoroles ----------
  for (const kind of ['welcome', 'boost']) {
    api.put(`/guilds/:gid/${kind}`, (req, res) => {
      const { enabled, channelId, message } = req.body ?? {};
      if (!enabled) delete req.g.config[kind];
      else {
        const channel = textChannel(req.guild, channelId);
        const text = String(message ?? '').trim();
        if (text.length > 2000) throw new UserError('Poruka može imati najviše 2000 znakova.');
        req.g.config[kind] = { channelId: channel.id, message: text || null };
      }
      db.save();
      ok(res);
    });
    api.post(`/guilds/:gid/${kind}/test`, async (req, res) => {
      const cfg = req.g.config[kind];
      const channel = cfg && req.guild.channels.cache.get(cfg.channelId);
      if (!channel) throw new UserError('Prvo uključi i spremi poruku.');
      const payload = kind === 'welcome' ? welcomePayload(req.member, req.g.joins[req.userId]?.inviterId ?? null) : boostPayload(req.member);
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
  api.post('/guilds/:gid/stats', async (req, res) => {
    if (!req.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) throw new UserError('Bot treba permisiju Manage Channels.');
    await req.guild.members.fetch();
    await setupStats(req.guild);
    ok(res);
  });
  api.delete('/guilds/:gid/stats', async (req, res) => {
    await removeStats(req.guild);
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
  app.listen(port, () => console.log(`🌐 Dashboard: ${baseUrl}`));

  // forget expired sessions
  setInterval(() => {
    for (const [sid, s] of sessions) if (s.expires < Date.now()) sessions.delete(sid);
  }, 60 * 60 * 1000).unref();
}
