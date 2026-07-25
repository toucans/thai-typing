// Thai spelling diff and error taxonomy — dependency-free, no DOM.
//
// Thai is asymmetric: script→sound is nearly deterministic, sound→script is
// many-to-one (/s/ is ซ ศ ษ ส; final /t/ has a dozen spellings). So a listener
// who reads fluently can still be guessing at spelling, and the guesses are not
// random — they land in a handful of ambiguity classes. This module names those
// classes, so ฟัง–พิมพ์ can tell you *which* one you keep losing to instead of
// just "wrong again".
//
// Two things live here:
//  - clusters()/diff(): align a guess against the answer by grapheme cluster
//    (base consonant + its stacked vowels and tone marks), not by code point —
//    otherwise a missing tone mark shifts everything after it and the whole tail
//    reads as wrong.
//  - classify(): tag each edit with the ambiguity class it belongs to.

// ---- character classes ---------------------------------------------------------
// Nonspacing marks that stack on the preceding consonant and so ride inside its
// cluster: ั, ิ–ฺ, ็–๎.
const MARK = /[ัิ-ฺ็-๎]/;
const TONE = /[่-๋]/;              // ่ ้ ๊ ๋
const THANTHAKHAT = '์';                 // ์ — the silent-letter killer
const VOWEL_MARK = /[ัิ-ู็ํ]/; // ั ิ ี ึ ื ุ ู ็ ํ
const VOWEL_LETTER = /[ะาำเ-ๅ]/; // ะ า ำ เ แ โ ใ ไ ๅ
const CONSONANT = /[ก-ฮ]/;          // ก–ฮ

// Consonants that spell the same initial sound. These are the spelling choices
// the ear cannot make for you.
const HOMOPHONE_GROUPS = [
  'ขฃคฅฆ',   // kʰ
  'ฐฑฒถทธ',  // tʰ
  'ซศษส',    // s
  'ผพภ',     // pʰ
  'ฉชฌ',     // tɕʰ
  'นณ',      // n
  'ลฬ',      // l
  'ดฎ',      // d
  'ตฏ',      // t
  'ยญ',      // j
  'หฮ',      // h
];

// Finals collapse much harder than initials: every consonant in a row below is
// pronounced identically in coda position, so ประโยชน์ and ประโยดน์ sound the same.
const FINAL_GROUPS = [
  'กขคฆ',                 // -k
  'จชซฌฎฏฐฑฒดตถทธศษส',     // -t
  'ญณนรลฬ',               // -n
  'บปพฟภ',                // -p
];

const sameGroup = (groups, a, b) => groups.some((g) => g.includes(a) && g.includes(b));

// Leading vowels are written before the consonant they follow in speech, so the
// cluster after one always starts a syllable.
const LEADING_VOWEL = /^[เ-ไ]/; // เ แ โ ใ ไ

// ---- the categories -------------------------------------------------------------
// Ordered by how much a fix is worth: the top ones are closed, learnable sets.
export const CATEGORIES = {
  saraAi:    { th: 'ใ / ไ',              en: 'sara ai',        hint: 'ไม้ม้วนมีแค่ ๒๐ คำ — ท่องให้ครบแล้วหมวดนี้หายไปเลย' },
  tone:      { th: 'วรรณยุกต์',           en: 'tone mark',      hint: 'รูปวรรณยุกต์ผูกกับไตรยางศ์ — เลือกพยัญชนะผิด รูปวรรณยุกต์ก็ผิดตาม' },
  consonant: { th: 'พยัญชนะเสียงซ้ำ',      en: 'homophone',      hint: 'ส ศ ษ ซ / ท ธ ถ ฐ — เสียงเดียวกัน หูช่วยไม่ได้ ต้องจำรูปคำ' },
  silent:    { th: 'ตัวการันต์',           en: 'silent letter',  hint: 'ส่วนใหญ่มาจากบาลี–สันสกฤต จำเป็นตระกูลคำจะเร็วกว่าจำทีละคำ' },
  vowel:     { th: 'รูปสระ / ความสั้นยาว', en: 'vowel form',     hint: 'สระเสียงสั้น–ยาวและรูปลดรูป เช่น ั กับ า, ิ กับ ี' },
  letter:    { th: 'ตัวอักษรขาด–เกิน',     en: 'missing/extra',  hint: 'มักเป็นตัวที่เขียนแต่ไม่ออกเสียง เช่น ร ใน สามารถ' },
  order:     { th: 'ลำดับสลับ',           en: 'transposed',     hint: 'สระหน้า (เ แ โ ใ ไ) เขียนก่อนพยัญชนะ แต่ออกเสียงทีหลัง' },
  misheard:  { th: 'ฟังผิด',              en: 'misheard',       hint: 'ไม่ใช่ปัญหาการสะกด — เสียงที่ได้ยินคนละเสียง ให้ฟังซ้ำช้า ๆ' },
  other:     { th: 'อื่น ๆ',              en: 'other',          hint: '' },
};

// ---- grapheme clusters ----------------------------------------------------------
// One base character plus every nonspacing mark stacked on it. Written by hand
// rather than via Intl.Segmenter so the standalone Pages build gets identical
// results without depending on which ICU version the browser shipped.
export function clusters(s) {
  const out = [];
  for (const ch of (s || '').normalize('NFC')) {
    if (out.length && MARK.test(ch)) out[out.length - 1] += ch;
    else out.push(ch);
  }
  return out;
}

// ---- diff -------------------------------------------------------------------------
// Plain LCS over clusters. Words are a handful of clusters long, so the O(n·m)
// table costs nothing and the alignment is optimal.
export function diff(guess, target) {
  const a = clusters(guess);
  const b = clusters(target);
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ op: 'equal', a: a[i], b: b[j] }); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) { ops.push({ op: 'extra', a: a[i], b: '' }); i++; }
    else { ops.push({ op: 'missing', a: '', b: b[j] }); j++; }
  }
  while (i < n) ops.push({ op: 'extra', a: a[i++], b: '' });
  while (j < m) ops.push({ op: 'missing', a: '', b: b[j++] });

  // An adjacent extra+missing pair is really one substitution — pairing them up
  // keeps the two lines aligned and lets classify() compare the two clusters.
  const merged = [];
  for (let k = 0; k < ops.length; k++) {
    const cur = ops[k];
    const nxt = ops[k + 1];
    if (nxt && ((cur.op === 'extra' && nxt.op === 'missing') || (cur.op === 'missing' && nxt.op === 'extra'))) {
      merged.push({ op: 'replace', a: cur.a || nxt.a, b: cur.b || nxt.b });
      k++;
    } else merged.push(cur);
  }
  return merged;
}

// ---- classification ---------------------------------------------------------------
const marksOf = (cl) => [...cl.slice(1)];
const toneOf = (cl) => marksOf(cl).find((c) => TONE.test(c)) || '';
const vowelMarksOf = (cl) => marksOf(cl).filter((c) => VOWEL_MARK.test(c)).join('');
const hasSilent = (cl) => cl.includes(THANTHAKHAT);

// Which classes does this one edit belong to? An edit can be in more than one —
// swapping ข for ค forces a different tone mark, so that miss is genuinely both
// a consonant error and a tone error.
//
// `coda` says whether this position can be a syllable-final one. It matters
// because the two homophone tables apply in different places: ด and ต are
// distinct sounds as initials (mixing them up is a listening slip) but identical
// as finals (mixing them up is a spelling choice the ear can't make).
function tagEdit(op, coda) {
  const tags = new Set();
  if (op.op === 'equal') return tags;

  if (op.op === 'replace') {
    const [ab, bb] = [op.a[0], op.b[0]];
    if (ab !== bb) {
      if ('ใไ'.includes(ab) && 'ใไ'.includes(bb)) tags.add('saraAi');
      else if (sameGroup(HOMOPHONE_GROUPS, ab, bb) || (coda && sameGroup(FINAL_GROUPS, ab, bb))) tags.add('consonant');
      else if (VOWEL_LETTER.test(ab) && VOWEL_LETTER.test(bb)) tags.add('vowel');
      else if (CONSONANT.test(ab) && CONSONANT.test(bb)) tags.add('misheard');
      else tags.add('other');
    }
    if (toneOf(op.a) !== toneOf(op.b)) tags.add('tone');
    if (hasSilent(op.a) !== hasSilent(op.b)) tags.add('silent');
    if (vowelMarksOf(op.a) !== vowelMarksOf(op.b)) tags.add('vowel');
    if (!tags.size) tags.add('other');
    return tags;
  }

  // a whole cluster present on one side only
  const cl = op.a || op.b;
  if (hasSilent(cl)) tags.add('silent');
  else if (TONE.test(cl)) tags.add('tone');
  else if ('ใไ'.includes(cl[0])) tags.add('saraAi');
  else if (VOWEL_LETTER.test(cl[0]) || VOWEL_MARK.test(cl[0])) tags.add('vowel');
  else if (CONSONANT.test(cl[0])) tags.add('letter');
  else tags.add('other');
  return tags;
}

// Two adjacent substitutions that just swap their clusters are a transposition,
// not two independent wrong choices — the commonest cause being Thai's leading
// vowels, which are written before the consonant they follow in speech.
function markTranspositions(ops, tags) {
  for (let k = 0; k + 1 < ops.length; k++) {
    const x = ops[k];
    const y = ops[k + 1];
    if (x.op === 'replace' && y.op === 'replace' && x.a === y.b && x.b === y.a) {
      tags[k] = new Set(['order']);
      tags[k + 1] = new Set(['order']);
    }
  }
}

// The full verdict on one miss: the aligned edit script, a tag set per edit, and
// the distinct classes involved. Stats count the distinct classes (once per
// word), so a long word missed in one place doesn't outweigh a short one.
export function classify(guess, target) {
  const ops = diff(guess, target);
  // A position is a possible coda unless it opens the word or follows a leading
  // vowel — both of which put it at the start of a syllable instead.
  const tags = ops.map((op, k) => {
    const prev = k > 0 ? (ops[k - 1].b || ops[k - 1].a) : '';
    return tagEdit(op, k > 0 && !LEADING_VOWEL.test(prev));
  });
  markTranspositions(ops, tags);
  const all = new Set();
  for (const t of tags) for (const x of t) all.add(x);
  return { ops, tags, categories: [...all], correct: !ops.some((o) => o.op !== 'equal') };
}

// ---- rendering ---------------------------------------------------------------------
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const GAP = '·'; // holds the column open where one side has nothing

// Two aligned lines: what you typed, and what it should be. Column-aligned so
// the eye lands straight on the one cluster that went wrong — feedback that
// says "ชน์ not ด", not merely "wrong".
export function diffHTML(guess, target) {
  const { ops, tags } = classify(guess, target);
  const mine = [];
  const theirs = [];
  ops.forEach((op, k) => {
    const cls = op.op === 'equal' ? 'ok' : 'bad';
    const cat = [...(tags[k] || [])][0] || '';
    const title = cat && CATEGORIES[cat] ? ` title="${esc(CATEGORIES[cat].th)}"` : '';
    mine.push(`<span class="${cls}"${title}>${op.a ? esc(op.a) : GAP}</span>`);
    theirs.push(`<span class="${cls}"${title}>${op.b ? esc(op.b) : GAP}</span>`);
  });
  return `<div class="diff-row diff-mine"><span class="diff-tag">พิมพ์</span>${mine.join('')}</div>
    <div class="diff-row diff-theirs"><span class="diff-tag">ที่ถูก</span>${theirs.join('')}</div>`;
}

// Category counts across many misses, biggest first. Each miss contributes at
// most one to each category (see classify).
export function tally(misses) {
  const counts = new Map();
  const words = new Map(); // category -> Map(word -> times)
  for (const m of misses) {
    const cats = m.tags && m.tags.length ? m.tags : classify(m.g || '', m.w || '').categories;
    for (const c of cats) {
      counts.set(c, (counts.get(c) || 0) + 1);
      if (!words.has(c)) words.set(c, new Map());
      const wm = words.get(c);
      wm.set(m.w, (wm.get(m.w) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([cat, n]) => ({
      cat,
      n,
      label: (CATEGORIES[cat] || CATEGORIES.other).th,
      hint: (CATEGORIES[cat] || CATEGORIES.other).hint,
      words: [...(words.get(cat) || new Map()).entries()].sort((x, y) => y[1] - x[1]),
    }));
}
