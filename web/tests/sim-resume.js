// An episode is longer than a sitting, so where you stopped has to survive the
// sitting. Two ways a round ends, and they must not be the same:
//
//   the cues ran out  -> the media is done, start it fresh next time
//   you left the view -> come back to the cue you were on
//
// The place is kept in two stores and the furthest wins: localStorage (written
// every cue, exact, but per-device) and a cursor on the server (api/resume,
// posted on a timer while you type, so a tab that dies takes at most one tick
// of progress with it, and another device can pick the episode up).
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

// a seven-cue "episode"
const SRT = [1, 2, 3, 4, 5, 6, 7].map((n) => `${n}
00:00:0${n},000 --> 00:00:0${n + 1},000
เขา|ดี|มาก
`).join('\n');

// stands in for <data>/users/<name>.resume.json
const server = { resume: {} };
let offline = false;
globalThis.fetch = async (url, opts = {}) => {
  if (offline) throw new Error('offline');
  if (String(url).startsWith('api/resume')) {
    if (opts.method === 'POST') {
      const b = JSON.parse(opts.body);
      if (b.cue === 0) delete server.resume[b.media];
      else server.resume[b.media] = b.cue;
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({ resume: { ...server.resume } }) };
  }
  return {
    ok: true,
    json: async () => ({ pairs: [{ name: 'ep01', media: 'a.mp4', subs: 'a.srt' }] }),
    text: async () => SRT,
  };
};
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
const { initDictation, initDictationInput, leaveDictation } = await import('./dictation.ts');
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
// stopping is just leaving: no button, no confirm
const stopForTheNight = async () => {
  leaveDictation();
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

check('the place reaches the server while you type, without ending the round',
  server.resume.ep01 === 3, JSON.stringify(server.resume));

await stopForTheNight();
const run1 = records.saved[0];
console.log('--- run 1:', JSON.stringify(run1));
check('leaving the view saves the round, with no button pressed',
  run1 && run1.cues === 3, JSON.stringify(run1));
check('the run log carries no cursor — it is finished runs only',
  run1.lastCue === undefined, JSON.stringify(run1));
check('stopping keeps the place on this device', saved() === '3', `saved=${saved()}`);

// ---- leaving without typing anything is not a round --------------------------
records.saved.length = 0;
await open();
leaveDictation();
for (let i = 0; i < 4; i++) await new Promise((r) => queueMicrotask(r));
flush();
check('glancing at a file and leaving writes nothing', records.saved.length === 0,
  JSON.stringify(records.saved));

// ---- sitting two: reopen ------------------------------------------------------
records.saved.length = 0;
await open();
check('reopening resumes where you stopped', cueNo() === 4, cue());

// ---- the server alone is enough (new device / cleared browser) ----------------
localStorage.removeItem(KEY);
await open();
check('the server cursor alone can resume it', cueNo() === 4, cue());

// ---- an unreachable server must not lose the place, or forget to catch up -----
offline = true;
await typeCue();                         // cue 4: the post fails
check('an unreachable server does not lose the place locally', saved() === '4', `saved=${saved()}`);
check('and the server simply keeps its older mark', server.resume.ep01 === 3,
  JSON.stringify(server.resume));
offline = false;
await typeCue();                         // cue 5: the queued post goes out
check('the place catches up once the server is back', server.resume.ep01 === 5,
  JSON.stringify(server.resume));

// ---- finishing the episode clears the mark ------------------------------------
let guard = 0;
while (guard++ < 40 && !records.saved.length) {
  await typeCue();
  flush();
  await new Promise((r) => queueMicrotask(r));
}
const run2 = records.saved[0];
console.log('--- run 2:', JSON.stringify(run2));
check('reaching the end saves a run', !!run2, JSON.stringify(run2));
check('and clears the device mark', saved() === null, `saved=${saved()}`);
check('and clears the server cursor', server.resume.ep01 === undefined, JSON.stringify(server.resume));

await open();
check('a finished episode opens at cue 1 again', cueNo() === 1, cue());

console.log(fails ? `\n${fails} FAILURES` : '\nall pass');
