// Word similarity for the "toplo-hladno" game: semantic groups plus edit distance.
// It is intentionally offline and deterministic, so it works without an API key.
import { SEMANTIC_GROUPS, RELATED_PAIRS } from '../../data/semantic.js';
import { normalize } from './text.js';

const wordGroups = new Map(); // normalized word -> Set(group)
for (const [group, words] of Object.entries(SEMANTIC_GROUPS)) {
  for (const word of words) {
    const key = normalize(word);
    if (!key) continue;
    if (!wordGroups.has(key)) wordGroups.set(key, new Set());
    wordGroups.get(key).add(group);
  }
}

const related = new Map(); // "a|b" (sorted) -> weight
for (const [a, b] of RELATED_PAIRS) {
  const key = [normalize(a), normalize(b)].sort().join('|');
  related.set(key, 0.92);
}

export const SECRET_WORDS = [...new Set(
  Object.values(SEMANTIC_GROUPS)
    .flat()
    .filter((word) => {
      const key = normalize(word);
      return key.length >= 4 && key.length <= 12;
    }),
)];

function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

export function lexicalScore(a, b) {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const max = Math.max(left.length, right.length);
  const ratio = 1 - levenshtein(left, right) / max;
  let prefix = 0;
  while (prefix < Math.min(left.length, right.length, 6) && left[prefix] === right[prefix]) prefix += 1;
  const prefixBonus = (prefix / max) * 0.35;
  const containsBonus = (left.length >= 4 && right.startsWith(left)) || (right.length >= 4 && left.startsWith(right)) ? 0.2 : 0;
  return Math.max(0, Math.min(1, ratio * 0.8 + prefixBonus + containsBonus));
}

export function semanticScore(a, b) {
  const left = normalize(a);
  const right = normalize(b);
  if (!left || !right || left === right) return 0;
  const pair = [left, right].sort().join('|');
  if (related.has(pair)) return related.get(pair);
  const ga = wordGroups.get(left);
  const gb = wordGroups.get(right);
  if (!ga || !gb) return 0;
  let shared = 0;
  for (const group of ga) if (gb.has(group)) shared += 1;
  if (!shared) return 0;
  return Math.min(0.86, 0.68 + (shared - 1) * 0.06);
}

export function similarity(secret, guess) {
  const a = normalize(secret);
  const b = normalize(guess);
  if (!a || !b) return 0;
  if (a === b) return 100;
  const lexical = lexicalScore(a, b);
  const semantic = semanticScore(a, b);
  const score = semantic > 0 ? semantic * 88 + lexical * 12 : lexical * 72;
  return Math.max(0, Math.min(99, Math.round(score)));
}

export function similarityLabel(percent) {
  const value = Number(percent) || 0;
  if (value >= 95) return '🔥 vruće';
  if (value >= 75) return '🌡️ toplo';
  if (value >= 50) return '😊 mlako';
  if (value >= 25) return '❄️ hladno';
  return '🧊 ledeno';
}

export function similarityBar(percent) {
  const filled = Math.round((Math.max(0, Math.min(100, Number(percent) || 0)) / 100) * 10);
  return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)}`;
}

export function randomSecret() {
  return SECRET_WORDS[Math.floor(Math.random() * SECRET_WORDS.length)];
}
