// Entry points of the mini-games for src/index.js.
import { ready } from './dictionary.mjs';
import * as flags from './flags.mjs';
import * as kaladont from './kaladont.mjs';
import * as wordle from './wordle.mjs';

export const componentHandlers = {
  flag: flags.handleComponent,
  wordle: wordle.handleComponent,
};

// Called for every guild message; cheap when no game runs in that channel.
export async function onMessage(message) {
  if (await flags.onMessage(message)) return;
  await kaladont.onMessage(message);
}

// Loads (and on first start downloads) the dictionary in the background.
export function startGames() {
  ready();
}
