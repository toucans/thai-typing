// gen-data.js — build-time bridge from the web app's data to the Kobo app.
// Deno script (Intl.Segmenter here is the same ICU Thai segmentation the
// browser uses, so bonus levels segment identically to the web).
//
// Emits JSON on stdout: { words: [...], sentences: [[word,...], ...] }
// where sentences[i] is SENTENCES[i] pre-segmented — the device does no
// segmentation of its own.
//
// Usage: deno run --allow-read gen-data.js > data.json
import { WORDS } from '../../web/js/data/words.js';
import { SENTENCES } from '../../web/js/data/sentences.js';

const segmenter = new Intl.Segmenter('th', { granularity: 'word' });

// Mirror of segmentChunk/segmentThai in web/js/ui.js — keep in lockstep.
function segmentChunk(text) {
  if (text.includes('|')) return text.split('|').map((s) => s.trim()).filter(Boolean);
  if (text.includes('​')) return text.split('​').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const s of segmenter.segment(text)) {
    const t = s.segment;
    if (!s.isWordLike && out.length) { out[out.length - 1] += t; continue; }
    out.push(t);
  }
  return out;
}

function segmentThai(text) {
  return text.normalize('NFC').split(/\s+/).filter(Boolean).flatMap(segmentChunk);
}

console.log(JSON.stringify({
  words: WORDS,
  sentences: SENTENCES.map(segmentThai),
}));
