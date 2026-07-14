// Kedmanee (เกษมณี) — the standard Thai keyboard layout — keyed by the
// *physical* key (KeyboardEvent.code), not by the character the OS produces.
//
// KeyboardEvent.code is the position of the key on the board and is independent
// of the active OS layout: KeyD is the physical key one row down, three in from
// the left, whether the machine is set to US, Danish, or Thai. So mapping code →
// Thai character reproduces exactly what a Thai (Kedmanee) layout would type on
// that same physical keyboard — which is the whole point of the standalone
// build: you can play from a Danish keyboard with no Thai layout installed at
// all. We read the physical key and supply the Thai letter ourselves.
//
// Danish boards are physically QWERTY, so every letter/vowel/tone key lines up.
// The only casualties are ฃ and ฅ (on the ANSI-only backslash key, which the
// Danish ISO board moves) — two letters obsolete in modern Thai and absent from
// the word pool, so nothing you can be asked to type is unreachable.

// code -> [base, shift]
export const KEDMANEE = {
  Backquote: ['_', '%'],
  Digit1: ['ๅ', '+'], Digit2: ['/', '๑'], Digit3: ['-', '๒'], Digit4: ['ภ', '๓'],
  Digit5: ['ถ', '๔'], Digit6: ['ุ', 'ู'], Digit7: ['ึ', '฿'], Digit8: ['ค', '๕'],
  Digit9: ['ต', '๖'], Digit0: ['จ', '๗'], Minus: ['ข', '๘'], Equal: ['ช', '๙'],

  KeyQ: ['ๆ', '๐'], KeyW: ['ไ', '"'], KeyE: ['ำ', 'ฎ'], KeyR: ['พ', 'ฑ'], KeyT: ['ะ', 'ธ'],
  KeyY: ['ั', 'ํ'], KeyU: ['ี', '๊'], KeyI: ['ร', 'ณ'], KeyO: ['น', 'ฯ'], KeyP: ['ย', 'ญ'],
  BracketLeft: ['บ', 'ฐ'], BracketRight: ['ล', ','], Backslash: ['ฃ', 'ฅ'],

  KeyA: ['ฟ', 'ฤ'], KeyS: ['ห', 'ฆ'], KeyD: ['ก', 'ฏ'], KeyF: ['ด', 'โ'], KeyG: ['เ', 'ฌ'],
  KeyH: ['้', '็'], KeyJ: ['่', '๋'], KeyK: ['า', 'ษ'], KeyL: ['ส', 'ศ'],
  Semicolon: ['ว', 'ซ'], Quote: ['ง', '.'],

  KeyZ: ['ผ', '('], KeyX: ['ป', ')'], KeyC: ['แ', 'ฉ'], KeyV: ['อ', 'ฮ'], KeyB: ['ิ', 'ฺ'],
  KeyN: ['ื', '์'], KeyM: ['ท', '?'], Comma: ['ม', 'ฒ'], Period: ['ใ', 'ฬ'], Slash: ['ฝ', 'ฦ'],
};

// The physical rows, in order, for drawing the on-screen board. Space is drawn
// separately. Enter/Backspace/Tab are not part of the Thai layer.
const ROWS = [
  ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight', 'Backslash'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'],
  ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
];

// char -> { code, shift }. First key that produces a character wins, so common
// letters resolve to their intended (usually unshifted) key.
export const CHAR_TO_KEY = (() => {
  const m = new Map();
  for (const [code, [base, shift]] of Object.entries(KEDMANEE)) {
    if (!m.has(base)) m.set(base, { code, shift: false });
    if (!m.has(shift)) m.set(shift, { code, shift: true });
  }
  return m;
})();

// Translate a physical keydown into the Thai character it types, or null if the
// key isn't part of the layer (or a modifier chord we should leave to the
// browser). Caller still handles Space / Backspace itself.
export function thaiFor(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  const pair = KEDMANEE[e.code];
  if (!pair) return null;
  return e.shiftKey ? pair[1] : pair[0];
}

// Draw the on-screen keyboard into `host`. Returns a highlight(char) function
// that lights the key you'd press next (and the Shift keys, if it's a shifted
// character). Pass null/'' to clear. The board is a teaching aid: a Danish
// keyboard has no Thai legends, so this shows where every letter lives.
export function drawKeyboard(host) {
  host.innerHTML = '';
  const keyEls = new Map(); // code -> element
  for (const row of ROWS) {
    const r = document.createElement('div');
    r.className = 'kbd-row';
    for (const code of row) {
      const [base, shift] = KEDMANEE[code];
      const k = document.createElement('div');
      k.className = 'kbd-key';
      k.innerHTML = `<span class="kbd-shift">${shift}</span><span class="kbd-base">${base}</span>`;
      r.appendChild(k);
      keyEls.set(code, k);
    }
    host.appendChild(r);
  }
  // bottom row: a wide Space, flanked by Shift markers we can light up
  const bottom = document.createElement('div');
  bottom.className = 'kbd-row';
  const lshift = document.createElement('div');
  lshift.className = 'kbd-key kbd-mod';
  lshift.textContent = '⇧';
  const space = document.createElement('div');
  space.className = 'kbd-key kbd-space';
  space.textContent = 'เว้นวรรค';
  const rshift = document.createElement('div');
  rshift.className = 'kbd-key kbd-mod';
  rshift.textContent = '⇧';
  bottom.append(lshift, space, rshift);
  host.appendChild(bottom);
  keyEls.set('Space', space);

  let lit = [];
  return function highlight(char) {
    for (const el of lit) el.classList.remove('next', 'next-shift');
    lit = [];
    if (char === ' ' || char === ' ') {
      space.classList.add('next');
      lit = [space];
      return;
    }
    const hit = char ? CHAR_TO_KEY.get(char) : null;
    if (!hit) return;
    const el = keyEls.get(hit.code);
    if (!el) return;
    el.classList.add(hit.shift ? 'next-shift' : 'next');
    lit = [el];
    if (hit.shift) {
      lshift.classList.add('next-shift');
      rshift.classList.add('next-shift');
      lit.push(lshift, rshift);
    }
  };
}
