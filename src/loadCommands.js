import fs from 'node:fs';

// Loads every src/commands/*.js module (each exports `data` and `execute`).
export async function loadCommands() {
  const dir = new URL('./commands/', import.meta.url);
  const commands = new Map();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    const command = await import(new URL(file, dir));
    commands.set(command.data.name, command);
  }
  return commands;
}
