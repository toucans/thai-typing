// The speed game: 10fastfingers-style word stream. Type the highlighted word,
// hit space to commit. Also drives free-text mode (same engine, words in order).
//
// Levels are generated, not stored: a seeded PRNG samples the frequency-ordered
// word pool, with the sampling window widening as levels rise. Every level is
// deterministic, so replaying "ด่าน 217" always gives the same words.
import { sound } from './audio.js';
import { music } from './music.js';
import { loadRuns, saveRun, stats, starsFor } from './records.js';
import { $, show, modal, closeModal, confetti, setRegion, REGION_SIZE, TOTAL_LEVELS } from './ui.js';
import { levelWords } from './levels.js';
import { BY_LEVEL, thaiNum } from './data/mongkhon.js';

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

export function startText(name, title, words, breaks) {
  begin({ mode: 'text', name, words, breaks, title, backView: 'texts' });
}

function begin(cfg) {
  S = { ...cfg, idx: 0, keys: 0, wrong: 0, correctChars: 0, t0: null, done: false };
  $('#play-title').textContent = S.title;
  $('#play-progress').style.width = '0';
  const stream = $('#wordstream');
  // เรื่องอ่าน runs words together with no gaps, like natural Thai prose
  stream.classList.toggle('nospace', S.mode === 'text');
  stream.innerHTML = '';
  S.spans = S.words.map((w, i) => {
    const sp = document.createElement('span');
    sp.textContent = w;
    // in เรื่องอ่าน words butt together; a 'brk' span keeps the space the source had
    if (S.breaks && S.breaks[i]) sp.classList.add('brk');
    stream.appendChild(sp);
    return sp;
  });
  S.spans[0].classList.add('cur');
  // clearing and refilling the stream happens before any layout, so the browser
  // never clamps the previous level's scrollTop — reset it or line one starts
  // hidden above the two-line window
  stream.scrollTop = 0;
  show('play');
  if (S.mode === 'speed') music.playForLevel(S.level);
  else music.playForName(S.name || S.title);
  const box = $('#typebox');
  box.value = '';
  // reading mode flows word-to-word on its own; other modes commit with a space
  box.placeholder = S.mode === 'text'
    ? 'พิมพ์ตามเรื่อง เว้นวรรคเมื่อเจอช่องว่าง…'
    : 'พิมพ์คำ แล้วเคาะวรรคเพื่อส่ง…'; // shown until the first keystroke
  box.focus();
}

function scrollCurrentIntoView() {
  // span.offsetTop is already relative to the stream (its position:relative
  // offsetParent). Anchor on the first span so line one sits at scrollTop 0
  // and every later line scrolls up to the top of the two-line window.
  const stream = $('#wordstream');
  const sp = S.spans[S.idx];
  if (sp) stream.scrollTop = Math.max(0, sp.offsetTop - S.spans[0].offsetTop);
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
  const stars = starsFor(acc, cpm, st.baseline); // rules live in records.js
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
      ${stars === 0 ? '<div>แม่นยำ 80% ขึ้นไปจึงจะได้ดาว</div>'
        : stars === 1 ? '<div>แม่นยำ 88% + เร็วเท่าค่ากลางของคุณได้ ★★</div>'
        : stars === 2 ? '<div>แม่นยำ 93% + เร็วกว่าค่ากลาง 5% ได้ ★★★</div>' : ''}
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
    const nv = v.normalize('NFC');
    if (e.data) { // a real inserted character (not backspace)
      S.keys++;
      const pos = v.length - 1;
      if (nv[pos] === target[pos]) sound.click();
      else { S.wrong++; sound.thud(); }
    }
    S.spans[S.idx].classList.toggle('bad', !target.startsWith(nv));
    // เรื่องอ่าน: words run together, so a finished word advances on its own —
    // no space needed. A space is only for real sentence breaks (S.breaks[idx]).
    if (S.mode === 'text' && !(S.breaks && S.breaks[S.idx]) && nv === target) {
      box.value = '';
      commitWord(nv);
    }
  });
  $('#play-quit').addEventListener('click', () => {
    const back = S ? S.backView : 'journey';
    S = null;
    show(back);
  });
}
