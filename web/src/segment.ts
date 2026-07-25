// Thai word segmentation — dependency-free on purpose: besides the web app
// (via ui.ts), tools/build-pages.sh bundles this module into the standalone
// Pages build (docs/lib/), so the two frontends segment identically.
//
// Browsers and Deno ship ICU dictionary-based Thai segmentation via
// Intl.Segmenter, so no preprocessing step is needed. Explicit '|' (or
// zero-width-space) markers in the source text always win — that is the
// escape hatch for the dictionary's mistakes.
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('th', { granularity: 'word' }) : null;

// Parallel arrays: words[i], and breaks[i] true if a space followed that word.
export interface Segmented {
  words: string[];
  breaks: boolean[];
}

// Segment one whitespace-free chunk into words.
function segmentChunk(text: string): string[] {
  if (text.includes('|')) return text.split('|').map((s) => s.trim()).filter(Boolean);
  if (text.includes('\u200b')) return text.split('\u200b').map((s) => s.trim()).filter(Boolean);
  if (!segmenter) return [text];
  const out: string[] = [];
  for (const s of segmenter.segment(text)) {
    const t = s.segment;
    // Thai repeat/abbreviation marks (ๆ ฯ …) ride with the word they follow;
    // other punctuation stays its own token so a closing " or ) is passed
    // over by skip-aware modes exactly like an opening one
    const prev = out[out.length - 1];
    if (!s.isWordLike && prev !== undefined && /[฀-๿]/.test(t)) {
      out[out.length - 1] = prev + t;
      continue;
    }
    out.push(t);
  }
  return out;
}

// Segment Thai text, keeping track of where the source had real spaces. Thai
// puts no space between words but does use spaces to break phrases/sentences, so
// each space (or newline) becomes a `break` after the preceding word.
export function segmentThaiBreaks(text: string): Segmented {
  const chunks = text.normalize('NFC').split(/\s+/).filter(Boolean);
  const words: string[] = [];
  const breaks: boolean[] = [];
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

export function segmentThai(text: string): string[] {
  return segmentThaiBreaks(text).words;
}
