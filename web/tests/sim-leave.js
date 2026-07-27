// Leaving mid-episode must keep the reviews you just did. A sitting can be
// nothing but the ทบทวนคำเก่า round — open the episode, answer the words owed
// from last time, get called away — and that sitting is where the whole value
// of the carry-over mechanism lands. It used to be thrown away: the "did you
// actually play?" guard counted words of *new* material only, which a review
// round has none of, so the run was never written and every recall in it was
// asked for again the moment you came back.
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
      querySelectorAll(){ return [] },
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

const SRT = `1
00:00:01,000 --> 00:00:03,000
ผู้ใหญ่|ใช้|ประโยชน์|จาก|ศาสตร์

2
00:00:04,000 --> 00:00:06,000
เขา|มั่น|ใจ|มาก
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
// last time: two words missed, one of them two thirds of the way home
records.setHistory([{
  game: 'dictation', name: 'ep01', t: '2026-07-24T10:00:00Z', words: 9, acc: 0.78,
  misses: [{ w: 'ใช้', cue: 0 }, { w: 'ประโยชน์', cue: 0 }],
  mastered: [],
  progress: [{ w: 'ประโยชน์', reps: 2 }],
}]);

const { initDictation, initDictationInput } = await import('./dictation.ts');
const box = el('dict-typebox');
const fire = (t, ev) => (box.listeners[t] || []).forEach((f) => f(ev));
const type = (s) => { box.value = s; fire('input', { data: s.slice(-1) }); flush(); };
const cue = () => el('dict-cue-no').textContent;
const click = (id) => { (el(id).listeners.click || []).forEach((f) => f()); flush(); };

let fails = 0;
const check = (n, c, x = '') => { if (c) console.log(`ok   ${n}`); else { fails++; console.log(`FAIL ${n} ${x}`); } };

initDictationInput();
localStorage.setItem('tt.dictMode', 'listen');
await initDictation();
el('media-list').kids[0].onclick();
for (let i = 0; i < 6; i++) await new Promise((r) => queueMicrotask(r));
flush();

check('the sitting opens on the words owed', cue().startsWith('ทบทวนคำเก่า'), `cue=${cue()}`);

// answer the opening round and nothing else — no cue of new material is typed
const ANSWERS = ['ใช้', 'ประโยชน์'];
const done = [];
let guard = 0;
while (guard++ < 10 && cue().startsWith('ทบทวน')) {
  const shown = el('dict-words').innerHTML;
  const word = ANSWERS.find((w) => !shown.includes(w));
  if (!word) { console.log('could not identify the drilled word:', shown); break; }
  done.push(word);
  type(word);
  flush();
}
check('both owed words were reviewed', done.length === 2, JSON.stringify(done));
check('and the round moved on to new material', cue().startsWith('ท่อนที่'), `cue=${cue()}`);

// ...then กลับไปเลือกตอน, without a single word of the episode typed
click('dict-exit');
await new Promise((r) => queueMicrotask(r));

const run = records.saved[0];
check('a sitting spent on reviews alone is still written', !!run,
  `saved=${JSON.stringify(records.saved)}`);
if (run) {
  check('the word that finished its schedule is logged as retired',
    (run.mastered || []).includes('ประโยชน์'), JSON.stringify(run.mastered));
  check('the other keeps the recall it banked',
    (run.progress || []).some((p) => p.w === 'ใช้' && p.reps === 1), JSON.stringify(run.progress));
  check('reviews are not scored as new material', run.words === 0, `words=${run.words}`);
  check('and no new misses are invented', (run.misses || []).length === 0, JSON.stringify(run.misses));
}

// a sitting where nothing at all was answered is still not a round
records.saved.length = 0;
el('media-list').kids[0].onclick();
for (let i = 0; i < 6; i++) await new Promise((r) => queueMicrotask(r));
flush();
click('dict-exit');
await new Promise((r) => queueMicrotask(r));
check('glancing at an episode and leaving writes nothing', records.saved.length === 0,
  JSON.stringify(records.saved));

console.log(fails ? `\n${fails} FAILURES` : '\nall pass');
