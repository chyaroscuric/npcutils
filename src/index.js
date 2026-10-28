// Entry point. Some hosting panels run the main file through tsx as CommonJS, where top-level await
// and import.meta do not work. The bot lives in .mjs files, which Node and tsx always load as ES modules,
// and import() works in both module systems.
import('./main.mjs').catch((err) => {
  console.error(err);
  process.exit(1);
});
