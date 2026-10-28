import fs from 'node:fs';

// Loads src/commands/*.js. A module exports either `data` + `execute` or a `commands` array of them.
export async function loadCommands() {
  const dir = new URL('./commands/', import.meta.url);
  const commands = new Map();
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
    const mod = await import(new URL(file, dir));
    for (const command of mod.commands ?? [mod]) commands.set(command.data.name, command);
  }
  return commands;
}
