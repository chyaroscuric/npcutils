import { InteractionContextType, SlashCommandBuilder } from 'discord.js';
import * as freeGames from '../features/freeGames.js';
import { UserError } from '../utils/helpers.js';

export const deferEphemeral = true;

export const data = new SlashCommandBuilder()
  .setName('freegames')
  .setDescription('Prikaži trenutno besplatne igre na Epicu i Steamu')
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
  let games;
  try {
    games = await freeGames.fetchFreeGames({ force: true });
  } catch (err) {
    throw new UserError(`Ne mogu dohvatiti besplatne igre: ${err.message}`);
  }
  const cfg = { ...freeGames.defaultConfig(), enabled: true, epic: true, steam: true };
  return interaction.editReply(freeGames.buildFreeGamesPayload(cfg, games));
}
