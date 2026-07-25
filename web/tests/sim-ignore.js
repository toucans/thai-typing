// ไม่ต้องจำ: a word marked not-worth-learning must leave the retrieval loop
// entirely — no drill, no carry-over, no effect on accuracy — and stay gone in
// later sessions.
const els = new Map();
function el(id) {
  if (!els.has(id)) {
    const listeners = {};
    // innerHTML and textContent must track each other the way the real DOM does:
    // the app writes markup to some of these nodes and plain text to others
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

// อายาโนโคจิ is the transliterated-name case: arbitrary spelling, worth nothing
const SRT = `1
00:00:01,000 --> 00:00:03,000
อายาโนโคจิ|ใช้|ประโยชน์

2
00:00:04,000 --> 00:00:06,000
เขา|มั่น|ใจ
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

const records = await import('./records.js');
const { initDictation, initDictationInput } = await import('./dictation.js');
const box = el('dict-typebox');
const fire = (t, ev) => (box.listeners[t] || []).forEach((f) => f(ev));
const type = (s) => { box.value = s; fire('input', { data: s.slice(-1) }); flush(); };
const key = (k, mods = {}) => { fire('keydown', { key: k, shiftKey: false, ...mods, preventDefault(){} }); flush(); };
const cue = () => el('dict-cue-no').textContent;
const words = () => el('dict-words').innerHTML;

let fails = 0;
const check = (n, c, x = '') => { if (c) console.log(`ok   ${n}`); else { fails++; console.log(`FAIL ${n} ${x}`); } };

async function session(label) {
  els.forEach((e) => { e.innerHTML = ''; e.textContent = ''; e.value = ''; });
  __modals.length = 0;
  await initDictation();
  el('media-list').kids.at(-1).onclick();
  for (let i = 0; i < 6; i++) await new Promise((r) => queueMicrotask(r));
  flush();
  console.log(`--- ${label}: ${cue()}`);
}

initDictationInput();
localStorage.setItem('tt.dictMode', 'listen');
records.setHistory([]);
await session('session 1');

// word 1 is the name: guess wrong, then mark it ไม่ต้องจำ from the study screen
type('อายาโนะโคจิ');
check('a wrong guess on the name reveals it', el('dict-ghost').textContent === 'อายาโนโคจิ',
  el('dict-ghost').textContent);
key('Enter', { ctrlKey: true });
check('ignoring shows the word as context', words().includes('อายาโนโคจิ'), words());
// and moves straight on: the next word is now the live slot, with no typing of
// the ignored one in between
check('ignoring steps straight past the word — no typing needed',
  el('dict-ghost').textContent === '' && el('dict-phase').innerHTML === '',
  `ghost=${el('dict-ghost').textContent} phase=${el('dict-phase').innerHTML}`);

// the very next thing typed is the FOLLOWING word, not the ignored one
type('ใช้'); type('ประโยชน์'); flush(); flush();
type('เขา'); type('มั่น'); type('ใจ'); flush(); flush();

let guard = 0;
while (guard++ < 40 && !records.saved.length) { flush(); await new Promise((r) => queueMicrotask(r)); }
const run1 = records.saved[0];
console.log('--- run 1:', JSON.stringify(run1));
check('the ignored word is logged', (run1.ignored || []).includes('อายาโนโคจิ'), JSON.stringify(run1.ignored));
check('the ignored word is not carried as a miss',
  !(run1.misses || []).some((m) => m.w === 'อายาโนโคจิ'), JSON.stringify(run1.misses));
check('ignoring rolls back the accuracy hit', run1.acc === 1 && run1.words === 5,
  `acc=${run1.acc} words=${run1.words}`);
check('the ignored word costs no keystrokes', run1.chars === 20, `chars=${run1.chars}`);

// ---- session 2: the name must never be asked again -------------------------------
records.setHistory([run1]);
records.saved.length = 0;
await session('session 2');
check('session 2 does not open on the ignored word', !cue().startsWith('ทบทวน'), cue());
check('the ignored word is shown, never blanked', words().includes('อายาโนโคจิ'), words());
// session 2 starts already past it — typing begins on the second word
type('ใช้'); type('ประโยชน์'); flush(); flush();
type('เขา'); type('มั่น'); type('ใจ'); flush(); flush();
guard = 0;
while (guard++ < 40 && !records.saved.length) { flush(); await new Promise((r) => queueMicrotask(r)); }
const run2 = records.saved[0];
console.log('--- run 2:', JSON.stringify(run2));
check('session 2 stays clean', run2.acc === 1, `acc=${run2.acc}`);
check('the ignored word still does not count', run2.words === 5, `words=${run2.words}`);
check('and is still never typed', run2.chars === 20, `chars=${run2.chars}`);

console.log(fails ? `\n${fails} FAILURES` : '\nall pass');
