// พิมพ์ผิด: a slipped finger is not a spelling you don't have.
//
// Marking one must undo exactly what the miss did — no study cycle owed, no
// drill, no accuracy hit, nothing carried into the next session — while leaving
// the word in play, which is what separates it from ไม่ต้องจำ. And a slip *inside*
// a drill must not reset that word's schedule back to the start.
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

// มั่น appears in both cues on purpose: marking a slip on it must not stop the
// second cue from asking for it again.
const SRT = `1
00:00:01,000 --> 00:00:03,000
เขา|มั่น|ใจ|มาก

2
00:00:04,000 --> 00:00:06,000
มั่น|คง|ดี|จริง|นะ|ครับ
`;
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
const { initDictation, initDictationInput } = await import('./dictation.ts');
const box = el('dict-typebox');
const fire = (t, ev) => (box.listeners[t] || []).forEach((f) => f(ev));
const type = (s) => { box.value = s; fire('input', { data: s.slice(-1) }); flush(); };
const key = (k, mods = {}) => {
  fire('keydown', { key: k, shiftKey: false, ...mods, preventDefault(){} });
  flush();
};
const typo = () => key('Enter', { shiftKey: true }); // พิมพ์ผิด
const cue = () => el('dict-cue-no').textContent;
const words = () => el('dict-words').innerHTML;
const ghost = () => el('dict-ghost').textContent;

let fails = 0;
const check = (n, c, x = '') => { if (c) console.log(`ok   ${n}`); else { fails++; console.log(`FAIL ${n} ${x}`); } };

initDictationInput();
localStorage.setItem('tt.dictMode', 'listen');
records.setHistory([]);
await initDictation();
el('media-list').kids[0].onclick();
for (let i = 0; i < 6; i++) await new Promise((r) => queueMicrotask(r));
flush();

// ---- a slipped finger on a word you know -------------------------------------
type('เขา');
type('มั่ม');                       // ม instead of น on the last cluster
check('a slip still reveals the answer first', ghost() === 'มั่น', ghost());
typo();
check('พิมพ์ผิด clears the study screen and moves on', ghost() === '' && el('dict-phase').innerHTML === '',
  `ghost=${ghost()} phase=${el('dict-phase').innerHTML}`);

// the very next thing typed is the FOLLOWING word — the slip is not retyped
type('ใข');                         // and this one is a genuine spelling miss
check('a real miss still reveals the answer', ghost() === 'ใจ', ghost());
key('Enter'); type('ใจ');           // study -> recall, correctly
type('มาก');
flush(); flush();

// ---- the slipped word is still in play ---------------------------------------
check('cue 2 asks for the slipped word again, blanked', words() === '▁▁', JSON.stringify(words()));
type('มั่น'); type('คง'); type('ดี'); type('จริง'); type('นะ'); type('ครับ');
flush(); flush();

// ---- a slip inside a drill must not reset that word's schedule ----------------
let guard = 0;
let sawDrill = 0;
let labelAfterSlip = '';
let slipped = false;
while (guard++ < 60 && !records.saved.length) {
  const c = cue();
  if (c.startsWith('ทบทวน')) {
    sawDrill++;
    if (!slipped) {
      check('only the genuine miss is drilled — the slip is not', sawDrill === 1 && c.includes('1/3'), c);
      type('ใข');                   // slip again, this time mid-drill
      typo();
      slipped = true;
    } else {
      if (!labelAfterSlip) labelAfterSlip = c;
      type('ใจ');                   // answer the rest cleanly
    }
  }
  flush();
  await new Promise((r) => queueMicrotask(r));
}

check('a slip inside a drill advances the schedule instead of resetting it',
  labelAfterSlip.includes('2/3'), `next drill was "${labelAfterSlip}" (want 2/3)`);

const run = records.saved[0];
console.log('--- run:', JSON.stringify(run));
check('session ended', !!run);
check('the slipped word is not logged as a miss',
  !(run.misses || []).some((m) => m.w === 'มั่น'), JSON.stringify(run.misses));
check('the genuine miss still is', (run.misses || []).some((m) => m.w === 'ใจ'), JSON.stringify(run.misses));
check('the slip costs no accuracy', run.acc === 0.9, `acc=${run.acc} (want 0.9: 1 real miss in 10 words)`);
check('every word still counts', run.words === 10, `words=${run.words}`);
check('พิมพ์ผิด does not ban the word like ไม่ต้องจำ',
  !(run.ignored || []).includes('มั่น'), JSON.stringify(run.ignored));
check('the drilled word still retires', (run.mastered || []).includes('ใจ'), JSON.stringify(run.mastered));

console.log(fails ? `\n${fails} FAILURES` : '\nall pass');
