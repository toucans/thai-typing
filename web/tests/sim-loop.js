// Drive the real dictation.js state machine against a stub DOM.
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

const SRT = `1
00:00:01,000 --> 00:00:03,000
ผู้ใหญ่|ใช้|ประโยชน์|จาก|ศาสตร์

2
00:00:04,000 --> 00:00:06,000
เขา|มั่น|ใจ|มาก
`;
globalThis.fetch = async (url) => ({
  ok: true,
  json: async () => ({ pairs: [{ name: 'ep01', media: 'a.mp4', subs: 'a.srt' }] }),
  text: async () => SRT,
});
globalThis.performance = { now: () => 0 };
globalThis.document = {
  createElement: () => ({ className: '', innerHTML: '', onclick: null,
    querySelector(sel){ return sel.includes('restart') ? null : { set onclick(f){} }; } }),
  querySelectorAll: () => [],
  dispatchEvent(){}, addEventListener(){},
};
globalThis.CustomEvent = class {};

const { initDictation, initDictationInput } = await import('./dictation.ts');
const records = await import('./records.ts');

const box = el('dict-typebox');
const fire = (type, ev) => (box.listeners[type] || []).forEach((f) => f(ev));
const type = (s) => { box.value = s; fire('input', { data: s.slice(-1) }); flush(); };
// a guess shorter than the answer never reaches the auto-submit length, so it
// has to be committed with Enter — that is what Enter is for
const submit = (s) => { box.value = s; fire('input', { data: s.slice(-1) }); key('Enter'); };
const key = (k, mods = {}) => { fire('keydown', { key: k, shiftKey: false, ...mods, preventDefault(){} }); flush(); };
const peek = () => key('Tab', { shiftKey: true }); // ดูทั้งท่อน
const state = () => ({
  cue: el('dict-cue-no').textContent,
  slot: el('dict-words').innerHTML,
  ghost: el('dict-ghost').textContent,
  phase: el('dict-phase').textContent,
  diffHidden: el('dict-diff').hidden,
});

let fails = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { fails++; console.log(`FAIL ${name} ${extra}`); }
};

// ---- run -----------------------------------------------------------------------
initDictationInput();
localStorage.setItem('tt.dictMode', 'listen');
await initDictation();
const list = el('media-list');
list.kids[0].onclick();
await new Promise((r) => queueMicrotask(r));
await new Promise((r) => queueMicrotask(r));
await new Promise((r) => queueMicrotask(r));
flush();

console.log('--- cue 1 loaded:', state().cue);
check('answer hidden at the start', state().ghost === '', `ghost=${state().ghost}`);

// ดูทั้งท่อน: Shift+Tab puts the whole cue up, and puts it away again
check('cue starts covered', state().slot.includes('▁▁') && !state().slot.includes('ศาสตร์'), state().slot);
peek();
check('peek reveals the whole line',
  ['ผู้ใหญ่', 'ใช้', 'ประโยชน์', 'จาก', 'ศาสตร์'].every((w) => state().slot.includes(w))
  && !state().slot.includes('▁▁'), state().slot);
peek();
check('peek toggles back off', state().slot.includes('▁▁') && !state().slot.includes('ศาสตร์'), state().slot);

// word 1: ผู้ใหญ่ — get it right first try
type('ผู้ใหญ่');
check('correct guess advances without revealing', state().ghost === '', `ghost=${state().ghost}`);

// word 2: ใช้ — one Esc commits the blank guess and reveals; there is no second
// press to make (the nudge it used to give is gone)
key('Escape');
check('one Esc commits the blank and reveals', state().ghost === 'ใช้', `ghost=${state().ghost}`);
check('study phase asks for Enter', state().phase.includes('Enter'), state().phase);

// Enter -> recall: the answer must be GONE
key('Enter');
check('recall hides the answer', state().ghost === '', `ghost=${state().ghost}`);
check('recall hides the diff', state().diffHidden === true);
check('recall prompts from memory', state().phase.includes('ความจำ'), state().phase);
check('box is empty for recall', box.value === '');

// wrong recall -> back to study
type('ใข้');
check('wrong recall re-shows the answer', state().ghost === 'ใช้', `ghost=${state().ghost}`);
key('Enter');
type('ใช้');
check('right recall advances', state().ghost === '' && state().phase === '');

// word 3: ประโยชน์ — a real guess that is wrong and shorter than the answer, so
// it is committed with Enter; it should produce an aligned diff
submit('ประโยด');
check('wrong guess shows the diff', state().diffHidden === false);
check('diff names the answer', el('dict-diff').innerHTML.includes('ช'));
check('wrong guess shows the answer', state().ghost === 'ประโยชน์', state().ghost);
key('Enter'); type('ประโยชน์');

// finish the cue, with the line left showing: a peek must not survive the cue
// it was asked for, or it quietly turns the session into ดูแล้วพิมพ์
type('จาก');
peek();
type('ศาสตร์');
flush(); flush();

console.log('--- after cue 1:', state().cue);
check('the next cue starts covered again',
  state().slot.includes('▁▁') && !state().slot.includes('มาก'), state().slot);

// cue 2
type('เขา'); type('มั่น'); type('ใจ'); type('มาก');
flush(); flush();
console.log('--- after cue 2:', state().cue);

// the two missed words must come back as drills before the session can end
let guard = 0;
const drilled = [];
while (guard++ < 40 && !records.saved.length) {
  const cue = state().cue;
  if (cue.startsWith('ทบทวน')) {
    // recover the blanked word by revealing it (one Esc), then recall it
    key('Escape');
    const answer = state().ghost;
    drilled.push(answer);
    key('Enter'); type(answer);
  } else {
    type('x'); // shouldn't happen
  }
  flush();
}
check('missed words came back as drills', drilled.length > 0, `drilled=${JSON.stringify(drilled)}`);
check('drills covered both misses',
  drilled.includes('ใช้') && drilled.includes('ประโยชน์'), JSON.stringify(drilled));
check('session ended', records.saved.length === 1);

const run = records.saved[0];
console.log('--- saved run:', JSON.stringify(run, null, 1));
check('run logs the misses', (run.misses || []).length === 2, JSON.stringify(run.misses));
check('a miss records only the word and its cue',
  (run.misses || []).every((m) => Object.keys(m).sort().join() === 'cue,w'), JSON.stringify(run.misses));
check('accuracy counts only first guesses', run.words === 9 && run.acc === Math.round((7 / 9) * 1000) / 1000,
  `words=${run.words} acc=${run.acc}`);

console.log(fails ? `\n${fails} FAILURES` : '\nall pass');
