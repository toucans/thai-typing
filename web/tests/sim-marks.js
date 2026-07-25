// Mark order: ต + า + ่ and ต + ่ + ่ + า both come out on screen as ต่าง.
//
// Nothing on a Linux Thai keyboard enforces the order a syllable's characters
// are stored in, and ่ and า are adjacent keys, so both of these come out of
// the fingers routinely. Compared code point by code point they are wrong —
// wrong with no visible difference to the answer, which is the state this
// simulation exists to keep out: the word rejected, the diff showing two lines
// that read the same, and retyping it correctly getting nowhere.
//
// So they must pass, exactly like the word typed in standard order does, while
// a genuinely wrong tone mark must still fail. This types character by
// character (a keystroke at a time, like a keyboard) rather than setting the
// box's value in one go — the length that triggers auto-submit is reached
// mid-word when a mark repeats, and that is precisely what used to break.
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

const SRT = `1
00:00:01,000 --> 00:00:03,000
สังคม|ต่าง|เพราะ|น้ำ
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

const { canonThai } = await import('./spell.ts');
const { initDictation, initDictationInput } = await import('./dictation.ts');

const box = el('dict-typebox');
const fire = (t, ev) => (box.listeners[t] || []).forEach((f) => f(ev));
// one keystroke at a time; a readOnly box swallows them, as the real one does
const type = (s) => {
  for (const ch of s) {
    if (box.readOnly) continue;
    box.value += ch;
    fire('input', { data: ch });
    flush();
  }
};
const key = (k, mods = {}) => {
  fire('keydown', { key: k, shiftKey: false, ctrlKey: false, ...mods, preventDefault(){} });
  flush();
};
const words = () => el('dict-words').innerHTML;
const ghost = () => el('dict-ghost').textContent;
const phase = () => el('dict-phase').textContent;

let fails = 0;
const check = (n, c, x = '') => { if (c) console.log(`ok   ${n}`); else { fails++; console.log(`FAIL ${n} ${x}`); } };

// ---- canonThai on its own -------------------------------------------------------
check('standard order is left alone', canonThai('ต่าง') === 'ต่าง');
check('mark typed after the vowel moves back', canonThai('ตา่ง') === 'ต่าง', canonThai('ตา่ง'));
check('a repeated mark collapses', canonThai('ต่่าง') === 'ต่าง', canonThai('ต่่าง'));
check('นำ้ is น้ำ', canonThai('นำ้') === 'น้ำ', canonThai('นำ้'));
check('two vowels to the right keep their order', canonThai('เพราะ') === 'เพราะ', canonThai('เพราะ'));
check('a different tone mark is still a different word', canonThai('ต้าง') !== canonThai('ต่าง'));
check('a missing mark is still missing', canonThai('ตาง') !== canonThai('ต่าง'));

// ---- and in the game ------------------------------------------------------------
initDictationInput();
localStorage.setItem('tt.dictMode', 'listen');
await initDictation();
el('media-list').kids[0].onclick();
for (let i = 0; i < 5; i++) await new Promise((r) => queueMicrotask(r));
flush();

type('สังคม');
check('cue started', words().includes('สังคม'), words());

// ต่าง with the tone mark typed after the vowel: right word, wrong keystroke order
type('ตา่ง');
check('mark after the vowel is accepted as the word', words().includes('ต่าง'), words());
check('no study screen for it', ghost() === '', ghost());
check('the standard order is shown', phase().includes('ลำดับปุ่ม'), phase());

// เพราะ typed correctly must not be disturbed by the reordering
type('เพราะ');
check('เพราะ passes unchanged', words().includes('เพราะ'), words());

// น้ำ with a repeated tone mark: the extra keystroke must not auto-submit early
type('น้้ำ');
check('a repeated mark still spells the word', words().includes('น้ำ'), words());
flush(); flush();

// ---- a real misspelling still fails, and now says why ---------------------------
await initDictation();
el('media-list').kids[0].onclick();
for (let i = 0; i < 5; i++) await new Promise((r) => queueMicrotask(r));
flush();
type('สังคม');
type('ต้าง'); // wrong tone mark — a genuine spelling miss
check('a wrong tone mark is still wrong', ghost() === 'ต่าง', ghost());
key('Enter');
type('ต้าง'); // wrong again in recall
check('a wrong recall goes back to study', ghost() === 'ต่าง', ghost());
check('a wrong recall now shows the diff', el('dict-diff').hidden === false);
check('the diff holds what was typed', el('dict-diff').textContent.includes('ต้าง'),
  el('dict-diff').textContent);
key('Enter');
type('ต่าง');
check('the right recall finally advances', words().includes('ต่าง'), words());

console.log(fails ? `\n${fails} FAILURES` : '\nall pass');
if (fails) Deno.exit(1);
