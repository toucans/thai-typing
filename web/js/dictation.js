// The dictation game: play one subtitle cue, type it word by word from the ear.
// Two modes, chosen on the setup screen (persisted as tt.dictMode):
//  - ฟังแล้วพิมพ์ (listen): the cue text is hidden — this is the spelling trainer
//  - ดูแล้วพิมพ์ (read): the cue text is shown and you copy-type it, like
//    เส้นทาง/เรื่องอ่าน, with the audio as accompaniment
//
// Why listen mode works the way it does
// -------------------------------------
// Thai is asymmetric: script→sound is nearly deterministic, sound→script is
// many-to-one. Reading a lot therefore buys recognition-quality word forms —
// precise enough to tell a word from its neighbours on the page, too vague to
// write it down. Closing that gap needs sound→script practice with three
// properties, and the loop below is built out of exactly those:
//
//  1. always guess first. Revealing a word you never attempted teaches much less
//     than attempting it, failing, and *then* seeing the answer, so Esc no longer
//     skips to the answer — it commits whatever you have and scores it.
//  2. never copy the answer. Transcribing a visible model is a visual-motor
//     task that barely touches memory; the old flow gave that treatment to
//     precisely the words that needed the most. The answer is now shown
//     (study), then hidden (cover), and you retype it from memory (recall).
//  3. come back to it. A recalled word is rescheduled at expanding gaps, and
//     anything still unmastered when the session ends carries to the next one
//     through the run log.
//
// Every miss is also classified (spell.js) so สถิติ can show which of Thai's
// ambiguity classes is actually costing you, instead of a list of words.
import { sound } from './audio.js';
import { saveRun, loadRuns } from './records.js';
import { $, show, modal, closeModal, segmentThai } from './ui.js';
import { classify, diffHTML } from './spell.js';

let D = null; // current session
let readMode = localStorage.getItem('tt.dictMode') === 'read';

// Gaps (in words typed) before a missed word comes back, and how many clean
// recalls retire it. Expanding rather than fixed: each success should be a
// little harder to produce than the last.
const DRILL_GAPS = [5, 15, 40];
const DRILL_GIVEUP = 4;   // failures before it stops interrupting this session
const DUE_CARRIED_MAX = 12; // old words folded into one session's opening round
const MISS_LOG_MAX = 200;   // cap on what one run appends to the jsonl

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

// ---- carried-over words ------------------------------------------------------------
// The run log is the only store: each dictation run records the words it missed
// and the words it drilled to mastery. Replaying those events in order gives each
// word a current state, and anything whose latest event is a miss is still owed.
async function carriedDue(mediaName) {
  let runs = [];
  try { runs = await loadRuns(); } catch { return []; }
  const state = new Map(); // word -> {due:boolean, cue:number}
  const mine = runs
    .filter((r) => r.game === 'dictation' && r.name === mediaName)
    .sort((a, b) => (a.t || '').localeCompare(b.t || ''));
  for (const r of mine) {
    for (const m of r.misses || []) state.set(m.w, { due: true, cue: m.cue ?? 0 });
    for (const w of r.mastered || []) if (state.has(w)) state.get(w).due = false;
  }
  return [...state.entries()]
    .filter(([, v]) => v.due)
    .slice(0, DUE_CARRIED_MAX)
    .map(([w, v]) => ({ w, cue: v.cue, due: 0, reps: 0, fails: 0, carried: true }));
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
    qpos: 0, tokens: [], wordIdx: 0,
    phase: 'guess', attempts: 0, nudged: false,
    drill: [], drillNow: null, wordsSeen: 0,
    misses: [], mastered: [], flushRounds: 0,
    cuesDone: 0, wordsTotal: 0, wordsWrong: 0, tokensTyped: 0,
    t0: performance.now(),
  };
  // words still owed from earlier sessions on this media open the round
  if (!readMode) {
    const due = await carriedDue(pair.name).catch(() => []);
    // only keep the ones whose cue still holds the word (the .srt may have changed)
    D.drill = due.filter((d) => cues[d.cue] && cues[d.cue].text.includes(d.w));
  }
  $('#dict-setup').hidden = true;
  $('#dict-session').hidden = false;
  $('#dict-typebox').placeholder = readMode ? 'พิมพ์ตามคำที่เห็น…' : 'ฟังแล้วพิมพ์…';
  $('#dict-keys').innerHTML = `<span class="kbd">Tab</span> ฟังซ้ำ · <span class="kbd">Shift+Tab</span> ช้าลง`
    + (readMode ? '' : ' · <span class="kbd">Enter</span> ส่งคำตอบ · <span class="kbd">Esc</span> ยอมแพ้คำนี้');
  show('dictation');
  if (D.drill.length) {
    modalNote('🍂 ทบทวนคำเก่า', `มี ${D.drill.length} คำจากรอบก่อนที่ยังสะกดไม่ได้ — เก็บให้จบก่อน`);
  }
  loadNext();
}

function currentCueIndex() {
  return D.drillNow ? D.drillNow.cue : D.queue[D.qpos];
}

// The one place that decides what comes next: a due drill outranks a fresh cue,
// and when the cues run out anything still unmastered gets one last pass.
function loadNext() {
  const due = D.drill.find((d) => D.wordsSeen >= d.due);
  if (due) return startDrill(due);
  if (D.qpos >= D.queue.length) {
    // The cues are done but words are still owed. Re-arm everything left, once
    // per remaining repetition — going round again (rather than repeating one
    // word back to back) keeps some space between a word's repetitions, which
    // is the whole point of the schedule.
    if (D.drill.length && D.flushRounds < DRILL_GAPS.length) {
      if (!D.flushRounds) modalNote('🍂 รอบเก็บตก', `เหลืออีก ${D.drill.length} คำที่ยังไม่แน่น`);
      D.flushRounds++;
      for (const d of D.drill) d.due = 0;
      return loadNext();
    }
    return finishSession();
  }
  loadCue();
}

function resetWordState() {
  D.phase = 'guess';
  D.attempts = 0;
  D.nudged = false;
  const box = $('#dict-typebox');
  box.value = '';
  box.readOnly = false;
  box.focus();
  $('#dict-diff').hidden = true;
  $('#dict-diff').innerHTML = '';
  $('#dict-ghost').textContent = '';
  $('#dict-phase').textContent = '';
}

function loadCue() {
  D.drillNow = null;
  const ci = currentCueIndex();
  D.tokens = cueTokens(D.cues[ci].text);
  D.wordIdx = 0;
  skipEmptyTargets();
  $('#dict-cue-no').textContent = `ท่อนที่ ${ci + 1} / ${D.cues.length}`;
  resetWordState();
  renderWords();
  if (!D.flushRounds) localStorage.setItem(`tt.dict.${D.pair.name}`, String(ci));
  playCue(1);
}

// A drill replays the cue the word came from — the word alone, out of context,
// would be a different (and easier) task than the one being trained.
function startDrill(item) {
  D.drillNow = item;
  const ci = item.cue;
  D.tokens = cueTokens(D.cues[ci].text);
  D.wordIdx = D.tokens.findIndex((t) => t.target === item.w);
  if (D.wordIdx === -1) { // cue no longer holds it — drop it rather than stall
    dropDrill(item);
    D.drillNow = null;
    return loadNext();
  }
  $('#dict-cue-no').textContent = `ทบทวน${item.carried ? 'คำเก่า' : ''} · ${item.reps + 1}/${DRILL_GAPS.length}`;
  resetWordState();
  renderWords();
  playCue(1);
}

function dropDrill(item) {
  const i = D.drill.indexOf(item);
  if (i >= 0) D.drill.splice(i, 1);
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
    if (D.drillNow) {
      // the drill blanks its one word and shows the rest as context
      sp.textContent = i === D.wordIdx ? '▁▁' : tok.display;
      sp.className = i === D.wordIdx ? 'slot' : 'next';
    } else if (i < D.wordIdx) {
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

function currentTarget() {
  const tok = D.tokens[D.wordIdx];
  return tok ? tok.target : '';
}

// ---- the loop: guess → study → recall ------------------------------------------------
// Scoring happens once, on the first guess. Everything after that is practice,
// not measurement — otherwise the accuracy number would reward giving up early.
function submitGuess(typed) {
  const target = currentTarget();
  if (!target) return;
  const guess = typed.normalize('NFC');
  D.attempts++;
  const first = D.attempts === 1;

  if (guess === target) {
    if (first && !D.drillNow) D.wordsTotal++;
    D.tokensTyped += target.length;
    sound.word();
    return passWord(first);
  }

  if (first) {
    if (D.drillNow) {
      D.drillNow.fails++;
      D.drillNow.reps = 0; // a miss resets the schedule
    } else {
      D.wordsTotal++;
      D.wordsWrong++;
      D.tokens[D.wordIdx].firstTryWrong = true;
      recordMiss(guess, target);
    }
  }
  sound.error();
  flashBox();
  enterStudy(guess, target);
}

function recordMiss(guess, target) {
  if (D.misses.length < MISS_LOG_MAX) {
    D.misses.push({
      w: target,
      g: guess,
      tags: classify(guess, target).categories,
      cue: currentCueIndex(),
    });
  }
  // schedule it: first return after the shortest gap
  if (!D.drill.some((d) => d.w === target)) {
    D.drill.push({ w: target, cue: currentCueIndex(), due: D.wordsSeen + DRILL_GAPS[0], reps: 0, fails: 0 });
  }
}

// Study: the answer is on screen and the box is inert. It sits above the typing
// bar, deliberately not in it — an answer in the same line you type into makes
// the whole thing a transcription exercise.
function enterStudy(guess, target) {
  D.phase = 'study';
  const box = $('#dict-typebox');
  box.readOnly = true;
  box.value = '';
  if (guess) {
    $('#dict-diff').innerHTML = diffHTML(guess, target);
    $('#dict-diff').hidden = false;
  }
  $('#dict-ghost').textContent = target;
  $('#dict-phase').textContent = 'จำรูปคำไว้ — กด Enter แล้วพิมพ์จากความจำ';
  box.focus();
}

// Recall: the cover step. The answer disappears and has to come back out of
// memory — this is the part that actually moves spelling.
function enterRecall() {
  D.phase = 'recall';
  const box = $('#dict-typebox');
  box.readOnly = false;
  box.value = '';
  $('#dict-diff').hidden = true;
  $('#dict-ghost').textContent = '';
  $('#dict-phase').textContent = 'พิมพ์จากความจำ (Esc = ดูอีกครั้ง)';
  box.focus();
}

function checkRecall(typed) {
  const target = currentTarget();
  if (typed.normalize('NFC') !== target) {
    sound.error();
    flashBox();
    enterStudy('', target); // no diff on a recall slip: just look again
    return;
  }
  D.tokensTyped += target.length;
  sound.word();
  passWord(false);
}

// A word is done for now. `clean` means it was right on the first guess, which
// is what advances a drill item toward being retired.
function passWord(clean) {
  D.wordsSeen++;
  const item = D.drillNow;
  if (item) {
    if (clean) {
      item.reps++;
      if (item.reps >= DRILL_GAPS.length) {
        D.mastered.push(item.w);
        dropDrill(item);
      } else {
        item.due = D.wordsSeen + DRILL_GAPS[item.reps];
      }
    } else if (item.fails >= DRILL_GIVEUP) {
      dropDrill(item); // stop interrupting; it stays owed for next session
    } else {
      item.due = D.wordsSeen + DRILL_GAPS[0];
    }
    D.drillNow = null;
    setTimeout(() => { if (D) loadNext(); }, 450);
    return;
  }
  advanceWord();
}

function advanceWord() {
  D.wordIdx++;
  skipEmptyTargets();
  resetWordState();
  renderWords();
  if (D.wordIdx >= D.tokens.length) cueDone();
}

function cueDone() {
  D.cuesDone++;
  sound.word();
  setTimeout(() => {
    if (!D) return;
    if (!D.drillNow) D.qpos++;
    loadNext();
  }, 700);
}

function flashBox() {
  const box = $('#dict-typebox');
  box.value = '';
  box.classList.remove('flash-red');
  void box.offsetWidth; // restart the animation
  box.classList.add('flash-red');
}

function modalNote(title, text) {
  const card = modal(`<h2>${title}</h2><div class="modal-sub">${text}</div>
    <div class="play-actions"><button class="btn gold" id="m-go">ลุยต่อ</button></div>`);
  card.querySelector('#m-go').onclick = () => { closeModal(); $('#dict-typebox').focus(); };
}

async function finishSession() {
  const acc = D.wordsTotal ? 1 - D.wordsWrong / D.wordsTotal : 1;
  const secs = (performance.now() - D.t0) / 1000;
  const mastered = [...new Set(D.mastered)];
  await saveRun({
    game: 'dictation', name: D.pair.name, cues: D.cuesDone,
    words: D.wordsTotal, acc: Math.round(acc * 1000) / 1000,
    secs: Math.round(secs),
    chars: D.tokensTyped || 0,
    ...(D.read ? { read: true } : { misses: D.misses, mastered }),
  });
  sound.level();
  localStorage.removeItem(`tt.dict.${D.pair.name}`);
  const drilled = mastered.length
    ? `<div class="modal-sub">ทบทวนจนสะกดได้เอง ${mastered.length} คำ</div>` : '';
  const card = modal(`
    <h2>จบรอบ · ${D.pair.name}</h2>
    <div class="modal-cpm">${Math.round(acc * 100)}%</div>
    <div class="modal-sub">สะกดถูกตั้งแต่ครั้งแรก ${D.wordsTotal - D.wordsWrong} จาก ${D.wordsTotal} คำ</div>
    ${drilled}
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

// ---- read mode ------------------------------------------------------------------------
// ดูแล้วพิมพ์ is the copy-typing mode on purpose (it trains the keyboard, not
// spelling), so it keeps the old plain behaviour: wrong word, flash, retype.
function readModeInput(typed) {
  const target = currentTarget();
  if (!target || typed.length < target.length) return;
  const attempt = typed.slice(0, target.length).normalize('NFC');
  D.attempts++;
  if (attempt === target) {
    if (D.attempts === 1) D.wordsTotal++;
    D.tokensTyped += target.length;
    sound.word();
    advanceWord();
    return;
  }
  if (D.attempts === 1) {
    D.wordsTotal++;
    D.wordsWrong++;
    D.tokens[D.wordIdx].firstTryWrong = true;
  }
  sound.error();
  flashBox();
}

// ---- input --------------------------------------------------------------------------
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
    if (D.read) return readModeInput(box.value);
    // Reaching the answer's length auto-submits, which keeps the rhythm of the
    // old game; Enter exists for guesses you can't fill out that far.
    const target = currentTarget();
    if (!target || box.value.length < target.length) return;
    if (D.phase === 'guess') submitGuess(box.value.slice(0, target.length));
    else if (D.phase === 'recall') checkRecall(box.value.slice(0, target.length));
  });

  box.addEventListener('keydown', (e) => {
    if (!D) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      playCue(e.shiftKey ? 0.7 : 1);
      return;
    }
    if (D.read) return;

    if (e.key === 'Enter') {
      e.preventDefault();
      if (D.phase === 'study') enterRecall();
      else if (D.phase === 'recall') checkRecall(box.value);
      else if (box.value) submitGuess(box.value);
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      if (D.phase === 'study') return;          // the answer is already up
      if (D.phase === 'recall') {               // forgot it again — look once more
        enterStudy('', currentTarget());
        return;
      }
      // Esc used to hand over the answer for free. Now it commits what you have:
      // an attempt you got wrong is worth more than an answer you never tried
      // for. An empty box gets one nudge before it counts as a blank.
      if (!box.value && !D.nudged) {
        D.nudged = true;
        $('#dict-phase').textContent = 'เดาก่อน — พิมพ์เท่าที่คิดว่าใช่ แล้วกด Esc อีกครั้ง';
        return;
      }
      submitGuess(box.value);
    }
  });

  $('#dict-replay').addEventListener('click', () => { if (D) { playCue(1); box.focus(); } });
  $('#dict-finish').addEventListener('click', () => {
    if (!D) return;
    // easy to fat-finger next to the replay button — ask first
    const card = modal(`
      <h2>จบรอบนี้เลยไหม?</h2>
      <div class="modal-sub">จะบันทึกผลเท่าที่พิมพ์ไปแล้ว</div>
      <div class="play-actions">
        <button class="btn ghost" id="m-cancel">พิมพ์ต่อ</button>
        <button class="btn" id="m-yes">จบรอบ</button>
      </div>`);
    card.querySelector('#m-cancel').onclick = () => { closeModal(); $('#dict-typebox').focus(); };
    card.querySelector('#m-yes').onclick = () => { closeModal(); finishSession(); };
  });
}
