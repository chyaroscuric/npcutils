// Small text helpers shared by the games.

// Croatian letters a word may consist of (č ć đ š ž count as one letter each).
export const WORD_RE = /^[a-zčćđšž]+$/;

// Lowercase + NFC so that "Č" typed as C + combining caron still matches "č".
export const clean = (text) => String(text ?? '').normalize('NFC').trim().toLowerCase();

// For comparing answers: lowercase, no diacritics (đ -> d), no spaces/punctuation.
export function normalize(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]/g, '');
}

export const letters = (word) => Array.from(word);
export const upper = (word) => letters(word).map((c) => c.toUpperCase()).join(' ');

// Random element of an array.
export const pick = (list) => list[Math.floor(Math.random() * list.length)];
