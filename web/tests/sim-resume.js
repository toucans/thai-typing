// An episode is longer than a sitting, so where you stopped has to survive the
// sitting. Two ways a round ends, and they must not be the same:
//
//   the cues ran out    -> the media is done, start it fresh next time
//   you pressed จบรอบนี้ -> come back to the cue you were on
//
// The place is kept in two stores and the furthest wins: localStorage (written
// every cue, so closing the tab is safe, but per-device) and `lastCue` in the
// run log (across devices, and survives a cleared browser).
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
const timers = [];
globalThis.setTimeout = (f) => { timers.push(f); return 0; };
const flush = () => { while (timers.length) timers.shift()(); };

// a five-cue "episode"
const SRT = [1, 2, 3, 4, 5].map((n) => `${n}
00:00:0${n},000 --> 00:00:0${n + 1},000
เขา|ดี|มาก
`).join('\n');

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

// Deno ships a real localStorage and a plain assignment cannot shadow it, so
// these tests read and write the very key the app uses. Start from nothing.
const KEY = 'tt.dict.ep01';
localStorage.removeItem(KEY);
localStorage.setItem('tt.dictMode', 'listen');

const records = await import('./records.ts');
const { initDictation, initDictationInput } = await import('./dictation.ts');
const box = el('dict-typebox');
const fire = (t, ev) => (box.listeners[t] || []).forEach((f) => f(ev));
const type = (s) => { box.value = s; fire('input', { data: s.slice(-1) }); flush(); };
const cue = () => el('dict-cue-no').textContent;
const cueNo = () => +(cue().match(/ท่อนที่ (\d+)/) || [0, 0])[1];
const saved = () => localStorage.getItem(KEY);

let fails = 0;
const check = (n, c, x = '') => { if (c) console.log(`ok   ${n}`); else { fails++; console.log(`FAIL ${n} ${x}`); } };

const open = async () => {
  await initDictation();
  el('media-list').kids.at(-1).onclick();
  for (let i = 0; i < 6; i++) await new Promise((r) => queueMicrotask(r));
  flush();
};
const typeCue = async () => {
  type('เขา'); type('ดี'); type('มาก');
  flush(); flush();
  await new Promise((r) => queueMicrotask(r));
};
const stopForTheNight = async () => {
  (el('dict-finish').listeners.click || []).forEach((f) => f());
  flush();
  if (globalThis.__modalGo) globalThis.__modalGo(); // the จบรอบ confirm
  for (let i = 0; i < 8; i++) await new Promise((r) => queueMicrotask(r));
  flush();
};

initDictationInput();

// ---- sitting one: three of five cues, then stop -------------------------------
records.setHistory([]);
await open();
check('a fresh episode opens at cue 1', cueNo() === 1, cue());
for (const _ of [1, 2, 3]) await typeCue();
check('the place is tracked while you play', saved() === '3', `saved=${saved()}`);

await stopForTheNight();
const run1 = records.saved[0];
console.log('--- run 1:', JSON.stringify(run1));
check('stopping still saves the run', run1 && run1.cues === 3, JSON.stringify(run1));
check('stopping keeps the place on this device', saved() === '3', `saved=${saved()}`);
check('and records it in the run log for other devices', run1.lastCue === 3, `lastCue=${run1.lastCue}`);

// ---- sitting two: reopen ------------------------------------------------------
records.setHistory([run1]);
records.saved.length = 0;
await open();
check('reopening resumes where you stopped', cueNo() === 4, cue());

// ---- the run log alone is enough (new device / cleared browser) ---------------
localStorage.removeItem(KEY);
await open();
check('the run log alone can resume it', cueNo() === 4, cue());

// ---- finishing the episode clears the mark ------------------------------------
for (const _ of [4, 5]) await typeCue();
let guard = 0;
while (guard++ < 40 && !records.saved.length) { flush(); await new Promise((r) => queueMicrotask(r)); }
const run2 = records.saved[0];
console.log('--- run 2:', JSON.stringify(run2));
check('reaching the end saves a run with no place to return to',
  run2 && run2.lastCue === undefined, `lastCue=${run2 && run2.lastCue}`);
check('and clears the device mark', saved() === null, `saved=${saved()}`);

records.setHistory([run1, run2]);
await open();
check('a finished episode opens at cue 1 again', cueNo() === 1, cue());

console.log(fails ? `\n${fails} FAILURES` : '\nall pass');
