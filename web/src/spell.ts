// Thai spelling diff — dependency-free, no DOM.
//
// One job: line a wrong attempt up against the answer so the eye lands on the
// cluster that went wrong, rather than on "that word is red". Alignment is by
// grapheme cluster (a base consonant plus the vowels and tone marks stacked on
// it), not by code point — otherwise a single missing tone mark shifts
// everything after it and the whole tail of the word reads as wrong.
const NSP = /[ัิ-ฺ]/;    // vowels written above/below the consonant (U+0E31, U+0E34–U+0E3A)
const TONE = /[็-๎]/;    // mai taikhu, the four tone marks, thanthakhat (U+0E47–U+0E4E)
const TRAIL = /[ะาำๅ]/;  // spacing vowels written to the consonant's right
const MARK = /[ัิ-ฺ็-๎]/; // nonspacing marks that sit on the preceding consonant

// ---- canonical order ----------------------------------------------------------
// The characters of one Thai syllable are typed in a fixed order — consonant,
// then the vowel above or below it, then the tone mark, then the vowel to its
// right — but nothing on a Linux Thai keyboard enforces that order. ่ and า are
// adjacent keys (j and k), so ต + า + ่ comes out of the fingers about as easily
// as ต + ่ + า, and a key that repeats gives you two tone marks. Both render
// indistinguishably from the real thing and neither is a spelling mistake: the
// letters are right, the keystrokes landed in the wrong order.
//
// Compared code point by code point they are simply *wrong*, with nothing on
// screen to show why — which is worth avoiding for the same reason พิมพ์ผิด
// exists (see dictation.ts): a slipped finger must not cost a study screen,
// three drills and an accuracy point. So every answer is put through this first,
// which sorts each syllable's marks back into standard order and drops a mark
// repeated on the same base (no Thai syllable carries the same mark twice).
// Text already in standard order comes back byte for byte unchanged.
// The stacked marks are a *set* — one vowel above, one tone — so a repeat is a
// repeated keystroke and drops out. The vowels to the right are a *sequence*
// (เพราะ ends า then ะ), so they keep the order they were typed in.
const uniq = (a: string[]): string => [...new Set(a)].sort().join('');

export function canonThai(s: string): string {
  let out = '';
  let base = '';
  let above: string[] = [];
  let tones: string[] = [];
  let trail: string[] = [];
  const flush = (): void => {
    if (!base) return;
    out += base + uniq(above) + uniq(tones) + trail.join('');
    base = '';
    above = [];
    tones = [];
    trail = [];
  };
  for (const ch of s.normalize('NFC')) {
    if (base && NSP.test(ch)) above.push(ch);
    else if (base && TONE.test(ch)) tones.push(ch);
    else if (base && TRAIL.test(ch)) trail.push(ch);
    else { flush(); base = ch; }
  }
  flush();
  return out;
}

// One aligned column: what was typed (a) over what it should be (b); the side
// with nothing is the empty string.
export interface DiffOp {
  op: 'equal' | 'extra' | 'missing' | 'replace';
  a: string;
  b: string;
}

// One base character plus every mark stacked on it. Written by hand rather than
// via Intl.Segmenter so results don't depend on which ICU version shipped.
export function clusters(s: string): string[] {
  const out: string[] = [];
  for (const ch of s.normalize('NFC')) {
    const prev = out[out.length - 1];
    if (prev !== undefined && MARK.test(ch)) out[out.length - 1] = prev + ch;
    else out.push(ch);
  }
  return out;
}

// Plain LCS over clusters. Words are a handful of clusters long, so the O(n·m)
// table costs nothing and the alignment is optimal.
export function diff(guess: string, target: string): DiffOp[] {
  const a = clusters(guess);
  const b = clusters(target);
  const n = a.length;
  const m = b.length;
  // One flat table rather than an array of rows; reading off the end returns the
  // zero the LCS recurrence wants there anyway, so the edges need no special case.
  const L = new Uint16Array((n + 1) * (m + 1));
  const lcs = (i: number, j: number): number => L[i * (m + 1) + j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i * (m + 1) + j] = a[i] === b[j]
        ? lcs(i + 1, j + 1) + 1
        : Math.max(lcs(i + 1, j), lcs(i, j + 1));
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const ca = a[i] ?? '';
    const cb = b[j] ?? '';
    if (ca === cb) { ops.push({ op: 'equal', a: ca, b: cb }); i++; j++; }
    else if (lcs(i + 1, j) >= lcs(i, j + 1)) { ops.push({ op: 'extra', a: ca, b: '' }); i++; }
    else { ops.push({ op: 'missing', a: '', b: cb }); j++; }
  }
  while (i < n) { ops.push({ op: 'extra', a: a[i] ?? '', b: '' }); i++; }
  while (j < m) { ops.push({ op: 'missing', a: '', b: b[j] ?? '' }); j++; }

  // An adjacent extra+missing pair is really one substitution — pairing them up
  // keeps the two rendered lines in step.
  const merged: DiffOp[] = [];
  for (let k = 0; k < ops.length; k++) {
    const cur = ops[k];
    if (!cur) continue;
    const nxt = ops[k + 1];
    if (nxt && ((cur.op === 'extra' && nxt.op === 'missing') || (cur.op === 'missing' && nxt.op === 'extra'))) {
      merged.push({ op: 'replace', a: cur.a || nxt.a, b: cur.b || nxt.b });
      k++;
    } else merged.push(cur);
  }
  return merged;
}

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ENT[c] ?? c);
const GAP = '·'; // holds the column open where one side has nothing

// Two aligned lines: what you typed, and what it should be.
export function diffHTML(guess: string, target: string): string {
  const ops = diff(guess, target);
  const mine: string[] = [];
  const theirs: string[] = [];
  for (const op of ops) {
    const cls = op.op === 'equal' ? 'ok' : 'bad';
    mine.push(`<span class="${cls}">${op.a ? esc(op.a) : GAP}</span>`);
    theirs.push(`<span class="${cls}">${op.b ? esc(op.b) : GAP}</span>`);
  }
  return `<div class="diff-row diff-mine"><span class="diff-tag">พิมพ์</span>${mine.join('')}</div>
    <div class="diff-row diff-theirs"><span class="diff-tag">ที่ถูก</span>${theirs.join('')}</div>`;
}
