// Speed-journey level generation — dependency-free on purpose: besides
// speed.ts, tools/build-pages.sh bundles this module into the standalone
// Pages build (docs/lib/), which samples the same deterministic generator
// (levels are shared state: ด่าน 217 must hold the same words everywhere).
//
// Levels are generated, not stored: a seeded PRNG samples the
// frequency-ordered word pool, with the sampling window widening as levels
// rise. Every level is deterministic.
import { WORDS } from './data/words.ts';
import { SENTENCES } from './data/sentences.ts';
import { segmentThai } from './segment.ts';

export const WORDS_PER_LEVEL = 50;

// breaks (where the source had a real space) only exists on the bonus levels —
// a word-salad level has nothing to break.
export interface Level {
  words: string[];
  breaks?: boolean[];
  bonus: boolean;
}

function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function levelWords(level: number): Level {
  const rng = mulberry32(level + 4801);
  // every 10th level is a bonus: proverbs and nature lines instead of word salad
  if (level % 10 === 0) {
    const words: string[] = [];
    const breaks: boolean[] = []; // like segmentThaiBreaks: true = a space follows that word
    const used = new Set<string>();
    while (words.length < 36 && used.size < SENTENCES.length) {
      const s = SENTENCES[Math.floor(rng() * SENTENCES.length)];
      if (s === undefined || used.has(s)) continue;
      used.add(s);
      if (breaks.length) breaks[breaks.length - 1] = true; // space between proverbs
      const parts = segmentThai(s);
      words.push(...parts);
      breaks.push(...parts.map(() => false));
    }
    return { words, breaks, bonus: true };
  }
  const pool = Math.min(WORDS.length, 90 + level * 3);
  const words: string[] = [];
  let last = -1;
  while (words.length < WORDS_PER_LEVEL) {
    const i = Math.floor(Math.pow(rng(), 1.6) * pool); // bias toward frequent words
    const w = WORDS[i];
    if (i === last || w === undefined) continue;
    last = i;
    words.push(w);
  }
  return { words, bonus: false };
}
