// Mafia: a button-driven social deduction game. Lobby -> night actions -> day
// discussion -> vote. State is in memory, so a bot restart cancels running games.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import * as db from '../../db.js';
import { UserError } from '../../utils/helpers.js';

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 15;
const LOBBY_MS = 5 * 60 * 1000;
const NIGHT_MS = 60_000;
const DAY_MS = 90_000;
const VOTE_MS = 60_000;
const WIN_POINTS = 35;
const LOSE_POINTS = -3;

const COLOR_LOBBY = 0x5865f2;
const COLOR_NIGHT = 0x3b82f6;
const COLOR_DAY = 0xf59e0b;
const COLOR_VOTE = 0xf97316;
const COLOR_WIN = 0x57f287;
const COLOR_LOSE = 0xed4245;

export const ROLES = {
  mafia: {
    label: 'Mafija',
    emoji: '🔪',
    color: 0xed4245,
    desc: 'Svake noći biraš žrtvu. Cilj ti je eliminirati sve građane.',
    action: 'Ubojstvo',
  },
  detective: {
    label: 'Detektiv',
    emoji: '🔍',
    color: 0x3b82f6,
    desc: 'Svake noći istražuješ jednog igrača i saznaš je li mafija.',
    action: 'Istraga',
  },
  doctor: {
    label: 'Doktor',
    emoji: '💉',
    color: 0x57f287,
    desc: 'Svake noći štitiš jednog igrača od mafije. Možeš zaštititi i sebe.',
    action: 'Zaštita',
  },
  dama: {
    label: 'Dama',
    emoji: '💃',
    color: 0xf472b6,
    desc: 'Svake noći zavedeš jednog igrača i blokiraš njegovu noćnu akciju.',
    action: 'Zavođenje',
  },
  citizen: {
    label: 'Građanin',
    emoji: '👤',
    color: 0x9ca3af,
    desc: 'Nemaš noćnu akciju. Danju raspravljaš i glasaš za mafiju.',
    action: null,
  },
};

const games = new Map(); // channelId -> game

const now = () => Date.now();
const alive = (game) => game.players.filter((p) => p.alive);
const playerOf = (game, userId) => game.players.find((p) => p.id === userId);
const mafiaAlive = (game) => alive(game).filter((p) => p.role === 'mafia');
const townAlive = (game) => alive(game).filter((p) => p.role !== 'mafia');
const roleInfo = (role) => ROLES[role] ?? ROLES.citizen;
const pointsFor = (win) => (win ? WIN_POINTS : LOSE_POINTS);

function shuffled(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function playerList(game) {
  return alive(game).map((p, i) => `**${i + 1}.** ${p.name}`).join('\n') || 'Nitko';
}

function roleList(game, deltas = null) {
  return game.players.map((p) => {
    const role = roleInfo(p.role);
    const delta = deltas?.[p.id];
    return `${p.alive ? '' : '~~'}${p.name}${p.alive ? '' : '~~'} — ${role.emoji} ${role.label}${delta == null ? '' : ` (${delta >= 0 ? '+' : ''}${delta})`}`;
  }).join('\n');
}

function roleEmbed(player) {
  const role = roleInfo(player.role);
  return new EmbedBuilder()
    .setColor(role.color)
    .setTitle(`${role.emoji} Tvoja uloga: ${role.label}`)
    .setDescription(`${role.desc}\n\n${player.alive ? 'Još si u igri.' : 'Eliminiran/a si, ali možeš pratiti igru.'}`)
    .setFooter({ text: 'Ulogu ne otkrivaj drugima.' });
}

function lobbyPayload(game) {
  const embed = new EmbedBuilder()
    .setColor(COLOR_LOBBY)
    .setTitle('🕵️ Mafija — okupljanje')
    .setDescription(
      `Domaćin: <@${game.hostId}>\n\n**Igrači (${game.players.length}/${MAX_PLAYERS}):**\n` +
        (game.players.map((p, i) => `**${i + 1}.** ${p.name}`).join('\n') || 'Nitko još nije ušao.') +
        `\n\nPotrebno je barem **${MIN_PLAYERS}** igrača. Klikni **Pridruži se**, a domaćin pokreće igru.`,
    )
    .setFooter({ text: 'Mafija, detektiv, doktor, dama i građani. Uloge se dijele tajno.' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mafia:join').setLabel('Pridruži se').setEmoji('🙋').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('mafia:leave').setLabel('Napusti').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mafia:start').setLabel('Počni igru').setEmoji('▶️').setStyle(ButtonStyle.Success).setDisabled(game.players.length < MIN_PLAYERS),
    new ButtonBuilder().setCustomId('mafia:cancel').setLabel('Otkaži').setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row] };
}

export const getGame = (channelId) => games.get(channelId) ?? null;

export function activeGames(guildId) {
  return [...games.values()]
    .filter((game) => game.guildId === guildId)
    .map((game) => ({
      channelId: game.channelId,
      phase: game.phase,
      day: game.day,
      playerCount: game.players.length,
      aliveCount: alive(game).length,
      hostId: game.hostId,
    }));
}

export async function start(channel, host) {
  if (games.has(channel.id)) throw new UserError('Mafija već traje u ovom kanalu. Zaustavi ju s `/mafia stop`.');
  const game = {
    channelId: channel.id,
    guildId: channel.guild.id,
    channel,
    hostId: host.id,
    players: [{ id: host.id, name: host.displayName ?? host.user?.username ?? 'Igrač', role: null, alive: true }],
    phase: 'lobby',
    day: 0,
    actions: new Map(),
    votes: new Map(),
    timer: null,
    message: null,
    startedAt: now(),
  };
  games.set(channel.id, game);
  game.message = await channel.send(lobbyPayload(game));
  game.timer = setTimeout(() => cancel(game, 'lobby-timeout').catch(() => {}), LOBBY_MS);
  game.timer.unref?.();
  return game;
}

function clearTimer(game) {
  if (game.timer) clearTimeout(game.timer);
  game.timer = null;
}

export function stop(channel) {
  const game = games.get(channel.id);
  if (!game) throw new UserError('U ovom kanalu ne traje mafija.');
  clearTimer(game);
  games.delete(channel.id);
  return game;
}

async function cancel(game, reason = 'cancelled') {
  if (!games.has(game.channelId)) return;
  clearTimer(game);
  games.delete(game.channelId);
  const title = reason === 'lobby-timeout' ? '⏰ Igra je otkazana zbog neaktivnosti' : '🛑 Mafija je otkazana';
  const embed = new EmbedBuilder()
    .setColor(COLOR_LOSE)
    .setTitle(title)
    .setDescription(reason === 'lobby-timeout' ? 'Nitko nije pokrenuo igru na vrijeme.\n\n`/mafia start` za novu igru!' : 'Domaćin je otkazao igru.\n\n`/mafia start` za novu igru!');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mafia:again').setLabel('Nova igra').setEmoji('🔁').setStyle(ButtonStyle.Primary),
  );
  await game.message?.edit({ embeds: [embed], components: [row] }).catch(() => {});
}

export function roleDistribution(count) {
  const mafiaCount = count >= 9 ? 3 : count >= 6 ? 2 : 1;
  const roles = Array(mafiaCount).fill('mafia');
  roles.push('detective', 'doctor');
  if (count >= 6) roles.push('dama');
  while (roles.length < count) roles.push('citizen');
  return roles.slice(0, count);
}

function assignRoles(game) {
  const shuffledRoles = shuffled(roleDistribution(game.players.length));
  game.players.forEach((player, i) => {
    player.role = shuffledRoles[i];
    player.alive = true;
  });
}

async function startGame(game, interaction) {
  if (game.players.length < MIN_PLAYERS) throw new UserError(`Potrebno je barem ${MIN_PLAYERS} igrača.`);
  assignRoles(game);
  game.phase = 'night';
  game.day = 1;
  game.startedAt = now();
  game.actions = new Map();
  game.votes = new Map();
  for (const player of game.players) {
    const member = game.channel.guild.members.cache.get(player.id)
      ?? await game.channel.guild.members.fetch(player.id).catch(() => null);
    await member?.send({ embeds: [roleEmbed(player)] }).catch(() => {});
  }
  await interaction?.update?.(nightPayload(game)).catch(() => {});
  if (!interaction) await game.message?.edit(nightPayload(game)).catch(() => {});
  clearTimer(game);
  game.timer = setTimeout(() => resolveNight(game).catch((err) => console.error('[mafia] night timeout', err)), NIGHT_MS);
  game.timer.unref?.();
}

function nightPayload(game) {
  const submitted = [...game.actions.keys()].length;
  const embed = new EmbedBuilder()
    .setColor(COLOR_NIGHT)
    .setTitle(`🌙 Noć ${game.day}`)
    .setDescription(
      'Grad spava...\n\n**Živi igrači:**\n' +
        playerList(game) +
        `\n\nIgrači s posebnim ulogama trebaju izvršiti svoje akcije.\nAkcije su predane: **${submitted}**`,
    )
    .setFooter({ text: 'Noćne akcije su tajne! Vrijeme: 60 sekundi.' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mafia:action').setLabel('Izvrši akciju').setEmoji('🌙').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('mafia:role').setLabel('Uloga').setEmoji('🎭').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

function actionMenu(game, player) {
  const role = roleInfo(player.role);
  const options = alive(game)
    .filter((p) => p.id !== player.id || player.role === 'doctor')
    .filter((p) => !(player.role === 'mafia' && p.role === 'mafia'))
    .slice(0, 25)
    .map((p) => new StringSelectMenuOptionBuilder().setLabel(p.name.slice(0, 100)).setValue(p.id));
  if (!options.length) return null;
  const menu = new StringSelectMenuBuilder()
    .setCustomId(`mafia:target:${player.role}`)
    .setPlaceholder(`${role.action}: odaberi igrača`)
    .addOptions(options);
  return new ActionRowBuilder().addComponents(menu);
}

async function resolveNight(game) {
  if (!games.has(game.channelId) || game.phase !== 'night') return;
  clearTimer(game);
  const mafia = mafiaAlive(game);
  const doctor = alive(game).find((p) => p.role === 'doctor');
  const detective = alive(game).find((p) => p.role === 'detective');
  const dama = alive(game).find((p) => p.role === 'dama');
  const doctorTarget = doctor ? game.actions.get(doctor.id)?.targetId : null;
  const damaTarget = dama ? game.actions.get(dama.id)?.targetId : null;

  // The lady blocks one mafia member's vote.
  const votes = new Map();
  for (const m of mafia) {
    if (damaTarget === m.id) continue;
    const target = game.actions.get(m.id)?.targetId;
    if (!target) continue;
    votes.set(target, (votes.get(target) ?? 0) + 1);
  }
  let targetId = null;
  let best = 0;
  for (const [id, count] of votes) {
    if (count > best) {
      best = count;
      targetId = id;
    } else if (count === best && targetId && Math.random() < 0.5) {
      targetId = id;
    }
  }
  let victim = targetId && alive(game).find((p) => p.id === targetId);
  if (victim && doctorTarget === victim.id) victim = null;
  if (victim) victim.alive = false;

  if (detective) {
    const target = game.actions.get(detective.id)?.targetId;
    const found = target && game.players.find((p) => p.id === target);
    if (found) {
      const member = game.channel.guild.members.cache.get(detective.id);
      await member?.send({
        embeds: [
          new EmbedBuilder()
            .setColor(COLOR_NIGHT)
            .setTitle('🔍 Rezultat istrage')
            .setDescription(`**${found.name}** ${found.role === 'mafia' ? 'JE mafija.' : 'NIJE mafija.'}`),
        ],
      }).catch(() => {});
    }
  }

  game.actions = new Map();
  if (checkWin(game)) return;
  game.phase = 'day';
  await game.message?.edit(dayPayload(game, victim)).catch(() => {});
  game.timer = setTimeout(() => startVote(game).catch((err) => console.error('[mafia] day timeout', err)), DAY_MS);
  game.timer.unref?.();
}

function dayPayload(game, victim) {
  const text = victim
    ? `**${victim.name}** je ubijen/a!\n\nMafija je bila aktivna.`
    : 'Nitko nije ubijen ove noći.\n\nDoktor je možda nekoga spasio...';
  const embed = new EmbedBuilder()
    .setColor(COLOR_DAY)
    .setTitle(`☀️ Dan ${game.day}`)
    .setDescription(`${text}\n\n**Živi igrači:**\n${playerList(game)}\n\nRaspravite i pripremite se za glasanje.`)
    .setFooter({ text: 'Rasprava traje 90 sekundi.' });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mafia:role').setLabel('Uloga').setEmoji('🎭').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

async function startVote(game) {
  if (!games.has(game.channelId) || game.phase !== 'day') return;
  clearTimer(game);
  game.phase = 'vote';
  game.votes = new Map();
  const embed = new EmbedBuilder()
    .setColor(COLOR_VOTE)
    .setTitle(`🗳️ Glasanje — Dan ${game.day}`)
    .setDescription(`Glasajte za osobu koju želite eliminirati.\n\n**Živi igrači:**\n${playerList(game)}\n\nGlasanje traje 60 sekundi.`)
    .setFooter({ text: 'Preskoči glas ako ne želiš nikoga eliminirati.' });
  const options = alive(game).slice(0, 25).map((p) => new StringSelectMenuOptionBuilder().setLabel(p.name.slice(0, 100)).setValue(p.id));
  const menu = new StringSelectMenuBuilder().setCustomId('mafia:vote-select').setPlaceholder('Glasaj za eliminaciju').addOptions(options);
  const row = new ActionRowBuilder().addComponents(menu);
  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mafia:skip').setLabel('Preskoči glas').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mafia:role').setLabel('Uloga').setEmoji('🎭').setStyle(ButtonStyle.Secondary),
  );
  await game.message?.edit({ embeds: [embed], components: [row, buttons] }).catch(() => {});
  game.timer = setTimeout(() => resolveVote(game).catch((err) => console.error('[mafia] vote timeout', err)), VOTE_MS);
  game.timer.unref?.();
}

async function resolveVote(game) {
  if (!games.has(game.channelId) || game.phase !== 'vote') return;
  clearTimer(game);
  const counts = new Map();
  const voteLines = [];
  for (const [voterId, targetId] of game.votes) {
    const voter = game.players.find((p) => p.id === voterId);
    if (!voter || !voter.alive) continue;
    if (targetId === 'skip') {
      voteLines.push(`**${voter.name}** → Preskoči`);
      continue;
    }
    const target = game.players.find((p) => p.id === targetId);
    if (!target || !target.alive) continue;
    voteLines.push(`**${voter.name}** → **${target.name}**`);
    counts.set(targetId, (counts.get(targetId) ?? 0) + 1);
  }
  let eliminatedId = null;
  let best = 0;
  let tie = false;
  for (const [id, count] of counts) {
    if (count > best) {
      best = count;
      eliminatedId = id;
      tie = false;
    } else if (count === best) {
      tie = true;
    }
  }
  if (tie || !eliminatedId) eliminatedId = null;
  const eliminated = eliminatedId && game.players.find((p) => p.id === eliminatedId);
  if (eliminated) eliminated.alive = false;

  const embed = new EmbedBuilder()
    .setColor(eliminated ? COLOR_LOSE : COLOR_DAY)
    .setTitle(eliminated ? '⚖️ Eliminacija' : '⚖️ Bez eliminacije')
    .setDescription(
      (eliminated
        ? `**${eliminated.name}** je eliminiran/a!\nBio/la je **${roleInfo(eliminated.role).emoji} ${roleInfo(eliminated.role).label}**.\n\n`
        : 'Nije bilo dovoljno glasova ili je rezultat neriješen. Nitko nije eliminiran.\n\n') +
        (voteLines.length ? `**Glasovi:**\n${voteLines.join('\n')}` : 'Nitko nije glasao.'),
    )
    .setFooter({ text: `Dan ${game.day}` });
  game.votes = new Map();
  if (checkWin(game)) return;
  game.phase = 'night';
  game.day += 1;
  game.actions = new Map();
  await game.message?.edit({ embeds: [embed], components: [] }).catch(() => {});
  setTimeout(() => startNightAfterVote(game), 4000).unref?.();
}

async function startNightAfterVote(game) {
  if (!games.has(game.channelId)) return;
  await game.message?.edit(nightPayload(game)).catch(() => {});
  clearTimer(game);
  game.timer = setTimeout(() => resolveNight(game).catch((err) => console.error('[mafia] night timeout', err)), NIGHT_MS);
  game.timer.unref?.();
}

export function winnerFor(players) {
  const living = players.filter((p) => p.alive);
  const mafia = living.filter((p) => p.role === 'mafia').length;
  const town = living.filter((p) => p.role !== 'mafia').length;
  if (mafia === 0) return 'town';
  if (mafia >= town) return 'mafia';
  return null;
}

function checkWin(game) {
  const winner = winnerFor(game.players);
  if (!winner) return false;
  endGame(game, winner).catch((err) => console.error('[mafia] end', err));
  return true;
}

async function endGame(game, winner) {
  if (!games.has(game.channelId)) return;
  clearTimer(game);
  games.delete(game.channelId);
  const deltas = {};
  const g = db.guild(game.guildId);
  g.mafiaScores ??= {};
  for (const player of game.players) {
    const win = winner === 'mafia' ? player.role === 'mafia' : player.role !== 'mafia';
    const delta = pointsFor(win);
    deltas[player.id] = delta;
    const score = (g.mafiaScores[player.id] ??= { points: 0, wins: 0, games: 0 });
    score.points += delta;
    score.wins += win ? 1 : 0;
    score.games += 1;
  }
  db.save();
  const embed = new EmbedBuilder()
    .setColor(winner === 'mafia' ? COLOR_LOSE : COLOR_WIN)
    .setTitle(winner === 'mafia' ? '🔪 Mafija je pobijedila!' : '🎉 Građani su pobijedili!')
    .setDescription(
      (winner === 'mafia' ? 'Mafija je preuzela kontrolu nad gradom!' : 'Sve mafije su eliminirane. Grad je spašen!') +
        `\n\n**Svi igrači:**\n${roleList(game, deltas)}`,
    )
    .setFooter({ text: `Trajanje: ${Math.max(1, Math.round((now() - game.startedAt) / 60000))} min · pobjeda +${WIN_POINTS}, poraz ${LOSE_POINTS}` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mafia:again').setLabel('Nova igra').setEmoji('🔁').setStyle(ButtonStyle.Primary),
  );
  await game.message?.edit({ embeds: [embed], components: [row] }).catch(() => {});
}

function ephemeral(interaction, content, components = []) {
  const payload = { flags: MessageFlags.Ephemeral };
  if (content) payload.content = content;
  if (components.length) payload.components = components;
  if (interaction.deferred || interaction.replied) return interaction.followUp(payload);
  return interaction.reply(payload);
}

export function stats(guildId, userId) {
  const score = db.guild(guildId).mafiaScores?.[userId] ?? { points: 0, wins: 0, games: 0 };
  return { ...score };
}

export async function handleComponent(interaction) {
  const action = interaction.customId.split(':')[1];
  const game = games.get(interaction.channelId);

  if (action === 'again') {
    if (game) return ephemeral(interaction, 'Mafija već traje u ovom kanalu.');
    await start(interaction.channel, interaction.member);
    return ephemeral(interaction, '🔁 Nova mafija je otvorena! Pridruži se u poruci iznad.');
  }

  if (!game) return ephemeral(interaction, 'Mafija trenutno ne traje u ovom kanalu.');

  if (interaction.isStringSelectMenu()) {
    const player = playerOf(game, interaction.user.id);
    if (!player) return ephemeral(interaction, 'Nisi u ovoj igri.');
    if (action === 'target') {
      if (game.phase !== 'night') return ephemeral(interaction, 'Noćne akcije su završile.');
      if (!player.alive) return ephemeral(interaction, 'Eliminiran/a si i ne možeš izvršiti akciju.');
      if (player.role === 'citizen') return ephemeral(interaction, 'Nemaš noćnu akciju.');
      const targetId = interaction.values[0];
      const target = playerOf(game, targetId);
      if (!target || !target.alive) return ephemeral(interaction, 'Odaberi živog igrača.');
      if (player.role === 'mafia' && target.role === 'mafia') return ephemeral(interaction, 'Ne možeš ubiti drugu mafiju.');
      if (player.role !== 'doctor' && target.id === player.id) return ephemeral(interaction, 'Ne možeš odabrati sebe.');
      game.actions.set(player.id, { targetId, at: now() });
      await game.message?.edit(nightPayload(game)).catch(() => {});
      return ephemeral(interaction, `✅ Akcija spremljena: **${target.name}**.`);
    }
    if (action === 'vote-select') {
      if (game.phase !== 'vote') return ephemeral(interaction, 'Glasanje trenutno nije aktivno.');
      if (!player.alive) return ephemeral(interaction, 'Eliminiran/a si i ne možeš glasati.');
      const target = playerOf(game, interaction.values[0]);
      if (!target || !target.alive) return ephemeral(interaction, 'Odaberi živog igrača.');
      if (target.id === player.id) return ephemeral(interaction, 'Ne možeš glasati za sebe.');
      game.votes.set(player.id, target.id);
      return ephemeral(interaction, `🗳️ Glas spremljen: **${target.name}**.`);
    }
    return ephemeral(interaction, 'Nepoznata akcija.');
  }

  if (!interaction.isButton()) return;

  if (action === 'join') {
    if (game.phase !== 'lobby') return ephemeral(interaction, 'Igra je već počela.');
    if (game.players.some((p) => p.id === interaction.user.id)) return ephemeral(interaction, 'Već si u igri.');
    if (game.players.length >= MAX_PLAYERS) return ephemeral(interaction, `Igra je puna (${MAX_PLAYERS} igrača).`);
    game.players.push({ id: interaction.user.id, name: interaction.member.displayName ?? interaction.user.username, role: null, alive: true });
    await interaction.update(lobbyPayload(game)).catch(() => {});
    return;
  }

  if (action === 'leave') {
    if (game.phase !== 'lobby') return ephemeral(interaction, 'Igra je već počela.');
    const index = game.players.findIndex((p) => p.id === interaction.user.id);
    if (index < 0) return ephemeral(interaction, 'Nisi u igri.');
    game.players.splice(index, 1);
    if (game.hostId === interaction.user.id) game.hostId = game.players[0]?.id ?? null;
    if (!game.players.length) {
      await interaction.deferUpdate().catch(() => {});
      return cancel(game, 'cancelled');
    }
    await interaction.update(lobbyPayload(game)).catch(() => {});
    return;
  }

  if (action === 'start') {
    if (game.phase !== 'lobby') return ephemeral(interaction, 'Igra je već počela.');
    if (game.hostId !== interaction.user.id) return ephemeral(interaction, 'Samo domaćin može pokrenuti igru.');
    if (game.players.length < MIN_PLAYERS) return ephemeral(interaction, `Potrebno je barem ${MIN_PLAYERS} igrača.`);
    await startGame(game, interaction);
    return;
  }

  if (action === 'cancel') {
    if (game.hostId !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.ManageChannels)) {
      return ephemeral(interaction, 'Samo domaćin ili moderator može otkazati igru.');
    }
    await interaction.deferUpdate().catch(() => {});
    await cancel(game, 'cancelled');
    return;
  }

  if (action === 'role') {
    const player = playerOf(game, interaction.user.id);
    if (!player) return ephemeral(interaction, 'Nisi u ovoj igri.');
    return ephemeral(interaction, '', [roleEmbed(player)]);
  }

  if (action === 'action') {
    if (game.phase !== 'night') return ephemeral(interaction, 'Noćne akcije trenutno nisu aktivne.');
    const player = playerOf(game, interaction.user.id);
    if (!player) return ephemeral(interaction, 'Nisi u ovoj igri.');
    if (!player.alive) return ephemeral(interaction, 'Eliminiran/a si.');
    if (player.role === 'citizen') return ephemeral(interaction, '👤 Građanin nema noćnu akciju. Čekaj jutro i glasaj.');
    const row = actionMenu(game, player);
    if (!row) return ephemeral(interaction, 'Nema dostupnih meta.');
    return ephemeral(interaction, `🌙 Odaberi metu za **${roleInfo(player.role).action}**.`, [row]);
  }

  if (action === 'skip') {
    if (game.phase !== 'vote') return ephemeral(interaction, 'Glasanje trenutno nije aktivno.');
    const player = playerOf(game, interaction.user.id);
    if (!player || !player.alive) return ephemeral(interaction, 'Ne možeš glasati.');
    game.votes.set(player.id, 'skip');
    return ephemeral(interaction, '⏭️ Preskočio/la si glas.');
  }
}

