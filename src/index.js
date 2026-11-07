// Entry point used by hosting panels. It runs the BYOT manager by default, or a
// single bot when ROLE=bot / when only DISCORD_TOKEN is configured.
try {
  process.loadEnvFile();
} catch {
  // no .env file
}

const hasManager = Boolean(process.env.CLIENT_ID && process.env.CLIENT_SECRET);
const runSingleBot = process.env.ROLE === 'bot' || (!hasManager && process.env.DISCORD_TOKEN);

if (runSingleBot) {
  await import('./bot.js');
} else {
  await import('./manager/index.js');
}
