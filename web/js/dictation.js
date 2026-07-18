// The dictation game: play one subtitle cue, type it, get green/red feedback
// the moment each word is complete — then the next cue plays. Two modes,
// chosen on the setup screen (persisted as tt.dictMode):
//  - ฟังแล้วพิมพ์ (listen): the cue text is hidden — retrieval from the ear
//  - ดูแล้วพิมพ์ (read): the cue text is shown and you copy-type it, like
//    เส้นทาง/เรื่องอ่าน, with the audio as accompaniment
//
// Learning principles applied (listen mode):
//  - retrieval first: the target text is never shown while you type
//  - feedback exactly at word boundary (Intl.Segmenter knows where words end)
//  - errorful learning: a wrong word must be retyped; after two misses the
//    correct spelling is shown as a ghost to copy (immediate corrective feedback)
//  - spaced retrieval: cues you missed come back for a review round at the end
import { sound } from './audio.js';
import { saveRun } from './records.js';
import { $, show, modal, closeModal, segmentThai } from './ui.js';

let D = null; // current session
let readMode = localStorage.getItem('tt.dictMode') === 'read';

// ---- srt parsing --------------------------------------------------------------
function parseTime(h, m, s, ms) {
  return (+h) * 3600 + (+m) * 60 + (+s) + (+ms) / 1000;
}

export function parseSRT(text) {
  const cues = [];
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n').filter(Boolean);
    const ti = lines.findIndex((l) => l.includes('-->'));
    if (ti === -1) continue;
    const m = lines[ti].match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
    if (!m) continue;
    const raw = lines.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!raw) continue;
    cues.push({
      start: parseTime(m[1], m[2], m[3], m[4]),
      end: parseTime(m[5], m[6], m[7], m[8]),
      text: raw,
    });
  }
  return cues;
}

// A cue's typing targets: segmented words with surrounding punctuation stripped
// (you type the words, not the commas). Tokens that end up empty are display-only.
function cueTokens(text) {
  return segmentThai(text).map((w) => {
    const core = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}ั-ฺ็-๎ๆ]+$/gu, '');
    return { display: w, target: core.normalize('NFC') };
  });
}

// ---- setup screen ---------------------------------------------------------------
export async function initDictation() {
  const list = $('#media-list');
  let pairs = [];
  try { pairs = (await (await fetch('api/media')).json()).pairs; } catch { /* offline */ }
  if (!pairs.length) {
    list.innerHTML = '<p class="hint">ยังไม่มีไฟล์ใน <code>media/</code></p>';
    return;
  }
  list.innerHTML = '';
  for (const pair of pairs) {
    const resume = +(localStorage.getItem(`tt.dict.${pair.name}`) || 0);
    const card = document.createElement('button');
    card.className = 'mediacard';
    card.innerHTML = `<b>${pair.name}</b>
      <small>${resume ? `เล่นต่อจากท่อนที่ ${resume + 1}` : 'เริ่มใหม่'}</small><br>
      <span class="seg-preview">ดูตัวอย่างการตัดคำ</span>
      ${resume ? ' · <span class="seg-preview seg-restart">เริ่มใหม่ตั้งแต่ต้น</span>' : ''}`;
    card.querySelector('.seg-preview').onclick = (e) => { e.stopPropagation(); previewSegmentation(pair); };
    const restart = card.querySelector('.seg-restart');
    if (restart) restart.onclick = (e) => { e.stopPropagation(); start(pair, 0); };
    card.onclick = () => start(pair, resume);
    list.appendChild(card);
  }
}

async function previewSegmentation(pair) {
  const cues = parseSRT(await (await fetch(pair.subs)).text());
  const rows = cues.slice(0, 12).map((c) =>
    `<div style="text-align:start;margin:.3em 0">${cueTokens(c.text).map((t) => t.display).join(' · ')}</div>`).join('');
  const card = modal(`
    <h2>การตัดคำ · ${pair.name}</h2>
    <p class="hint" style="text-align:start">ถ้าจุดไหนตัดผิด แก้ในไฟล์ .srt โดยคั่นคำด้วย
      <code>|</code> ในท่อนนั้น (ท่อนที่มี | จะไม่ใช้ตัวตัดอัตโนมัติ)</p>
    ${rows}
    <div class="play-actions"><button class="btn" id="m-close">ปิด</button></div>`);
  card.querySelector('#m-close').onclick = closeModal;
}

// ---- session ---------------------------------------------------------------------
async function start(pair, resumeCue) {
  const cues = parseSRT(await (await fetch(pair.subs)).text());
  if (!cues.length) return;
  const media = $('#dict-media');
  media.src = pair.media;
  media.classList.toggle('audio-only', /\.(mp3|m4a|ogg|opus|wav)$/i.test(pair.media));
  D = {
    pair, cues, media, read: readMode,
    queue: cues.map((_, i) => i).slice(Math.min(resumeCue, cues.length - 1)),
    review: [], inReview: false,
    qpos: 0, tokens: [], wordIdx: 0, attempts: 0, cuesDone: 0,
    wordsTotal: 0, wordsWrong: 0, cueWrong: false, t0: performance.now(),
  };
  $('#dict-setup').hidden = true;
  $('#dict-session').hidden = false;
  // shown until the first keystroke
  $('#dict-typebox').placeholder = readMode ? 'พิมพ์ตามคำที่เห็น…' : 'ฟังแล้วพิมพ์…';
  $('#dict-keys').innerHTML = `<span class="kbd">Tab</span> ฟังซ้ำ · <span class="kbd">Shift+Tab</span> ช้าลง`
    + (readMode ? '' : ' · <span class="kbd">Esc</span> เฉลยคำ'); // nothing to reveal in read mode
  show('dictation');
  loadCue();
}

function currentCueIndex() { return D.queue[D.qpos]; }

function loadCue() {
  const ci = currentCueIndex();
  D.tokens = cueTokens(D.cues[ci].text);
  D.wordIdx = 0;
  D.attempts = 0;
  D.cueWrong = false;
  skipEmptyTargets();
  $('#dict-cue-no').textContent =
    `${D.inReview ? 'รอบทบทวน · ' : ''}ท่อนที่ ${ci + 1} / ${D.cues.length}`;
  $('#dict-ghost').textContent = '';
  renderWords();
  const box = $('#dict-typebox');
  box.value = '';
  box.focus();
  if (!D.inReview) localStorage.setItem(`tt.dict.${D.pair.name}`, String(ci));
  playCue(1);
}

function playCue(rate) {
  const cue = D.cues[currentCueIndex()];
  const m = D.media;
  if (m.readyState < 1) { // metadata not loaded yet: seeking would be ignored
    m.addEventListener('loadedmetadata', () => { if (D) playCue(rate); }, { once: true });
    return;
  }
  m.playbackRate = rate;
  m.currentTime = cue.start;
  m.play();
  m.ontimeupdate = () => { if (m.currentTime >= cue.end) { m.pause(); m.ontimeupdate = null; } };
}

function renderWords() {
  const div = $('#dict-words');
  div.innerHTML = '';
  D.tokens.forEach((tok, i) => {
    const sp = document.createElement('span');
    if (i < D.wordIdx) {
      sp.textContent = tok.display;
      sp.className = tok.firstTryWrong ? 'err' : 'ok';
    } else if (i === D.wordIdx) {
      sp.textContent = D.read ? tok.display : '▁▁';
      sp.className = D.read ? 'now' : 'slot';
    } else {
      // read mode shows the whole cue to copy; listen mode hides what's ahead —
      // retrieval, not copying
      sp.textContent = D.read ? tok.display : '';
      if (D.read) sp.className = 'next';
    }
    div.appendChild(sp);
  });
}

function skipEmptyTargets() {
  while (D.wordIdx < D.tokens.length && !D.tokens[D.wordIdx].target) D.wordIdx++;
}

function advanceWord() {
  D.wordIdx++;
  D.attempts = 0;
  $('#dict-ghost').textContent = '';
  skipEmptyTargets();
  renderWords();
  if (D.wordIdx >= D.tokens.length) cueDone();
}

function cueDone() {
  const ci = currentCueIndex();
  D.cuesDone++;
  if (D.cueWrong && !D.inReview) D.review.push(ci);
  sound.word();
  setTimeout(() => {
    D.qpos++;
    if (D.qpos >= D.queue.length) {
      if (!D.inReview && D.review.length) {
        D.inReview = true;
        D.queue = D.review;
        D.qpos = 0;
        modalNote('🍂 รอบทบทวน', `มี ${D.review.length} ท่อนที่พลาด มาเก็บให้ครบ`);
        loadCue();
      } else {
        finishSession();
      }
      return;
    }
    loadCue();
  }, 800);
}

function modalNote(title, text) {
  const card = modal(`<h2>${title}</h2><div class="modal-sub">${text}</div>
    <div class="play-actions"><button class="btn gold" id="m-go">ลุยต่อ</button></div>`);
  card.querySelector('#m-go').onclick = () => { closeModal(); $('#dict-typebox').focus(); };
}

async function finishSession() {
  const acc = D.wordsTotal ? 1 - D.wordsWrong / D.wordsTotal : 1;
  const secs = (performance.now() - D.t0) / 1000;
  await saveRun({
    game: 'dictation', name: D.pair.name, cues: D.cuesDone,
    words: D.wordsTotal, acc: Math.round(acc * 1000) / 1000,
    secs: Math.round(secs),
    chars: D.tokensTyped || 0,
    ...(D.read ? { read: true } : {}), // ดูแล้วพิมพ์ runs are marked in the log
  });
  sound.level();
  localStorage.removeItem(`tt.dict.${D.pair.name}`);
  const card = modal(`
    <h2>จบรอบ · ${D.pair.name}</h2>
    <div class="modal-cpm">${Math.round(acc * 100)}%</div>
    <div class="modal-sub">สะกดถูกตั้งแต่ครั้งแรก ${D.wordsTotal - D.wordsWrong} จาก ${D.wordsTotal} คำ</div>
    <div class="play-actions"><button class="btn" id="m-close">กลับ</button></div>`);
  card.querySelector('#m-close').onclick = () => { closeModal(); exitSession(); };
}

function exitSession() {
  D = null;
  const m = $('#dict-media');
  m.pause();
  m.removeAttribute('src');
  $('#dict-session').hidden = true;
  $('#dict-setup').hidden = false;
  initDictation();
}

// ---- typing ------------------------------------------------------------------------
function checkWord() {
  const box = $('#dict-typebox');
  const typed = box.value.normalize('NFC');
  const tok = D.tokens[D.wordIdx];
  if (!tok || typed.length < tok.target.length) return;
  const attempt = typed.slice(0, tok.target.length);
  D.attempts++;
  if (attempt === tok.target) {
    if (D.attempts === 1) D.wordsTotal++; // each word is judged once, on the first try
    D.tokensTyped = (D.tokensTyped || 0) + tok.target.length;
    sound.word();
    box.value = '';
    advanceWord();
  } else {
    if (D.attempts === 1) {
      D.wordsTotal++;
      D.wordsWrong++;
      D.cueWrong = true;
      tok.firstTryWrong = true;
    }
    sound.error();
    box.value = '';
    box.classList.remove('flash-red');
    void box.offsetWidth; // restart the animation
    box.classList.add('flash-red');
    if (D.attempts >= 2 && !D.read) $('#dict-ghost').textContent = tok.target; // corrective ghost
  }
}

export function initDictationInput() {
  // mode chips on the setup screen; the choice applies to the next session
  const modes = $('#dict-modes');
  const paintModes = () => {
    for (const b of modes.querySelectorAll('.chip')) {
      b.classList.toggle('sel', (b.dataset.mode === 'read') === readMode);
    }
  };
  paintModes();
  modes.addEventListener('click', (e) => {
    const b = e.target.closest('.chip');
    if (!b) return;
    readMode = b.dataset.mode === 'read';
    localStorage.setItem('tt.dictMode', readMode ? 'read' : 'listen');
    paintModes();
  });

  const box = $('#dict-typebox');
  box.addEventListener('input', (e) => {
    if (!D) return;
    box.placeholder = ''; // stop it reappearing between words
    if (e.data) sound.click();
    checkWord();
  });
  box.addEventListener('keydown', (e) => {
    if (!D) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      playCue(e.shiftKey ? 0.7 : 1);
    } else if (e.key === 'Escape' && !D.read) { // read mode: nothing hidden to reveal
      e.preventDefault();
      const tok = D.tokens[D.wordIdx];
      if (tok) {
        if (!tok.firstTryWrong) { D.wordsTotal++; D.wordsWrong++; D.cueWrong = true; tok.firstTryWrong = true; }
        D.attempts = Math.max(D.attempts, 2);
        $('#dict-ghost').textContent = tok.target;
      }
    }
  });
  $('#dict-replay').addEventListener('click', () => { if (D) { playCue(1); box.focus(); } });
  $('#dict-finish').addEventListener('click', () => { if (D) finishSession(); });
}
