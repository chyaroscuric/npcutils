// Loads every command and validates it against Discord's limits (toJSON throws on invalid builders).
import { loadCommands } from '../src/loadCommands.mjs';

const commands = await loadCommands();
for (const [name, command] of commands) {
  const json = command.data.toJSON();
  if (typeof command.execute !== 'function') throw new Error(`${name} has no execute()`);
  console.log(`✔ /${name} (${json.options?.length ?? 0} opcija)`);
}
console.log(`${commands.size} komandi OK`);
