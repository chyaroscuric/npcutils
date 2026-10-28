// Croatian (+ Serbian latin) word list for Wordle / Kaladont, from the hunspell dictionaries in wooorm/dictionaries.
// Downloaded once into <DATA_DIR>/dict and loaded lazily. If loading fails the games keep working: isWord() says yes.
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from '../../db.js';
import { WORDS } from '../../data/words.js';
import { WORD_RE, clean, normalize } from './text.js';

const SOURCES = {
  'hr.dic': 'https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries/hr/index.dic',
  'sr-Latn.dic': 'https://raw.githubusercontent.com/wooorm/dictionaries/main/dictionaries/sr-Latn/index.dic',
};

// The hunspell lists contain lemmas only and miss many loanwords ending in -nt, so a kaladont could never be won.
export const EXTRA_WORDS = [
  'kaladont', 'student', 'docent', 'agent', 'talent', 'moment', 'element', 'cement', 'dokument', 'argument',
  'kontinent', 'pacijent', 'procent', 'dijamant', 'briljant', 'desant', 'front', 'font', 'sprint', 'print',
  'apsint', 'asistent', 'emigrant', 'imigrant', 'garant', 'konzument', 'instrument', 'monument', 'parlament',
  'pigment', 'segment', 'sentiment', 'temperament', 'trident', 'akcent', 'prezent', 'regent', 'klijent',
  'ambijent', 'fragment', 'eksperiment', 'kompliment', 'konsonant', 'mutant', 'horizont', 'bunt', 'dirigent',
  'konsultant', 'praktikant', 'referent', 'informant', 'komandant', 'ađutant',
];

let words = null; // Set once loaded
let folded = null; // words without diacritics, so "kuca" is accepted for "kuća" and "djak" for "đak"
let prefixCounts = null; // two-letter prefix (without diacritics) -> number of words
let failed = false;
let loading = null;

// Parses a hunspell .dic file (first line = count, then `word/FLAGS`) and adds plain lowercase words to the set.
export function parseDic(text, into = new Set()) {
  const lines = text.split(/\r?\n/);
  for (let i = 1; i < lines.length; i++) {
    const word = lines[i].split('/')[0].trim().normalize('NFC');
    if (WORD_RE.test(word)) into.add(word);
  }
  return into;
}

async function download(url, file) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  fs.writeFileSync(`${file}.tmp`, text);
  fs.renameSync(`${file}.tmp`, file);
  return text;
}

async function load() {
  const dir = path.join(dataDir(), 'dict');
  fs.mkdirSync(dir, { recursive: true });
  const set = new Set();
  let sources = 0;
  for (const [name, url] of Object.entries(SOURCES)) {
    const file = path.join(dir, name);
    try {
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : await download(url, file);
      parseDic(text, set);
      sources++;
    } catch (err) {
      console.warn(`[dictionary] Ne mogu učitati ${name}:`, err.message);
    }
  }
  if (!sources) {
    failed = true;
    console.warn('[dictionary] Rječnik nije dostupan, igre prihvaćaju sve riječi.');
    return;
  }
  for (const w of WORDS) set.add(w);
  for (const w of EXTRA_WORDS) set.add(w);
  useWords(set);
  console.log(`[dictionary] Učitano ${set.size} riječi.`);
}

// Replaces the word list (also used by tests).
export function useWords(set) {
  words = set;
  failed = false;
  folded = new Set();
  prefixCounts = new Map();
  for (const w of set) {
    for (const variant of w.includes('đ') ? [w, w.replace(/đ/g, 'dj')] : [w]) {
      const f = normalize(variant);
      folded.add(f);
      prefixCounts.set(f.slice(0, 2), (prefixCounts.get(f.slice(0, 2)) ?? 0) + 1);
    }
  }
}

// Starts loading (once) and resolves when done; never rejects.
export function ready() {
  loading ??= load().catch((err) => {
    failed = true;
    console.warn('[dictionary]', err.message);
  });
  return loading;
}

export const isLoaded = () => Boolean(words);

// True if the word is in the dictionary - or if the dictionary isn't (yet) available, so games never get stuck.
export function isWord(word) {
  if (!words) {
    if (!failed) ready();
    return true;
  }
  return words.has(clean(word)) || folded.has(normalize(word));
}

// How many dictionary words start with the given letters (Infinity when unknown).
export function countStartingWith(prefix) {
  if (!prefixCounts) return Infinity;
  const p = normalize(prefix);
  if (p.length === 2) return prefixCounts.get(p) ?? 0;
  let n = 0;
  for (const w of folded) if (w.startsWith(p)) n++;
  return n;
}
