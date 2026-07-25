// The played window: a cue is played past its timestamp, because subtitle
// timings are display windows and the last word is often still being spoken when
// the cue's `end` arrives (see playWindows() in dictation.ts). This sim pins the
// rule down — both the arithmetic on a crafted .srt and the media element the
// real state machine actually drives.
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

// Four cues built so the file's median speaking rate is exactly 10 chars/s
// (rates 10, 20, 5, 10), which makes every window below arithmetic, not taste:
//
//   1  1.000-2.800  18 chars in 1.8s = the median rate: no shortfall, so it gets
//                   the 0.6s floor -> 3.400, and cue 2 is far enough away to
//                   leave that alone
//   2  5.000-5.900  18 chars crammed into 0.9s: needs 1.8s, so 0.9s of grace ->
//                   6.800, running into cue 3 — which butts onto it, so those
//                   words are this cue's own tail, not the next line
//   3  5.900-7.900  10 chars in 2.0s, slack to spare: the 0.6s floor would reach
//                   8.500, but cue 4 starts a real 0.3s gap later, so the tail
//                   stops a 0.2s peek into it -> 8.400
//   4  8.200-10.000 last cue: nothing to clamp against -> 10.600
const SRT = `1
00:00:01,000 --> 00:00:02,800
ผู้ใหญ่|ใช้|ประโยชน์|จาก|ใจ

2
00:00:05,000 --> 00:00:05,900
ผู้ใหญ่|ใช้|ประโยชน์|จาก|ใจ

3
00:00:05,900 --> 00:00:07,900
เขา|มั่น|ใจ|มาก

4
00:00:08,200 --> 00:00:10,000
ผู้ใหญ่|ใช้|ประโยชน์|จาก|ใจ
`;
globalThis.fetch = async () => ({
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

const { initDictation, initDictationInput, parseSRT } = await import('./dictation.ts');

let fails = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { fails++; console.log(`FAIL ${name} ${extra}`); }
};
const near = (a, b) => Math.abs(a - b) < 1e-6;

// ---- the window arithmetic -----------------------------------------------------
const cues = parseSRT(SRT);
check('every cue parsed', cues.length === 4, `got ${cues.length}`);
check('a cue at the file\'s own rate gets the 0.6s floor', near(cues[0].stop, 3.4), `stop=${cues[0].stop}`);
check('a crammed cue gets the time its text needs', near(cues[1].stop, 6.8), `stop=${cues[1].stop}`);
check('that tail runs into the cue that butts onto it', cues[1].stop > cues[2].start,
  `stop=${cues[1].stop} next=${cues[2].start}`);
check('a tail crossing a real gap stops at a 0.2s peek', near(cues[2].stop, 8.4), `stop=${cues[2].stop}`);
check('the last cue keeps its full tail', near(cues[3].stop, 10.6), `stop=${cues[3].stop}`);
check('no cue ever stops before its own timestamp', cues.every((c) => c.stop >= c.end));

// ---- what the media element is actually told ------------------------------------
initDictationInput();
localStorage.setItem('tt.dictMode', 'listen');
await initDictation();
const list = el('media-list');
list.kids[0].onclick();
for (let i = 0; i < 3; i++) await new Promise((r) => queueMicrotask(r));
flush();

const media = el('dict-media');
let paused = 0;
media.pause = () => { paused++; };
const clock = (t) => { media.currentTime = t; if (media.ontimeupdate) media.ontimeupdate(); };

check('playback starts a 0.15s run-up before the cue', near(media.currentTime, 0.85),
  `currentTime=${media.currentTime}`);
clock(2.8);
check('the timestamp end does not stop it', paused === 0, `paused=${paused}`);
clock(3.3);
check('nor does anything up to the tail', paused === 0, `paused=${paused}`);
clock(3.4);
check('the tail stops it', paused === 1, `paused=${paused}`);
clock(3.9);
check('and it only stops once', paused === 1, `paused=${paused}`);

// A tail past the end of the file must not chase a time the media can never reach.
paused = 0;
media.duration = 3.0;
el('dict-typebox').listeners.keydown.forEach((f) => f({ key: 'Tab', shiftKey: false, preventDefault(){} }));
flush();
clock(3.0);
check('a tail past the end of the media stops at the end', paused === 1, `paused=${paused}`);

console.log(fails ? `\n${fails} FAILED` : '\nall ok');
if (fails) Deno.exit(1);
