// GENERATED COPY -- do not edit. Source of truth: web/js/segment.js
// Regenerate with tools/build-pages.sh.
// Thai word segmentation — dependency-free on purpose: besides the web app
// (via ui.js), the kobo appliance's build step imports this module over HTTP
// from the running server, so the two frontends segment identically.
//
// Browsers and Deno ship ICU dictionary-based Thai segmentation via
// Intl.Segmenter, so no preprocessing step is needed. Explicit '|' (or
// zero-width-space) markers in the source text always win — that is the
// escape hatch for the dictionary's mistakes.
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('th', { granularity: 'word' }) : null;

// Segment one whitespace-free chunk into words.
function segmentChunk(text) {
  if (text.includes('|')) return text.split('|').map((s) => s.trim()).filter(Boolean);
  if (text.includes('\u200b')) return text.split('\u200b').map((s) => s.trim()).filter(Boolean);
  if (!segmenter) return [text];
  const out = [];
  for (const s of segmenter.segment(text)) {
    const t = s.segment;
    // attach stray punctuation / repeat marks (ๆ ฯ …) to the preceding word
    if (!s.isWordLike && out.length) { out[out.length - 1] += t; continue; }
    out.push(t);
  }
  return out;
}

// Segment Thai text, keeping track of where the source had real spaces. Thai
// puts no space between words but does use spaces to break phrases/sentences, so
// each space (or newline) becomes a `break` after the preceding word. Returns
// parallel arrays: words[i] and breaks[i] (true if a space followed that word).
export function segmentThaiBreaks(text) {
  const chunks = text.normalize('NFC').split(/\s+/).filter(Boolean);
  const words = [];
  const breaks = [];
  chunks.forEach((chunk, ci) => {
    const parts = segmentChunk(chunk);
    parts.forEach((w, wi) => {
      words.push(w);
      // a space follows only the last word of a chunk, and not the final chunk
      breaks.push(wi === parts.length - 1 && ci < chunks.length - 1);
    });
  });
  return { words, breaks };
}

export function segmentThai(text) {
  return segmentThaiBreaks(text).words;
}
