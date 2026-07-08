// The speed game: 10fastfingers-style word stream. Type the highlighted word,
// hit space to commit. Also drives free-text mode (same engine, words in order).
//
// Levels are generated, not stored: a seeded PRNG samples the frequency-ordered
// word pool, with the sampling window widening as levels rise. Every level is
// deterministic, so replaying "ด่าน 217" always gives the same words.
import { WORDS } from './data/words.js';
import { SENTENCES } from './data/sentences.js';
import { sound } from './audio.js';
import { music } from './music.js';
import { loadRuns, saveRun, stats } from './records.js';
import { $, show, modal, closeModal, confetti, setRegion, segmentThai, REGION_SIZE, TOTAL_LEVELS } from './ui.js';
import { BY_LEVEL, thaiNum } from './data/mongkhon.js';

const WORDS_PER_LEVEL = 25;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function levelWords(level) {
  const rng = mulberry32(level + 4801);
  // every 10th level is a bonus: proverbs and nature lines instead of word salad
  if (level % 10 === 0) {
    const words = [];
    const used = new Set();
    while (words.length < 18 && used.size < SENTENCES.length) {
      const s = SENTENCES[Math.floor(rng() * SENTENCES.length)];
      if (used.has(s)) continue;
      used.add(s);
      words.push(...segmentThai(s));
    }
    return { words, bonus: true };
  }
  const pool = Math.min(WORDS.length, 90 + level * 3);
  const words = [];
  let last = -1;
  while (words.length < WORDS_PER_LEVEL) {
    const i = Math.floor(Math.pow(rng(), 1.6) * pool); // bias toward frequent words
    if (i === last) continue;
    last = i;
    words.push(WORDS[i]);
  }
  return { words, bonus: false };
}

let S = null; // current session

export function startLevel(level) {
  const { words, bonus } = levelWords(level);
  setRegion(Math.floor((level - 1) / REGION_SIZE));
  begin({
    mode: 'speed', level, words,
    title: bonus ? `ด่าน ${level} · โบนัสสุภาษิต 🍃` : `ด่าน ${level}`,
    backView: 'journey',
  });
}

export function startText(name, title, words) {
  begin({ mode: 'text', name, words, title, backView: 'texts' });
}

function begin(cfg) {
  S = { ...cfg, idx: 0, keys: 0, wrong: 0, correctChars: 0, t0: null, done: false };
  $('#play-title').textContent = S.title;
  $('#play-progress').style.width = '0';
  const stream = $('#wordstream');
  stream.innerHTML = '';
  S.spans = S.words.map((w) => {
    const sp = document.createElement('span');
    sp.textContent = w;
    stream.appendChild(sp);
    return sp;
  });
  S.spans[0].classList.add('cur');
  show('play');
  if (S.mode === 'speed') music.playForLevel(S.level);
  else music.playForName(S.name || S.title);
  const box = $('#typebox');
  box.value = '';
  box.placeholder = 'พิมพ์คำ แล้วเคาะวรรคเพื่อส่ง…'; // shown until the first keystroke
  box.focus();
}

function scrollCurrentIntoView() {
  const stream = $('#wordstream');
  const sp = S.spans[S.idx];
  if (sp) stream.scrollTop = Math.max(0, sp.offsetTop - stream.offsetTop - 8);
}

function commitWord(typed) {
  const target = S.words[S.idx];
  const sp = S.spans[S.idx];
  sp.classList.remove('cur', 'bad');
  const ok = typed === target;
  sp.classList.add(ok ? 'ok' : 'err');
  if (ok) { S.correctChars += target.length; sound.word(); } else { sound.error(); }
  S.idx++;
  $('#play-progress').style.width = `${(S.idx / S.words.length) * 100}%`;
  if (S.idx >= S.words.length) return finish();
  S.spans[S.idx].classList.add('cur');
  scrollCurrentIntoView();
}

async function finish() {
  S.done = true;
  const secs = (performance.now() - S.t0) / 1000;
  const cpm = Math.round((S.correctChars / (secs / 60)) * 10) / 10;
  const acc = Math.round((S.keys ? 1 - S.wrong / S.keys : 1) * 1000) / 1000;

  const st = stats(await loadRuns());
  let stars = 0;
  if (acc >= 0.90) stars = 1;
  if (stars && (st.baseline === 0 || cpm >= st.baseline)) stars = 2;
  if (stars === 2 && st.baseline > 0 && cpm >= st.baseline * 1.08 && acc >= 0.97) stars = 3;
  const pb = acc >= 0.95 && cpm > st.pb;

  const run = {
    game: S.mode, cpm, acc, chars: S.correctChars, errors: S.wrong,
    secs: Math.round(secs * 10) / 10, stars,
  };
  if (S.mode === 'speed') { run.level = S.level; run.pb = pb; }
  if (S.name) run.name = S.name;
  await saveRun(run);

  // finishing a shrine level for the first time opens its มงคลชีวิต blessing
  const blessing = S.mode === 'speed' && S.level > st.maxDone
    ? BY_LEVEL.get(S.level) : null;

  if (pb || blessing) { sound.pb(); confetti(); } else { sound.level(); }

  const delta = st.pb ? Math.round((cpm - st.pb) * 10) / 10 : null;
  const starHtml = [1, 2, 3].map((n) =>
    `<span class="star ${n <= stars ? 'on' : ''}" style="animation-delay:${n * 0.25}s">★</span>`).join('');
  const nextLevel = S.mode === 'speed' ? S.level + 1 : null;
  const card = modal(`
    <h2>${S.title}</h2>
    <div class="modal-stars">${starHtml}</div>
    <div class="modal-cpm">${Math.round(cpm)} <small style="font-size:.9rem">ตัวอักษร/นาที</small></div>
    <div class="modal-sub">
      ความแม่นยำ ${Math.round(acc * 100)}%
      ${pb ? '<div class="modal-pb">🏆 สถิติใหม่!' + (delta > 0 ? ` เร็วขึ้น ${delta}` : '') + '</div>'
           : (delta !== null && delta < 0 ? `<div>ห่างสถิติ ${Math.abs(Math.round(delta))} ตัวอักษร/นาที</div>` : '')}
      ${stars === 0 ? '<div>แม่นยำ 90% ขึ้นไปจึงจะได้ดาว</div>' : ''}
    </div>
    ${blessing ? `
    <div class="blessing">
      <div class="blessing-head">☸ มงคลชีวิตข้อที่ ${thaiNum(blessing.n)} เปิดแล้ว</div>
      <div class="blessing-name">${blessing.th}</div>
      <div class="blessing-pali">${blessing.pali}</div>
      <div class="blessing-mean">${blessing.mean}</div>
    </div>` : ''}
    <div class="play-actions">
      <button class="btn ghost" id="m-retry">เล่นอีกครั้ง</button>
      ${nextLevel && nextLevel <= TOTAL_LEVELS
        ? '<button class="btn gold" id="m-next">ด่านต่อไป →</button>'
        : '<button class="btn" id="m-close">กลับ</button>'}
    </div>`);
  card.querySelector('#m-retry').onclick = () => {
    closeModal();
    S.mode === 'speed' ? startLevel(S.level) : begin({ ...S });
  };
  const next = card.querySelector('#m-next');
  if (next) next.onclick = () => { closeModal(); startLevel(nextLevel); };
  const close = card.querySelector('#m-close');
  if (close) close.onclick = () => { closeModal(); show(S.backView); };
}

export function initSpeed() {
  const box = $('#typebox');
  box.addEventListener('input', (e) => {
    if (!S || S.done) return;
    const v = box.value;
    if (!S.t0 && v.trim()) {
      S.t0 = performance.now(); // start the clock on the first keystroke
      box.placeholder = ''; // stop it reappearing between words
    }
    if (v.endsWith(' ')) {
      const typed = v.trim().normalize('NFC');
      box.value = '';
      if (typed) commitWord(typed);
      return;
    }
    const target = S.words[S.idx];
    if (e.data) { // a real inserted character (not backspace)
      S.keys++;
      const pos = v.length - 1;
      if (v.normalize('NFC')[pos] === target[pos]) sound.click();
      else { S.wrong++; sound.thud(); }
    }
    S.spans[S.idx].classList.toggle('bad', !target.startsWith(v.normalize('NFC')));
  });
  $('#play-quit').addEventListener('click', () => {
    const back = S ? S.backView : 'journey';
    S = null;
    show(back);
  });
}
