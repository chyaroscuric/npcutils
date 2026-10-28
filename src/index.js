import http from 'node:http';
import { ActivityType, Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import * as db from './db.js';
import { loadCommands } from './loadCommands.js';
import * as giveaways from './features/giveaways.js';
import * as invites from './features/invites.js';
import * as members from './features/members.js';
import * as reactionRoles from './features/reactionRoles.js';
import { scheduleStatsUpdate } from './features/stats.js';
import * as tickets from './features/tickets.js';
import { fail } from './utils/helpers.js';

const BOT_NAME = 'NPC Utils';

try {
  process.loadEnvFile();
} catch {
  // no .env file, use real environment variables
}

const { DISCORD_TOKEN, GUILD_ID, PORT } = process.env;
if (!DISCORD_TOKEN) {
  console.error('Nedostaje DISCORD_TOKEN. Kopiraj .env.example u .env i upiši token bota.');
  process.exit(1);
}

db.load();
const commands = await loadCommands();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User, Partials.GuildMember],
  presence: {
    status: 'online',
    activities: [{ name: '/help • NPC Utils', type: ActivityType.Watching }],
  },
});

// Runs an async handler and logs errors instead of crashing.
const safe =
  (label, fn) =>
  async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error(`[${label}]`, err);
    }
  };

async function prepareGuild(guild) {
  await guild.members.fetch().catch((err) => console.warn(`[members] ${guild.name}:`, err.message));
  await invites.cacheGuildInvites(guild).catch((err) => console.warn(`[invites] ${guild.name}:`, err.message));
  scheduleStatsUpdate(guild, 2000);
}

client.once(Events.ClientReady, async () => {
  console.log(`✅ ${client.user.tag} je online na ${client.guilds.cache.size} server(a).`);

  if (client.user.username !== BOT_NAME) {
    await client.user.setUsername(BOT_NAME).catch((err) => console.warn('[name] Ne mogu promijeniti ime bota:', err.message));
  }

  const body = [...commands.values()].map((c) => c.data.toJSON());
  try {
    if (GUILD_ID) {
      const guild = await client.guilds.fetch(GUILD_ID);
      await guild.commands.set(body);
      console.log(`Registrirano ${body.length} komandi na serveru ${guild.name}.`);
    } else {
      await client.application.commands.set(body);
      console.log(`Registrirano ${body.length} globalnih komandi.`);
    }
  } catch (err) {
    console.error('[commands] Registracija komandi nije uspjela:', err);
  }

  for (const guild of client.guilds.cache.values()) await prepareGuild(guild);
  giveaways.start(client);

  // safety net in case some event was missed
  setInterval(() => client.guilds.cache.forEach((guild) => scheduleStatsUpdate(guild)), 10 * 60 * 1000);
});

client.on(Events.GuildCreate, safe('guildCreate', prepareGuild));

client.on(
  Events.GuildMemberAdd,
  safe('memberAdd', async (member) => {
    const { inviterId } = await invites.onMemberJoin(member).catch((err) => {
      console.error('[invites]', err);
      return { inviterId: null };
    });
    await members.giveAutoroles(member).catch((err) => console.error('[autorole]', err));
    await members.sendWelcome(member, inviterId).catch((err) => console.error('[welcome]', err));
    scheduleStatsUpdate(member.guild);
  }),
);

client.on(
  Events.GuildMemberRemove,
  safe('memberRemove', async (member) => {
    invites.onMemberLeave(member);
    scheduleStatsUpdate(member.guild);
  }),
);

client.on(
  Events.GuildMemberUpdate,
  safe('memberUpdate', async (oldMember, newMember) => {
    if (oldMember.premiumSinceTimestamp !== newMember.premiumSinceTimestamp) scheduleStatsUpdate(newMember.guild);
    await members.onMemberUpdate(oldMember, newMember);
  }),
);

client.on(
  Events.GuildUpdate,
  safe('guildUpdate', async (oldGuild, newGuild) => {
    if (oldGuild.premiumSubscriptionCount !== newGuild.premiumSubscriptionCount) scheduleStatsUpdate(newGuild);
  }),
);

client.on(Events.InviteCreate, safe('inviteCreate', invites.onInviteCreate));
client.on(Events.InviteDelete, safe('inviteDelete', invites.onInviteDelete));
client.on(Events.ChannelDelete, safe('channelDelete', tickets.onChannelDelete));
client.on(
  Events.MessageDelete,
  safe('messageDelete', async (message) => {
    reactionRoles.onMessageDelete(message);
    giveaways.onMessageDelete(message);
  }),
);
client.on(Events.MessageReactionAdd, safe('reactionAdd', reactionRoles.onReactionAdd));
client.on(Events.MessageReactionRemove, safe('reactionRemove', reactionRoles.onReactionRemove));

const componentHandlers = {
  ticket: tickets.handleComponent,
  giveaway: giveaways.handleComponent,
};

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.inGuild()) return;
  try {
    if (interaction.isChatInputCommand()) {
      await commands.get(interaction.commandName)?.execute(interaction);
    } else if (interaction.isButton() || interaction.isModalSubmit()) {
      await componentHandlers[interaction.customId.split(':')[0]]?.(interaction);
    }
  } catch (err) {
    console.error(`[interaction] ${interaction.commandName ?? interaction.customId}`, err);
    if (interaction.isRepliable()) await fail(interaction, 'Došlo je do greške. Pokušaj ponovno.').catch(() => {});
  }
});

client.on(Events.Error, (err) => console.error('[client]', err));
client.on(Events.Warn, (msg) => console.warn('[client]', msg));
client.on(Events.ShardDisconnect, (_, id) => console.warn(`[shard ${id}] Veza prekinuta, spajam se ponovno...`));
client.on(Events.ShardResume, (id) => console.log(`[shard ${id}] Ponovno spojen.`));

process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => {
  // let the process manager (Docker / pm2) restart the bot from a clean state
  console.error('[uncaughtException]', err);
  shutdown(1);
});

function shutdown(code = 0) {
  try {
    db.flush();
  } catch (err) {
    console.error('[db]', err);
  }
  client.destroy().finally(() => process.exit(code));
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// Optional HTTP endpoint for hosts that need an open port / uptime monitors (UptimeRobot etc.).
if (PORT) {
  http
    .createServer((req, res) => {
      const online = client.isReady();
      res.writeHead(online ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ bot: BOT_NAME, online, ping: client.ws.ping, uptime: client.uptime }));
    })
    .listen(PORT, () => console.log(`Keep-alive server na portu ${PORT}`));
}

try {
  await client.login(DISCORD_TOKEN);
} catch (err) {
  console.error('Prijava nije uspjela (provjeri DISCORD_TOKEN i privileged intente):', err.message);
  process.exit(1);
}
