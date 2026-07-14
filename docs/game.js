// Standalone practice loop for GitHub Pages: an endless Thai word stream, type
// the highlighted word and tap space. No login, no level map, no server — the
// backend (progress, accounts, dictation) lives behind the VPN and is
// deliberately not reachable from here. Input comes through the Kedmanee map in
// kedmanee.js, so a Danish keyboard with no Thai layout plays fine.
//
// Word sampling reuses the real app's deterministic generator (lib/levels.js)
// so the words match what you practise at home; we just walk batches endlessly
// and never show a level number. Nothing is saved except a local best score in
// this browser's localStorage.
import { levelWords } from './lib/levels.js';
import { thaiFor, drawKeyboard } from './kedmanee.js';

const $ = (s) => document.querySelector(s);
const BEST_KEY = 'tt.standalone.best';

let words = [];      // the rolling stream
let i = 0;           // index of the current word
let typed = '';      // characters typed toward the current word
let batch = 0;       // next levelWords() batch to pull
let keys = 0, wrong = 0, correctChars = 0, t0 = null;
let highlight = () => {};

// Pull another deterministic batch onto the end of the stream. A random start
// each load means the session doesn't open with the same words every time.
function feed() {
  const { words: ws } = levelWords(batch++);
  words.push(...ws);
}

function ensureAhead() {
  while (words.length - i < 60) feed();
}

function reset() {
  words = [];
  i = 0; typed = '';
  batch = 1 + Math.floor(Math.random() * 300);
  keys = wrong = correctChars = 0; t0 = null;
  ensureAhead();
  render();
  updateStats();
}

// --- rendering -------------------------------------------------------------

function render() {
  const stream = $('#stream');
  stream.innerHTML = '';
  const from = Math.max(0, i - 6);
  const to = Math.min(words.length, i + 48);
  const target = words[i] || '';
  for (let k = from; k < to; k++) {
    // Each word is ONE text node on purpose: Thai stacks vowels and tone marks
    // onto the consonant, and that shaping only happens within a single run.
    // Splitting a word into per-character spans would scatter the marks onto
    // dotted circles, so progress is shown by the echo box, not by recolouring
    // letters. The current word just flips red when the typed prefix diverges.
    const w = document.createElement('span');
    w.className = 'w';
    w.textContent = words[k];
    if (k < i) w.classList.add('done');
    else if (k === i) {
      w.classList.add('cur');
      if (!target.startsWith(typed)) w.classList.add('bad');
    }
    stream.appendChild(w);
  }
  // echo: what you've typed toward this word, correctly shaped as its own run
  const echo = $('#echo');
  echo.textContent = typed;
  echo.classList.toggle('bad', !target.startsWith(typed));
  echo.classList.toggle('empty', typed.length === 0);
  highlight(typed.length >= target.length ? ' ' : target[typed.length]);
}

function updateStats() {
  const secs = t0 ? (performance.now() - t0) / 1000 : 0;
  const cpm = secs > 0 ? correctChars / (secs / 60) : 0;
  const acc = keys ? 1 - wrong / keys : 1;
  $('#cpm').textContent = Math.round(cpm);
  $('#acc').textContent = Math.round(acc * 100) + '%';
  $('#done').textContent = i;
  const best = Number(localStorage.getItem(BEST_KEY) || 0);
  if (cpm > best && i > 5) localStorage.setItem(BEST_KEY, String(Math.round(cpm)));
  $('#best').textContent = Math.max(best, Math.round(cpm)) || 0;
}

// --- input -----------------------------------------------------------------

function commit() {
  const target = words[i];
  if (typed === target) correctChars += target.length;
  i++;
  typed = '';
  ensureAhead();
  render();
  updateStats();
}

function onKey(e) {
  // leave real controls (buttons/links) to the browser
  if (e.target.closest('button, a')) return;

  if (e.key === 'Backspace') {
    e.preventDefault();
    typed = typed.slice(0, -1);
    render();
    return;
  }
  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    if (typed.length) commit();
    return;
  }
  const ch = thaiFor(e);
  if (ch == null) return;
  e.preventDefault();

  if (!t0) t0 = performance.now(); // clock starts on the first real keystroke
  const target = words[i] || '';
  const pos = typed.length;
  keys++;
  if (ch !== target[pos]) wrong++;
  typed += ch;
  render();
  updateStats();
}

// --- boot ------------------------------------------------------------------

function initTheme() {
  const KEY = 'tt.theme';
  const saved = localStorage.getItem(KEY);
  const dark = saved ? saved === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('#theme').onclick = (e) => {
    const now = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = now;
    localStorage.setItem(KEY, now);
    e.currentTarget.blur(); // keep keystrokes flowing to the game, not the button
  };
}

function initKeyboard() {
  const host = $('#keyboard');
  highlight = drawKeyboard(host);
  const KEY = 'tt.kbd';
  const on = (localStorage.getItem(KEY) ?? 'on') === 'on';
  host.classList.toggle('hidden', !on);
  $('#kbd-toggle').setAttribute('aria-pressed', String(on));
  $('#kbd-toggle').onclick = (e) => {
    const show = host.classList.toggle('hidden') === false;
    localStorage.setItem(KEY, show ? 'on' : 'off');
    $('#kbd-toggle').setAttribute('aria-pressed', String(show));
    e.currentTarget.blur();
  };
}

initTheme();
initKeyboard();
$('#restart').onclick = (e) => { reset(); e.currentTarget.blur(); };
window.addEventListener('keydown', onKey);
reset();
