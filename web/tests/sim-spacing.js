// The drill schedule has to space reviews out in material you have not seen.
//
// It once counted the repetitions themselves: nine words carried in from the
// last session were nine "words seen", so a gap of five was satisfied by the
// batch feeding itself and every word came back moments after it was missed,
// with nothing in between to forget it over. A gap only spaces anything if it is
// measured in new material — and since drills interrupt only between cues,
// everything that comes due during one cue arrives at the same boundary, so the
// run has to be capped too or it lands as a wall of reviews.
const els = new Map();
function el(id) {
  if (!els.has(id)) {
    const listeners = {};
    let html = '';
    let text = '';
    els.set(id, {
      id, value: '', hidden: false, readOnly: false,
      get innerHTML(){ return html; },
      set innerHTML(v){ html = String(v); text = html.replace(/<[^>]*>/g, ''); },
      get textContent(){ return text; },
      set textContent(v){ text = String(v); html = text; },
      placeholder: '', offsetWidth: 1, listeners, onclick: null,
      classList: { add(){}, remove(){}, toggle(){} },
      focus(){}, addEventListener(t, f){ (listeners[t] ||= []).push(f); },
      querySelector(){ return { set onclick(f){}, classList: { toggle(){} } }; },
      querySelectorAll(){ return []; },
      appendChild(c){ (this.kids ||= []).push(c); this.innerHTML += c.textContent ?? ''; },
      removeAttribute(){}, pause(){}, play(){},
      readyState: 1, currentTime: 0, playbackRate: 1,
    });
  }
  return els.get(id);
}
globalThis.__dom = (sel) => el(sel.replace(/^#/, ''));
globalThis.__modals = [];
globalThis.localStorage = { store: {}, getItem(k){ return this.store[k] ?? null; },
  setItem(k, v){ this.store[k] = v; }, removeItem(k){ delete this.store[k]; } };
const timers = [];
globalThis.setTimeout = (f) => { timers.push(f); return 0; };
const flush = () => { while (timers.length) timers.shift()(); };

// 10 cues x 5 distinct words, every word the same length so a wrong guess of
// the same length auto-submits the way a real one does
const CUES = [];
for (let c = 0; c < 10; c++) CUES.push(Array.from({ length: 5 }, (_, i) => `ก${c}${i}า`));
const SRT = CUES.map((ws, i) =>
  `${i + 1}\n00:00:0${i},000 --> 00:00:0${i + 1},000\n${ws.join('|')}\n`).join('\n');

globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ pairs: [{ name: 'ep01', media: 'a.mp4', subs: 'a.srt' }] }),
  text: async () => SRT,
});
globalThis.performance = { now: () => 0 };
globalThis.document = {
  createElement: () => ({ className: '', innerHTML: '', textContent: '', onclick: null,
    querySelector(sel){ return sel.includes('restart') ? null : { set onclick(f){} }; } }),
  querySelectorAll: () => [], dispatchEvent(){}, addEventListener(){},
};
globalThis.CustomEvent = class {};

const records = await import('./records.ts');
// a previous session that left nine words owed
const OWED = CUES.slice(0, 2).flat().slice(0, 9);
records.setHistory([{
  game: 'dictation', name: 'ep01', t: '2026-07-24T10:00:00Z', words: 30, acc: 0.7,
  misses: OWED.map((w, i) => ({ w, cue: i < 5 ? 0 : 1 })), mastered: [],
}]);

const { initDictation, initDictationInput } = await import('./dictation.ts');
const box = el('dict-typebox');
const fire = (t, ev) => (box.listeners[t] || []).forEach((f) => f(ev));
const type = (s) => { box.value = s; fire('input', { data: s.slice(-1) }); flush(); };
const key = (k, mods = {}) => { fire('keydown', { key: k, shiftKey: false, ...mods, preventDefault(){} }); flush(); };
const cue = () => el('dict-cue-no').textContent;
const ghost = () => el('dict-ghost').textContent;

let fails = 0;
const check = (n, c, x = '') => { if (c) console.log(`ok   ${n}`); else { fails++; console.log(`FAIL ${n} ${x}`); } };

initDictationInput();
localStorage.setItem('tt.dictMode', 'listen');
await initDictation();
el('media-list').kids[0].onclick();
for (let i = 0; i < 6; i++) await new Promise((r) => queueMicrotask(r));
flush();

// Drive it without reaching inside the module. The words strip renders the cue
// with the asked-for word blanked, and these words carry their own cue number
// (ก<cue><word>า), so what the game is asking for can be read straight off the
// screen — a drill shows its cue as context, a fresh cue shows what you have
// already typed.
const strip = () => el('dict-words').innerHTML.match(/▁▁|ก\d\dา/g) || [];
function asked() {
  const toks = strip();
  const at = toks.indexOf('▁▁');
  if (at === -1) return null;
  const drill = cue().startsWith('ทบทวน');
  const ctx = toks.find((t) => t !== '▁▁');
  // a drill names its cue through the context words; a fresh cue names it in the
  // header, which is the only thing on screen when the blank is the first word
  const ci = drill && ctx ? Number(ctx[1]) : Number(/ท่อนที่ (\d+)/.exec(cue())?.[1] ?? 0) - 1;
  return { w: CUES[ci]?.[at], drill };
}

// One fresh word is missed outright, to watch a first return. One of the carried
// words is missed again during the opening round — the realistic case, since
// getting it wrong is why it was owed in the first place, and a re-armed word in
// a batch is exactly what used to come straight back.
const MISS = 'ก52า';
const MISS_AGAIN = OWED[0];
let missedAgain = false;
let missed = false;
const log = [];
let guard = 0;
while (guard++ < 500 && !records.saved.length) {
  const a = asked();
  if (!a?.w) { flush(); await new Promise((r) => queueMicrotask(r)); continue; }
  log.push(a);
  if ((a.w === MISS && !missed) || (a.drill && a.w === MISS_AGAIN && !missedAgain)) {
    if (a.w === MISS) missed = true; else missedAgain = true;
    type('ก99า');          // wrong, same length -> auto-submits and reveals
    key('Enter');          // study -> recall
    type(a.w);             // and recall it correctly
  } else {
    type(a.w);             // right on the first guess
  }
  flush(); flush();
  await new Promise((r) => queueMicrotask(r));
}
check('both misses were reached', missed && missedAgain, `fresh=${missed} carried=${missedAgain}`);

check('the session ran to the end', !!records.saved.length, JSON.stringify(records.saved));

// ---- the opening ทบทวนคำเก่า round -------------------------------------------
let open = 0;
while (open < log.length && log[open].drill) open++;
const opening = log.slice(0, open).map((e) => e.w);
check('the opening round asks every owed word', opening.length === OWED.length,
  `${opening.length} of ${OWED.length}: ${opening.join(' ')}`);
check('no word is asked twice inside the opening round',
  new Set(opening).size === opening.length, opening.join(' '));

// ---- the flush at the end is a batch by design, so measure up to it -----------
let lastNew = log.length - 1;
while (lastNew >= 0 && log[lastNew].drill) lastNew--;
const body = log.slice(open, lastNew + 1);

// ---- a review must have new material in front of it --------------------------
// Only reviews are measured: a word turning up again in its own subtitle is the
// text, not the schedule interrupting you, and reading it there is the point.
let worst = Infinity;
let worstWord = '';
const drilledAt = new Map();
let fresh = 0;
for (const e of [...log.slice(0, open), ...body]) {
  if (!e.drill) { fresh++; continue; }
  const prev = drilledAt.get(e.w);
  if (prev !== undefined && fresh - prev < worst) { worst = fresh - prev; worstWord = e.w; }
  drilledAt.set(e.w, fresh);
}
check('a review never comes back before 5 words of new material have gone by',
  worst >= 5, `${worstWord} came back after ${worst}`);

// ---- and reviews must not arrive as a wall -----------------------------------
let run = 0;
let longest = 0;
for (const e of body) {
  run = e.drill ? run + 1 : 0;
  if (run > longest) longest = run;
}
check('no more than 3 reviews land between two cues', longest <= 3, `saw a run of ${longest}`);

console.log(`--- ${log.length} words asked, longest review run ${longest}, closest repeat ${worst} new words`);
Deno.exit(fails ? 1 : 0);
