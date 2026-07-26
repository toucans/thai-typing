// Session 2: words owed from a previous run must open the session, and a word
// answered cleanly through its whole schedule must retire (mastered).
const els = new Map();
function el(id) {
  if (!els.has(id)) {
    const listeners = {};
    // innerHTML and textContent must track each other the way the real DOM does
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
      // reflect appended spans into innerHTML so the sim can read the rendered cue
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
// a previous run that missed two words and mastered neither
records.setHistory([{
  game: 'dictation', name: 'ep01', t: '2026-07-24T10:00:00Z', words: 9, acc: 0.78,
  misses: [{ w: 'ใช้', g: '', tags: ['saraAi'], cue: 0 },
           { w: 'ประโยชน์', g: 'ประโยด', tags: ['silent'], cue: 0 }],
  mastered: [],
  // ประโยชน์ was two thirds of the way home when that round ended
  progress: [{ w: 'ประโยชน์', reps: 2 }],
}]);

const { initDictation, initDictationInput } = await import('./dictation.ts');
const box = el('dict-typebox');
const fire = (t, ev) => (box.listeners[t] || []).forEach((f) => f(ev));
const type = (s) => { box.value = s; fire('input', { data: s.slice(-1) }); flush(); };
const key = (k) => { fire('keydown', { key: k, shiftKey: false, preventDefault(){} }); flush(); };
const cue = () => el('dict-cue-no').textContent;

let fails = 0;
const check = (n, c, x = '') => { if (c) console.log(`ok   ${n}`); else { fails++; console.log(`FAIL ${n} ${x}`); } };

initDictationInput();
localStorage.setItem('tt.dictMode', 'listen');
await initDictation();
el('media-list').kids[0].onclick();
for (let i = 0; i < 6; i++) await new Promise((r) => queueMicrotask(r));
flush();

check('session opens on carried-over words', cue().startsWith('ทบทวนคำเก่า'), `cue=${cue()}`);
check('the opening round is not announced by a modal',
  !__modals.some((m) => m.includes('ทบทวนคำเก่า')), JSON.stringify(__modals));

// answer every drill cleanly on the first guess; type the real cue words too
const CUE_WORDS = [['ผู้ใหญ่','ใช้','ประโยชน์','จาก','ศาสตร์'], ['เขา','มั่น','ใจ','มาก']];
const DRILL_ANSWERS = { 'ใช้': 'ใช้', 'ประโยชน์': 'ประโยชน์' };
const seen = [];
const labels = [];
let guard = 0;
while (guard++ < 120 && !records.saved.length) {
  const c = cue();
  if (c.startsWith('ทบทวน')) {
    // recover which word is blanked, then answer it right on the first try
    const shown = el('dict-words').innerHTML;
    const word = Object.keys(DRILL_ANSWERS).find((w) => !shown.includes(w));
    if (!word) { console.log('could not identify drill word:', shown); break; }
    seen.push(word);
    labels.push(`${word} ${c.replace('ทบทวนคำเก่า · ', '')}`);
    type(DRILL_ANSWERS[word]);
  } else {
    const n = +c.match(/ท่อนที่ (\d+)/)[1];
    for (const w of CUE_WORDS[n - 1]) type(w);
  }
  flush();
}

console.log("guard:", guard, "seen:", JSON.stringify(seen));
const run = records.saved[0];
check('session ended', !!run);
check('every carried word is drilled', new Set(seen).size === 2, JSON.stringify(seen));
check('a word with nothing banked retires after 3 clean recalls',
  seen.filter((w) => w === 'ใช้').length === 3, JSON.stringify(seen));
check('both words retire',
  (run.mastered || []).includes('ใช้') && (run.mastered || []).includes('ประโยชน์'),
  JSON.stringify(run.mastered));
// ---- banked recalls survive the end of a round -------------------------------
check('a word resumes where it got to, rather than restarting at 1/3',
  labels[0] === 'ประโยชน์ 3/3' || labels.includes('ประโยชน์ 3/3'), JSON.stringify(labels));
check('a word with nothing banked still starts at 1/3',
  labels.includes('ใช้ 1/3'), JSON.stringify(labels));
check('the resumed word retires on that one recall',
  seen.filter((w) => w === 'ประโยชน์').length === 1,
  `asked ${seen.filter((w) => w === 'ประโยชน์').length} times`);

check('a clean session logs no new misses', (run.misses || []).length === 0, JSON.stringify(run.misses));
check('drills do not pollute accuracy', run.words === 9 && run.acc === 1, `words=${run.words} acc=${run.acc}`);
console.log('drill order:', JSON.stringify(seen));
console.log('mastered:', JSON.stringify(run && run.mastered));
console.log(fails ? `\n${fails} FAILURES` : '\nall pass');
