// Fishing minigame: /fish catches random fish, stores an inventory and coins.
// Buttons let the player fish again, sell the whole inventory, or close the panel.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags } from 'discord.js';
import * as db from '../../db.js';

const COOLDOWN_MS = 2_000;
const COLOR_FISH = 0x0ea5e9;
const COLOR_SELL = 0x22c55e;

export const RARITIES = {
  junk: { label: 'Smeće', color: 0x71717a },
  common: { label: 'Česta', color: 0x9ca3af },
  uncommon: { label: 'Neuobičajena', color: 0x22c55e },
  rare: { label: 'Rijetka', color: 0x3b82f6 },
  epic: { label: 'Epska', color: 0xa855f7 },
  legendary: { label: 'Legendarna', color: 0xf59e0b },
};

export const FISH = [
  { key: 'cizma', name: 'Stara čizma', emoji: '🥾', rarity: 'junk', value: 0, xp: 1, weight: 8 },
  { key: 'srdela', name: 'Srdela', emoji: '🐟', rarity: 'common', value: 2, xp: 4, weight: 26 },
  { key: 'skusa', name: 'Skuša', emoji: '🐟', rarity: 'common', value: 3, xp: 5, weight: 22 },
  { key: 'cipal', name: 'Cipal', emoji: '🐟', rarity: 'common', value: 4, xp: 5, weight: 18 },
  { key: 'girica', name: 'Girica', emoji: '🐟', rarity: 'common', value: 4, xp: 6, weight: 16 },
  { key: 'oslic', name: 'Oslić', emoji: '🐟', rarity: 'common', value: 5, xp: 6, weight: 14 },
  { key: 'haringa', name: 'Haringa', emoji: '🐟', rarity: 'common', value: 3, xp: 4, weight: 15 },
  { key: 'brancin', name: 'Brancin', emoji: '🐠', rarity: 'uncommon', value: 8, xp: 9, weight: 10 },
  { key: 'pastrva', name: 'Pastrva', emoji: '🐠', rarity: 'uncommon', value: 9, xp: 9, weight: 9 },
  { key: 'orada', name: 'Orada', emoji: '🐠', rarity: 'uncommon', value: 10, xp: 10, weight: 8 },
  { key: 'lignja', name: 'Lignja', emoji: '🦑', rarity: 'uncommon', value: 12, xp: 11, weight: 7 },
  { key: 'losos', name: 'Losos', emoji: '🍣', rarity: 'rare', value: 18, xp: 16, weight: 4 },
  { key: 'tuna', name: 'Tuna', emoji: '🐟', rarity: 'rare', value: 25, xp: 20, weight: 3 },
  { key: 'sabljarka', name: 'Sabljarka', emoji: '🗡️', rarity: 'rare', value: 30, xp: 24, weight: 2 },
  { key: 'zubatac', name: 'Zubatac', emoji: '🐟', rarity: 'rare', value: 28, xp: 22, weight: 2 },
  { key: 'jastog', name: 'Jastog', emoji: '🦞', rarity: 'epic', value: 45, xp: 32, weight: 1 },
  { key: 'hobotnica', name: 'Hobotnica', emoji: '🐙', rarity: 'epic', value: 40, xp: 30, weight: 1 },
  { key: 'zlatna', name: 'Zlatna ribica', emoji: '✨', rarity: 'legendary', value: 100, xp: 60, weight: 0.3 },
  { key: 'morski-pas', name: 'Morski pas', emoji: '🦈', rarity: 'legendary', value: 120, xp: 70, weight: 0.2 },
  { key: 'kit', name: 'Kit', emoji: '🐋', rarity: 'legendary', value: 200, xp: 100, weight: 0.08 },
];

const byKey = new Map(FISH.map((fish) => [fish.key, fish]));
const totalWeight = FISH.reduce((sum, fish) => sum + fish.weight, 0);

export function levelForXp(xp) {
  return Math.floor(Math.sqrt(Math.max(0, Number(xp) || 0) / 100));
}

export function xpForLevel(level) {
  return 100 * Math.max(0, Number(level) || 0) ** 2;
}

export function pickFish(random = Math.random) {
  let roll = random() * totalWeight;
  for (const fish of FISH) {
    roll -= fish.weight;
    if (roll <= 0) return fish;
  }
  return FISH[0];
}

const fishing = (guildId) => (db.guild(guildId).fishing ??= { users: {} });

export function getUser(guildId, userId) {
  const store = fishing(guildId);
  const user = (store.users[userId] ??= { xp: 0, coins: 0, inventory: {}, casts: 0, best: null, lastCastAt: 0 });
  user.inventory ??= {};
  return user;
}

export function catchFish(guildId, userId, { now = Date.now(), random = Math.random } = {}) {
  const user = getUser(guildId, userId);
  if (now - (user.lastCastAt ?? 0) < COOLDOWN_MS) {
    return { cooldownMs: COOLDOWN_MS - (now - (user.lastCastAt ?? 0)) };
  }
  const catches = 1 + Math.floor(random() * 3);
  const caught = new Map();
  let xpGained = 0;
  for (let i = 0; i < catches; i++) {
    const fish = pickFish(random);
    caught.set(fish.key, (caught.get(fish.key) ?? 0) + 1);
    user.inventory[fish.key] = (user.inventory[fish.key] ?? 0) + 1;
    xpGained += fish.xp;
    if (!user.best || fish.value > byKey.get(user.best)?.value) user.best = fish.key;
  }
  const levelBefore = levelForXp(user.xp);
  user.xp += xpGained;
  user.casts += 1;
  user.lastCastAt = now;
  const levelAfter = levelForXp(user.xp);
  db.save();
  return {
    caught: [...caught.entries()].map(([key, count]) => ({ fish: byKey.get(key), count })),
    xpGained,
    levelBefore,
    levelAfter,
    user,
  };
}

export function inventoryCount(user) {
  return Object.values(user.inventory ?? {}).reduce((sum, n) => sum + Number(n || 0), 0);
}

export function sellAll(guildId, userId) {
  const user = getUser(guildId, userId);
  const sold = Object.entries(user.inventory ?? {})
    .filter(([, count]) => count > 0)
    .map(([key, count]) => ({ fish: byKey.get(key), count }));
  const earned = sold.reduce((sum, item) => sum + (item.fish?.value ?? 0) * item.count, 0);
  user.inventory = {};
  user.coins = (user.coins ?? 0) + earned;
  db.save();
  return { sold, earned, coins: user.coins };
}

function caughtLines(caught) {
  return caught.map(({ fish, count }) => `${count} ${fish.emoji} ${fish.name}`).join('\n');
}

function buttons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('fish:again').setLabel('Pecaj ponovno').setEmoji('🎣').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('fish:sell').setLabel('Prodaj sve').setEmoji('💰').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('fish:return').setLabel('Natrag').setStyle(ButtonStyle.Secondary),
  );
}

export function fishPayload(member, result) {
  const user = result.user;
  const levelText = result.levelAfter > result.levelBefore ? `\n🎉 **Level ${result.levelBefore} → ${result.levelAfter}!**` : `\nLevel: **${result.levelAfter}**`;
  const embed = new EmbedBuilder()
    .setColor(COLOR_FISH)
    .setTitle('🎣 Pecanje')
    .setAuthor({ name: member.displayName ?? member.user.username, iconURL: member.user.displayAvatarURL({ size: 128 }) })
    .setDescription(`**Ulovio/la si:**\n${caughtLines(result.caught)}\n\n+${result.xpGained} XP${levelText}`)
    .addFields(
      { name: 'Novčići', value: String(user.coins ?? 0), inline: true },
      { name: 'U inventaru', value: String(inventoryCount(user)), inline: true },
      { name: 'Ukupno pecaja', value: String(user.casts ?? 0), inline: true },
    )
    .setFooter({ text: 'Klikni Prodaj sve da pretvoriš ulov u novčiće.' });
  return { embeds: [embed], components: [buttons()] };
}

export function soldPayload(member, result) {
  const sold = result.sold.length ? result.sold.map(({ fish, count }) => `${count} ${fish.emoji} ${fish.name}`).join('\n') : 'Inventar je bio prazan.';
  const embed = new EmbedBuilder()
    .setColor(COLOR_SELL)
    .setTitle('💰 Prodaja ulova')
    .setAuthor({ name: member.displayName ?? member.user.username, iconURL: member.user.displayAvatarURL({ size: 128 }) })
    .setDescription(`**Prodano:**\n${sold}\n\nZaradio/la si **${result.earned}** novčića.\nSada imaš **${result.coins}** novčića.`);
  return { embeds: [embed], components: [buttons()] };
}

export function closedPayload(member) {
  const embed = new EmbedBuilder()
    .setColor(0x4f545c)
    .setTitle('🎣 Pecanje je završeno')
    .setDescription(`${member}, upiši \`/fish\` kad želiš ponovno pecati.`);
  return { embeds: [embed], components: [] };
}

export async function handleComponent(interaction) {
  const action = interaction.customId.split(':')[1];
  if (action === 'return') return interaction.update(closedPayload(interaction.member));
  if (action === 'sell') {
    const result = sellAll(interaction.guild.id, interaction.user.id);
    return interaction.update(soldPayload(interaction.member, result));
  }
  if (action === 'again') {
    const result = catchFish(interaction.guild.id, interaction.user.id);
    if (result.cooldownMs) {
      return interaction.reply({ content: `⏳ Pričekaj još ${Math.ceil(result.cooldownMs / 1000)} s prije novog bacanja.`, flags: MessageFlags.Ephemeral });
    }
    return interaction.update(fishPayload(interaction.member, result));
  }
}
