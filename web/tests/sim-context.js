// Context, not spelling: a cue carries things that are not Thai words —
// quotes, parens, a year, a percentage, a Latin acronym. None of them is a Thai
// spelling exercise, so none may be asked for, scored, drilled or carried over;
// they are shown so the line still reads, and stepped over exactly like a comma.
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

// the five Thai words are the whole exercise; the other six tokens are furniture.
// The cue deliberately *opens* on one, to prove a leading non-Thai token is
// stepped over before the first slot rather than becoming it.
const SRT = `1
00:00:01,000 --> 00:00:03,000
"|ในปี|2568|เขา|ลงนาม|MOU|(|ราว|65%|)|แล้ว
`;
const THAI = ['ในปี', 'เขา', 'ลงนาม', 'ราว', 'แล้ว'];
const NOT_THAI = ['"', '2568', 'MOU', '(', '65%', ')'];

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
const words = () => el('dict-words').innerHTML;

let fails = 0;
const check = (n, c, x = '') => { if (c) console.log(`ok   ${n}`); else { fails++; console.log(`FAIL ${n} ${x}`); } };

initDictationInput();
localStorage.setItem('tt.dictMode', 'listen');
records.setHistory([]);
await initDictation();
el('media-list').kids[0].onclick();
for (let i = 0; i < 6; i++) await new Promise((r) => queueMicrotask(r));
flush();

// listen mode renders: tokens already behind the cursor as themselves, the
// current one as the ▁▁ slot, everything ahead as nothing. So the opening frame
// says it exactly: the quote was stepped over, the slot is on the Thai word.
check('a leading non-Thai token is stepped over, not made the slot',
  words() === '"▁▁', JSON.stringify(words()));

// type only the Thai, in order: nothing else is ever asked for. If a non-Thai
// token were still a target this would desynchronise and the run would log
// misses for words that were typed correctly.
for (const w of THAI) type(w);
flush(); flush();

let guard = 0;
while (guard++ < 40 && !records.saved.length) { flush(); await new Promise((r) => queueMicrotask(r)); }
const run = records.saved[0];
console.log('--- run:', JSON.stringify(run));

check('session ended', !!run);
check('only the Thai words are scored', run.words === THAI.length, `words=${run.words} want=${THAI.length}`);
check('typing just the Thai is a clean run', run.acc === 1, `acc=${run.acc}`);
check('chars count only the Thai typed',
  run.chars === THAI.join('').length, `chars=${run.chars} want=${THAI.join('').length}`);
check('nothing non-Thai is logged as a miss',
  !(run.misses || []).some((m) => NOT_THAI.includes(m.w)), JSON.stringify(run.misses));
check('no misses at all on a clean run', (run.misses || []).length === 0, JSON.stringify(run.misses));
// the whole line is still readable — the furniture is shown, just never typed
check('the non-Thai tokens are still displayed',
  NOT_THAI.every((t) => words().includes(t)), words());

console.log(fails ? `\n${fails} FAILURES` : '\nall pass');
