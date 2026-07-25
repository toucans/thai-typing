// Thai spelling diff — dependency-free, no DOM.
//
// One job: line a wrong attempt up against the answer so the eye lands on the
// cluster that went wrong, rather than on "that word is red". Alignment is by
// grapheme cluster (a base consonant plus the vowels and tone marks stacked on
// it), not by code point — otherwise a single missing tone mark shifts
// everything after it and the whole tail of the word reads as wrong.
const MARK = /[ัิ-ฺ็-๎]/; // nonspacing marks that sit on the preceding consonant

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
