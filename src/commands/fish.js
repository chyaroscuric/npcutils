import { InteractionContextType, MessageFlags, SlashCommandBuilder } from 'discord.js';
import { catchFish, fishPayload } from '../features/games/fishing.js';

export const data = new SlashCommandBuilder()
  .setName('fish')
  .setDescription('Baci mrežu i ulovi ribu')
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction) {
  const result = catchFish(interaction.guild.id, interaction.user.id);
  if (result.cooldownMs) {
    return interaction.reply({
      content: `⏳ Pričekaj još ${Math.ceil(result.cooldownMs / 1000)} s prije novog bacanja.`,
      flags: MessageFlags.Ephemeral,
    });
  }
  return interaction.reply(fishPayload(interaction.member, result));
}
