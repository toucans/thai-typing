// Speed-journey level generation — dependency-free on purpose: besides
// speed.js, tools/build-pages.sh copies this module into the standalone
// Pages build (docs/lib/), which samples the same deterministic generator
// (levels are shared state: ด่าน 217 must hold the same words everywhere).
//
// Levels are generated, not stored: a seeded PRNG samples the
// frequency-ordered word pool, with the sampling window widening as levels
// rise. Every level is deterministic.
import { WORDS } from './data/words.js';
import { SENTENCES } from './data/sentences.js';
import { segmentThai } from './segment.js';

export const WORDS_PER_LEVEL = 25;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function levelWords(level) {
  const rng = mulberry32(level + 4801);
  // every 10th level is a bonus: proverbs and nature lines instead of word salad
  if (level % 10 === 0) {
    const words = [];
    const breaks = []; // like segmentThaiBreaks: true = a space follows that word
    const used = new Set();
    while (words.length < 18 && used.size < SENTENCES.length) {
      const s = SENTENCES[Math.floor(rng() * SENTENCES.length)];
      if (used.has(s)) continue;
      used.add(s);
      if (breaks.length) breaks[breaks.length - 1] = true; // space between proverbs
      const parts = segmentThai(s);
      words.push(...parts);
      breaks.push(...parts.map(() => false));
    }
    return { words, breaks, bonus: true };
  }
  const pool = Math.min(WORDS.length, 90 + level * 3);
  const words = [];
  let last = -1;
  while (words.length < WORDS_PER_LEVEL) {
    const i = Math.floor(Math.pow(rng(), 1.6) * pool); // bias toward frequent words
    if (i === last) continue;
    last = i;
    words.push(WORDS[i]);
  }
  return { words, bonus: false };
}
