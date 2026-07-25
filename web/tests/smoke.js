// End-to-end smoke test: boot the *built bundle* (web/app.js) against a stub
// DOM and walk a story through เรื่องอ่าน. There is no chromium on this box, so
// this is the closest thing to "open the page and try it":
//
//   - it loads app.js exactly as index.html does, so a module that throws at
//     import time, or a $() that misses (they throw now), fails the test;
//   - it checks every selector against index.html's real ids, so deleting
//     markup out from under the code is caught here;
//   - it types through a punctuation-heavy story to pin down which tokens the
//     wordstream asks for — the one rule being that you type the Thai and read
//     the rest (see hasThai in src/segment.ts).
//
// The sims next door drive the dictation *modules* with stubs; this drives the
// shipped bundle. Run it via tests/run.sh, which builds first.

const html = await Deno.readTextFile(new URL('../index.html', import.meta.url));
const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));

// a Thai news lead: quotes, a year, a percentage, parens, an acronym, an em dash
const BODY = 'นายกฯ กล่าวว่า "เราจะเดินหน้าต่อ" ในปี 2568 (ราว 65%) ตามแผน MOU ที่ลงนามไว้ — ไม่มีการเปลี่ยนแปลง';

let fails = 0;
const check = (name, cond, extra = '') => {
  if (cond) console.log(`ok   ${name}`);
  else { fails++; console.log(`FAIL ${name} ${extra}`); }
};

// ---- the stub DOM --------------------------------------------------------------
// Deliberately dumb: enough for the app to build and mutate elements, and it
// records the classes it was given so the test can read the result back.
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}), set: () => true });
const spans = []; // every span the wordstream builds

class El {
  constructor(sel) {
    this.sel = sel; this.dataset = {}; this.style = {}; this.cls = new Set();
    this.kids = []; this.listeners = {};
    this.value = ''; this.textContent = ''; this.innerHTML = ''; this.placeholder = '';
    this.hidden = false; this.readOnly = false; this.disabled = false;
    this.width = 320; this.height = 180; this.offsetTop = 0; this.offsetWidth = 1;
    this.parentElement = null; this.offsetParent = null;
    this.classList = {
      add: (...c) => c.forEach((x) => this.cls.add(x)),
      remove: (...c) => c.forEach((x) => this.cls.delete(x)),
      toggle: (c, on) => (on ? this.cls.add(c) : this.cls.delete(c)),
      contains: (c) => this.cls.has(c),
    };
  }
  getContext() { return ctx2d; }
  addEventListener(t, f) { this.listeners[t] = f; }
  removeEventListener() {}
  appendChild(c) { this.kids.push(c); if (this.sel === '#wordstream') spans.push(c); return c; }
  append(...c) { this.kids.push(...c); }
  remove() {} focus() {} removeAttribute() {} scrollTo() {}
  querySelector() { return new El('sub'); }
  querySelectorAll() { return []; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 320, height: 180 }; }
}
class Canvas extends El {}
globalThis.HTMLCanvasElement = Canvas;
globalThis.HTMLElement = El;

const asked = new Set();
const cache = new Map();
const lookup = (sel) => {
  asked.add(sel);
  const id = sel.startsWith('#') ? sel.slice(1) : null;
  // #dict-skip is injected into #dict-phase's markup at runtime, not in index.html
  if (id && !ids.has(id) && id !== 'dict-skip') return null;
  if (!cache.has(sel)) {
    cache.set(sel, /canvas|pixelmap|hero-art|hero-fx|confetti/.test(sel) ? new Canvas(sel) : new El(sel));
  }
  return cache.get(sel);
};

const navBtns = ['journey', 'dictation', 'texts', 'news', 'stats'].map((v) => {
  const b = new El('navbtn');
  b.dataset.view = v;
  return b;
});

globalThis.document = {
  documentElement: new El('html'),
  querySelector: lookup,
  querySelectorAll: (sel) => (sel === '#nav button' ? navBtns : []),
  getElementById: (id) => lookup('#' + id),
  createElement: (t) => (t === 'canvas' ? new Canvas(t) : new El(t)),
  addEventListener() {}, dispatchEvent() {}, hidden: false,
};
// self !== top is the app's own "embedded in the dashboard preview tile" signal:
// it stays silent, which spares this test a WebAudio stub. See src/audio.ts.
globalThis.window = { self: 1, top: 2, addEventListener() {}, scrollTo() {}, gsap: undefined };
globalThis.self = 1;
globalThis.top = 2;
globalThis.matchMedia = () => ({ matches: false });
globalThis.getComputedStyle = () => ({ color: '#000' });
globalThis.requestAnimationFrame = () => 0;
globalThis.cancelAnimationFrame = () => {};
globalThis.addEventListener = () => {};
globalThis.scrollBy = () => {};
globalThis.innerWidth = 1200;
globalThis.innerHeight = 800;
globalThis.devicePixelRatio = 1;
globalThis.CustomEvent = class {};
globalThis.confirm = () => false;
globalThis.fetch = async (url) => ({
  ok: true, status: 200,
  json: async () => (url.includes('api/texts')
    ? { texts: [{ name: 'punct.txt', title: 'ทดสอบ', path: 'texts/punct.txt' }] }
    : { runs: [] }),
  text: async () => 'ทดสอบ\n' + BODY, // first line is the title
});

// ---- boot ---------------------------------------------------------------------
await import('../app.js');
await new Promise((r) => setTimeout(r, 30));
check(`the bundle boots (${asked.size} selectors resolved)`, true);

// ---- เรื่องอ่าน: open a story the way a user does ------------------------------
navBtns.find((b) => b.dataset.view === 'texts').listeners.click();
await new Promise((r) => setTimeout(r, 30));
const list = lookup('#texts-list');
check('the story list renders a card', list.kids.length === 1, `cards=${list.kids.length}`);

await list.kids[0].onclick();
await new Promise((r) => setTimeout(r, 30));
check('opening it builds the wordstream', spans.length > 0, `spans=${spans.length}`);

const isThai = (w) => /[฀-๿]/.test(w);
const skipped = spans.filter((sp) => sp.cls.has('skip'));
const typeable = spans.filter((sp) => !sp.cls.has('skip'));
console.log('   context:', skipped.map((sp) => JSON.stringify(sp.textContent)).join(' '));

check('every non-Thai token is marked context', skipped.every((sp) => !isThai(sp.textContent)),
  skipped.map((sp) => sp.textContent).join(' '));
check('every Thai token is left to type', typeable.every((sp) => isThai(sp.textContent)),
  typeable.filter((sp) => !isThai(sp.textContent)).map((sp) => sp.textContent).join(' '));
check('context is dimmed before the cursor gets there', skipped.length > 0 && !skipped[0].cls.has('ok'));
check('the cursor starts on a Thai word',
  isThai((spans.find((sp) => sp.cls.has('cur')) || {}).textContent || ''));

// ---- type it through ----------------------------------------------------------
const box = lookup('#typebox');
for (const sp of spans) {
  if (sp.cls.has('skip')) continue; // never your turn
  const w = sp.textContent;
  for (let i = 1; i <= w.length; i++) {
    box.value = w.slice(0, i);
    box.listeners.input({ data: w[i - 1] });
  }
  // a token the source followed with a real space is committed with a space
  if (!sp.cls.has('ok') && !sp.cls.has('err')) {
    box.value = w + ' ';
    box.listeners.input({ data: ' ' });
  }
}
await new Promise((r) => setTimeout(r, 30));

const wrong = spans.filter((sp) => sp.cls.has('err'));
check('typing only the Thai finishes the story clean', wrong.length === 0,
  wrong.map((sp) => JSON.stringify(sp.textContent)).join(' '));
check('every token ends up typed or stepped over',
  spans.every((sp) => sp.cls.has('ok') || sp.cls.has('skip')),
  spans.filter((sp) => !sp.cls.has('ok') && !sp.cls.has('skip')).map((sp) => sp.textContent).join(' '));

console.log(fails ? `\n${fails} FAILURES` : '\nall pass');
Deno.exit(fails ? 1 : 0); // the map/hero tickers keep the loop alive otherwise
