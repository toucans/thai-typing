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
//  4. but not on every word. Ctrl+Enter marks a word ไม่ต้องจำ — out of the
//     schedule, the carry-over list and the score, and from then on stepped
//     over exactly like punctuation: shown as context, never typed.
//     Transliterated names are why: their spelling is arbitrary and generalises
//     to nothing, so neither recalling nor copying one buys anything back.
//  5. and not for a slipped finger. `guess === target` cannot tell "I can't
//     spell this" from "my hand moved 2mm", and treating the two alike is
//     expensive: one typo otherwise buys a study screen, a cover-and-recall,
//     three spaced drills and an accuracy hit. Shift+Enter (or พิมพ์ผิด on the
//     study screen) says it was the fingers: the word scores as spelled right,
//     leaves the schedule, and — unlike ไม่ต้องจำ — is asked again as normal,
//     because you do want to keep meeting it.
import { sound } from './audio.ts';
import { currentUser, saveRun, loadRuns } from './records.ts';
import { $, show, modal, closeModal, hasThai, inserted, on, segmentThai } from './ui.ts';
import { diffHTML } from './spell.ts';
import type { DictationMiss, DictationRun, MediaPair, NewRun } from './types.ts';

// One cue of the subtitle file. `stop` is when playback actually stops, which is
// past `end` — see playWindows() for why the timestamp is not the boundary.
interface Cue {
  start: number;
  end: number;
  stop: number;
  text: string;
}

// One token of a cue. `target` is what you type — empty for punctuation-only
// tokens, which are shown as context and stepped over.
interface Token {
  display: string;
  target: string;
  firstTryWrong?: boolean;
}

// A word in the retrieval schedule: when it comes back (due, in words seen),
// how many clean recalls it has strung together (reps), and how many times it
// has been missed (fails). `carried` marks one owed by an earlier session.
interface DrillItem {
  w: string;
  cue: number;
  due: number;
  reps: number;
  fails: number;
  carried?: boolean;
  preMissReps?: number; // reps before the current miss, so พิมพ์ผิด can restore them
}

// The session. `phase` is the guess → study → recall state machine; `drillNow`
// is the drill interrupting the cue queue, if any.
interface Session {
  pair: MediaPair;
  cues: Cue[];
  media: HTMLVideoElement;
  read: boolean;
  queue: number[];
  qpos: number;
  cueAt: number;   // the last real cue loaded — what a resume comes back to
  tokens: Token[];
  wordIdx: number;
  phase: 'guess' | 'study' | 'recall';
  attempts: number;
  nudged: boolean;
  drill: DrillItem[];
  drillNow: DrillItem | null;
  wordsSeen: number;
  misses: DictationMiss[];
  mastered: string[];
  ignored: string[];
  ignoreSet: Set<string>;
  flushRounds: number;
  cuesDone: number;
  wordsTotal: number;
  wordsWrong: number;
  tokensTyped: number;
  t0: number;
}

let D: Session | null = null; // current session
let readMode = localStorage.getItem('tt.dictMode') === 'read';

// Gaps (in words typed) before a missed word comes back, and how many clean
// recalls retire it. Expanding rather than fixed: each success should be a
// little harder to produce than the last.
const DRILL_GAPS = [5, 15, 40];
const DRILL_GIVEUP = 4;   // failures before it stops interrupting this session
const DUE_CARRIED_MAX = 12; // old words folded into one session's opening round
const MISS_LOG_MAX = 200;   // cap on what one run appends to the jsonl

// ---- srt parsing --------------------------------------------------------------
function parseTime(h: string, m: string, s: string, ms: string) {
  return (+h) * 3600 + (+m) * 60 + (+s) + (+ms) / 1000;
}

export function parseSRT(text: string): Cue[] {
  const cues: Cue[] = [];
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n').filter(Boolean);
    const ti = lines.findIndex((l) => l.includes('-->'));
    const stamp = ti === -1 ? null : lines[ti];
    if (!stamp) continue;
    const m = stamp.match(/(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)/);
    if (!m || !m[1] || !m[2] || !m[3] || !m[4] || !m[5] || !m[6] || !m[7] || !m[8]) continue;
    const raw = lines.slice(ti + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    if (!raw) continue;
    const start = parseTime(m[1], m[2], m[3], m[4]);
    const end = parseTime(m[5], m[6], m[7], m[8]);
    cues.push({ start, end, stop: end, text: raw });
  }
  return playWindows(cues);
}

// ---- how long a cue is played -------------------------------------------------
// Subtitle timestamps are *display* windows, not speech boundaries. A cue is put
// up a little before the line is spoken and taken down when the reader has had
// time enough, and where one sentence is split over two cues the cut is placed
// for readability — not on the pause between the words. So the last word of a
// cue is often still in the air when its timestamp runs out, and playing exactly
// [start, end] cuts words off the very thing you are asked to type. Measured on
// the episode in media/: 43% of its 387 cues carry more text than their window
// has room for at the file's own speaking rate, by a median of 0.85s.
//
// Nothing here tries to fix the .srt — a file that matches the speech perfectly
// does not exist. The player simply stops being literal about `end`:
//
//   - every cue gets a floor of grace (CUE_TAIL) past its timestamp
//   - a cue whose text needs more time than its window gives — its characters
//     against the median rate of this very file, so a slow documentary and a
//     fast dub each calibrate themselves — gets that shortfall instead, capped
//   - the tail may run into the next cue only when that cue butts onto this one
//     (a third of them do here). Those are one sentence split for display, so
//     the words that spill over are this cue's own. Where there is a real gap
//     the speech ended inside it, and the tail stops a hair in — enough for a
//     trailing syllable, not enough to give away the next line's answer.
const CUE_LEAD = 0.15;    // run-up, so the first syllable keeps its onset
const CUE_TAIL = 0.6;     // grace every cue gets past its timestamp
const CUE_TAIL_MAX = 1.6; // ceiling on a short window's extra time
const CUE_JOIN = 0.15;    // gap under which the next cue is a continuation, not a new line
const CUE_PEEK = 0.2;     // how far a tail may cross into a cue that does *not* continue this one

// Characters that take time to say: letters and digits. Spaces, punctuation and
// the '|' word markers are silent, and Thai's vowel signs and tone marks are
// combining characters that stack onto the letter before them rather than adding
// a sound of their own — all of which the one non-letter test covers.
function spokenLength(text: string): number {
  return text.replace(/[^\p{L}\p{N}]/gu, '').length;
}

function playWindows(cues: Cue[]): Cue[] {
  const rates = cues.filter((c) => c.end > c.start)
    .map((c) => spokenLength(c.text) / (c.end - c.start)).sort((a, b) => a - b);
  const median = rates.length ? rates[rates.length >> 1] ?? 0 : 0;
  return cues.map((cue, i) => {
    const short = median > 0 ? spokenLength(cue.text) / median - (cue.end - cue.start) : 0;
    const tail = Math.min(Math.max(CUE_TAIL, short), CUE_TAIL_MAX);
    const next = cues[i + 1];
    const limit = next && next.start - cue.end > CUE_JOIN ? next.start + CUE_PEEK : Infinity;
    return { ...cue, stop: Math.min(cue.end + tail, limit) };
  });
}

// A cue's typing targets: segmented words with surrounding punctuation stripped
// (you type the words, not the commas). Tokens that end up empty are display-only.
//
// Punctuation strips itself away to nothing, but a number, a year or a Latin
// acronym survives the strip — and spelling "2568" or "MOU" from the ear is not
// the exercise: it teaches no Thai, and left as a target it would also be
// scheduled into the drill queue and carried over to the next session. So
// anything with no Thai in it is context too, stepped over exactly like a comma.
function cueTokens(text: string): Token[] {
  return segmentThai(text).map((w) => {
    const core = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}ั-ฺ็-๎ๆ]+$/gu, '');
    return { display: w, target: hasThai(core) ? core.normalize('NFC') : '' };
  });
}

// ---- where you left off ---------------------------------------------------
// An episode outlives a sitting, and a tab dies without warning, so the cue you
// are on is posted to the server on a timer while you type — api/resume keeps a
// small mutable cursor file per user, apart from the append-only run log (see
// main.go). localStorage gets every cue as well: it costs nothing, it is exact,
// and it still works with the server unreachable. Resume takes the furthest
// point either store knows, so neither can lose ground.
const RESUME_POST_MS = 20_000;

let resumePending: { media: string; cue: number } | null = null;
let resumeTimer = 0;
let resumeSentAt = 0;

// Send whatever is queued now. Called on the timer, when a round ends, and on
// pagehide — where `keepalive` is what lets the request outlive the page.
async function flushResume(keepalive = false): Promise<void> {
  const p = resumePending;
  if (!p) return;
  resumePending = null;
  resumeSentAt = Date.now();
  try {
    const res = await fetch('api/resume', {
      method: 'POST',
      keepalive,
      body: JSON.stringify({ user: currentUser(), media: p.media, cue: p.cue }),
    });
    if (!res.ok) throw new Error();
  } catch {
    // offline or refused: keep it for the next tick unless a newer cue arrived
    if (!resumePending) resumePending = p;
  }
}

function queueResume(media: string, cue: number): void {
  resumePending = { media, cue };
  if (resumeTimer) return;
  const wait = Math.max(0, RESUME_POST_MS - (Date.now() - resumeSentAt));
  resumeTimer = setTimeout(() => { resumeTimer = 0; void flushResume(); }, wait);
}

// The cue you are on, remembered in both stores.
function markCue(media: string, cue: number): void {
  localStorage.setItem(`tt.dict.${media}`, String(cue));
  queueResume(media, cue);
}

// Finished the file: there is nothing to come back to.
function clearResume(media: string): void {
  localStorage.removeItem(`tt.dict.${media}`);
  resumePending = { media, cue: 0 };
  void flushResume();
}

async function resumeMarks(): Promise<Map<string, number>> {
  const marks = new Map<string, number>();
  try {
    const res = await fetch(`api/resume?user=${encodeURIComponent(currentUser() ?? '')}`);
    if (!res.ok) return marks;
    for (const [media, cue] of Object.entries((await res.json()).resume ?? {})) {
      if (typeof cue === 'number') marks.set(media, cue);
    }
  } catch { /* offline: this device's own localStorage still knows its place */ }
  return marks;
}

// ---- setup screen ---------------------------------------------------------------
export async function initDictation(): Promise<void> {
  const list = $('#media-list');
  let pairs: MediaPair[] = [];
  try { pairs = (await (await fetch('api/media')).json()).pairs; } catch { /* offline */ }
  const marks = await resumeMarks();
  if (!pairs.length) {
    list.innerHTML = '<p class="hint">ยังไม่มีไฟล์ใน <code>media/</code></p>';
    return;
  }
  list.innerHTML = '';
  for (const pair of pairs) {
    const resume = Math.max(
      +(localStorage.getItem(`tt.dict.${pair.name}`) || 0),
      marks.get(pair.name) ?? 0,
    );
    const card = document.createElement('button');
    card.className = 'mediacard';
    card.innerHTML = `<b>${pair.name}</b>
      <small>${resume ? `เล่นต่อจากท่อนที่ ${resume + 1}` : 'เริ่มใหม่'}</small><br>
      <span class="seg-preview">ดูตัวอย่างการตัดคำ</span>
      ${resume ? ' · <span class="seg-preview seg-restart">เริ่มใหม่ตั้งแต่ต้น</span>' : ''}`;
    const preview = card.querySelector<HTMLElement>('.seg-preview');
    if (preview) preview.onclick = (e) => { e.stopPropagation(); void previewSegmentation(pair); };
    const restart = card.querySelector<HTMLElement>('.seg-restart');
    if (restart) restart.onclick = (e) => { e.stopPropagation(); void start(pair, 0); };
    card.onclick = () => start(pair, resume);
    list.appendChild(card);
  }
}

async function previewSegmentation(pair: MediaPair): Promise<void> {
  const cues = parseSRT(await (await fetch(pair.subs)).text());
  const rows = cues.slice(0, 12).map((c) =>
    `<div style="text-align:start;margin:.3em 0">${cueTokens(c.text).map((t) => t.display).join(' · ')}</div>`).join('');
  const card = modal(`
    <h2>การตัดคำ · ${pair.name}</h2>
    <p class="hint" style="text-align:start">ถ้าจุดไหนตัดผิด แก้ในไฟล์ .srt โดยคั่นคำด้วย
      <code>|</code> ในท่อนนั้น (ท่อนที่มี | จะไม่ใช้ตัวตัดอัตโนมัติ)</p>
    ${rows}
    <div class="play-actions"><button class="btn" id="m-close">ปิด</button></div>`);
  on(card, '#m-close', closeModal);
}

// ---- what earlier sessions left behind -----------------------------------------------
// The run log is the only store: each dictation run records the words it missed,
// the words it drilled to mastery, and the words told to stop asking. Replaying
// those events in order gives each word a current state — anything whose latest
// event is a miss is still owed, and anything ever ignored is out of scope for
// good.
async function mediaHistory(mediaName: string): Promise<{ due: DrillItem[]; ignored: Set<string> }> {
  const ignored = new Set<string>();
  let runs;
  try { runs = await loadRuns(); } catch { return { due: [], ignored }; }
  const state = new Map<string, { due: boolean; cue: number }>();
  const mine = runs
    .filter((r): r is DictationRun => r.game === 'dictation' && r.name === mediaName)
    .sort((a, b) => (a.t || '').localeCompare(b.t || ''));
  for (const r of mine) {
    for (const m of r.misses || []) state.set(m.w, { due: true, cue: m.cue ?? 0 });
    for (const w of r.mastered || []) {
      const st = state.get(w);
      if (st) st.due = false;
    }
    for (const w of r.ignored || []) ignored.add(w);
  }
  const due = [...state.entries()]
    .filter(([w, v]) => v.due && !ignored.has(w))
    .slice(0, DUE_CARRIED_MAX)
    .map(([w, v]) => ({ w, cue: v.cue, due: 0, reps: 0, fails: 0, carried: true }));
  return { due, ignored };
}

// ---- session ---------------------------------------------------------------------
async function start(pair: MediaPair, resumeCue: number): Promise<void> {
  const cues = parseSRT(await (await fetch(pair.subs)).text());
  if (!cues.length) return;
  const media = $<HTMLVideoElement>('#dict-media');
  media.src = pair.media;
  media.classList.toggle('audio-only', /\.(mp3|m4a|ogg|opus|wav)$/i.test(pair.media));
  const session: Session = {
    pair, cues, media, read: readMode,
    queue: cues.map((_, i) => i).slice(Math.min(resumeCue, cues.length - 1)),
    qpos: 0, cueAt: resumeCue, tokens: [], wordIdx: 0,
    phase: 'guess', attempts: 0, nudged: false,
    drill: [], drillNow: null, wordsSeen: 0,
    misses: [], mastered: [], ignored: [], ignoreSet: new Set(), flushRounds: 0,
    cuesDone: 0, wordsTotal: 0, wordsWrong: 0, tokensTyped: 0,
    t0: performance.now(),
  };
  D = session;
  // words still owed from earlier sessions on this media open the round
  if (!readMode) {
    const { due, ignored } = await mediaHistory(pair.name)
      .catch(() => ({ due: [] as DrillItem[], ignored: new Set<string>() }));
    // only keep the ones whose cue still holds the word (the .srt may have changed)
    session.drill = due.filter((d) => cues[d.cue]?.text.includes(d.w));
    session.ignoreSet = ignored;
  }
  $('#dict-setup').hidden = true;
  $('#dict-session').hidden = false;
  $<HTMLInputElement>('#dict-typebox').placeholder = readMode ? 'พิมพ์ตามคำที่เห็น…' : 'ฟังแล้วพิมพ์…';
  $('#dict-keys').innerHTML = `<span class="kbd">Tab</span> ฟังซ้ำ · <span class="kbd">Shift+Tab</span> ช้าลง`
    + (readMode ? '' : ' · <span class="kbd">Enter</span> ส่งคำตอบ · <span class="kbd">Esc</span> ยอมแพ้คำนี้'
      + ' · <span class="kbd">Shift+Enter</span> พิมพ์ผิด'
      + ' · <span class="kbd">Ctrl+Enter</span> ไม่ต้องจำคำนี้');
  show('dictation');
  if (session.drill.length) {
    modalNote('🍂 ทบทวนคำเก่า', `มี ${session.drill.length} คำจากรอบก่อนที่ยังสะกดไม่ได้ — เก็บให้จบก่อน`);
  }
  loadNext(session);
}

function currentCueIndex(D: Session): number {
  return D.drillNow ? D.drillNow.cue : D.queue[D.qpos] ?? 0;
}

// The one place that decides what comes next: a due drill outranks a fresh cue,
// and when the cues run out anything still unmastered gets one last pass.
function loadNext(D: Session): void {
  const due = D.drill.find((d) => D.wordsSeen >= d.due);
  if (due) return startDrill(D, due);
  if (D.qpos >= D.queue.length) {
    // The cues are done but words are still owed. Re-arm everything left, once
    // per remaining repetition — going round again (rather than repeating one
    // word back to back) keeps some space between a word's repetitions, which
    // is the whole point of the schedule.
    if (D.drill.length && D.flushRounds < DRILL_GAPS.length) {
      if (!D.flushRounds) modalNote('🍂 รอบเก็บตก', `เหลืออีก ${D.drill.length} คำที่ยังไม่แน่น`);
      D.flushRounds++;
      for (const d of D.drill) d.due = 0;
      return loadNext(D);
    }
    void finishSession(D, true); // the cues ran out: the media is done
    return;
  }
  loadCue(D);
}

function resetWordState(D: Session): void {
  D.phase = 'guess';
  D.attempts = 0;
  D.nudged = false;
  const box = $<HTMLInputElement>('#dict-typebox');
  box.value = '';
  box.readOnly = false;
  box.focus();
  $('#dict-diff').hidden = true;
  $('#dict-diff').innerHTML = '';
  $('#dict-ghost').textContent = '';
  $('#dict-phase').textContent = '';
}

function beginWord(D: Session): void {
  resetWordState(D);
  renderWords(D);
}

function loadCue(D: Session): void {
  D.drillNow = null;
  const ci = currentCueIndex(D);
  D.tokens = cueTokens(D.cues[ci]?.text ?? '');
  D.wordIdx = 0;
  skipNonTargets(D);
  $('#dict-cue-no').textContent = `ท่อนที่ ${ci + 1} / ${D.cues.length}`;
  beginWord(D);
  if (!D.flushRounds) {
    D.cueAt = ci;
    markCue(D.pair.name, ci);
  }
  playCue(D, 1);
  // a cue of nothing but names and punctuation has nothing to type: play it,
  // show it, move on (cueDone defers, so this can't recurse into the next cue)
  if (D.wordIdx >= D.tokens.length) cueDone(D);
}

// A drill replays the cue the word came from — the word alone, out of context,
// would be a different (and easier) task than the one being trained.
function startDrill(D: Session, item: DrillItem): void {
  D.drillNow = item;
  const ci = item.cue;
  D.tokens = cueTokens(D.cues[ci]?.text ?? '');
  D.wordIdx = D.tokens.findIndex((t) => t.target === item.w);
  if (D.wordIdx === -1) { // cue no longer holds it — drop it rather than stall
    dropDrill(D, item);
    D.drillNow = null;
    return loadNext(D);
  }
  $('#dict-cue-no').textContent = `ทบทวน${item.carried ? 'คำเก่า' : ''} · ${item.reps + 1}/${DRILL_GAPS.length}`;
  beginWord(D);
  playCue(D, 1);
}

function dropDrill(D: Session, item: DrillItem): void {
  const i = D.drill.indexOf(item);
  if (i >= 0) D.drill.splice(i, 1);
}

function playCue(D: Session, rate: number): void {
  const cue = D.cues[currentCueIndex(D)];
  const m = D.media;
  if (!cue) return;
  if (m.readyState < 1) { // metadata not loaded yet: seeking would be ignored
    m.addEventListener('loadedmetadata', () => { if (D) playCue(D, rate); }, { once: true });
    return;
  }
  const stop = Number.isFinite(m.duration) ? Math.min(cue.stop, m.duration) : cue.stop;
  m.playbackRate = rate;
  m.currentTime = Math.max(0, cue.start - CUE_LEAD);
  m.play();
  m.ontimeupdate = () => { if (m.currentTime >= stop) { m.pause(); m.ontimeupdate = null; } };
}

function renderWords(D: Session): void {
  const div = $('#dict-words');
  div.innerHTML = '';
  D.tokens.forEach((tok, i) => {
    const sp = document.createElement('span');
    if (!D.read && tok.target && D.ignoreSet.has(tok.target)) {
      // ไม่ต้องจำ: shown so the cue still reads as a sentence, greyed so it is
      // clear it was never typed and isn't being scored
      sp.textContent = tok.display;
      sp.className = 'skipped';
    } else if (D.drillNow) {
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

// Advance past everything that isn't something to type: punctuation-only tokens,
// and words marked ไม่ต้องจำ. Those are shown as context and stepped over — the
// whole point of marking one is not to spend keystrokes on it.
function skipNonTargets(D: Session): void {
  while (D.wordIdx < D.tokens.length) {
    const tok = D.tokens[D.wordIdx];
    if (!tok) break;
    if (!tok.target || (!D.read && D.ignoreSet.has(tok.target))) { D.wordIdx++; continue; }
    break;
  }
}

function currentTarget(D: Session): string {
  return D.tokens[D.wordIdx]?.target ?? '';
}

// ---- the loop: guess → study → recall ------------------------------------------------
// Scoring happens once, on the first guess. Everything after that is practice,
// not measurement — otherwise the accuracy number would reward giving up early.
function submitGuess(D: Session, typed: string): void {
  const target = currentTarget(D);
  if (!target) return;
  const guess = typed.normalize('NFC');
  D.attempts++;
  const first = D.attempts === 1;

  if (guess === target) {
    if (first && !D.drillNow) D.wordsTotal++;
    D.tokensTyped += target.length;
    sound.word();
    return passWord(D, first);
  }

  if (first) {
    if (D.drillNow) {
      D.drillNow.fails++;
      D.drillNow.preMissReps = D.drillNow.reps;
      D.drillNow.reps = 0; // a miss resets the schedule
    } else {
      D.wordsTotal++;
      D.wordsWrong++;
      const tok = D.tokens[D.wordIdx];
      if (tok) tok.firstTryWrong = true;
      recordMiss(D, target);
    }
  }
  sound.error();
  flashBox();
  enterStudy(D, guess, target);
}

function recordMiss(D: Session, target: string): void {
  // The run log is what carries an unmastered word into the next session, so a
  // miss records only what that needs: the word, and the cue to replay it from.
  if (D.misses.length < MISS_LOG_MAX) {
    D.misses.push({ w: target, cue: currentCueIndex(D) });
  }
  // schedule it: first return after the shortest gap
  if (!D.drill.some((d) => d.w === target)) {
    D.drill.push({ w: target, cue: currentCueIndex(D), due: D.wordsSeen + (DRILL_GAPS[0] ?? 5), reps: 0, fails: 0 });
  }
}

// ไม่ต้องจำ: this word is not worth the retrieval loop. Transliterated names are
// the case that matters — their Thai spelling is arbitrary and generalises to
// nothing, so drilling อายาโนโคจิ three times buys nothing a native word would.
// Marking one takes it out of the schedule, out of the carry-over list, and out
// of the accuracy count (rolling back this word's score if it was already
// counted), then shows it to be copied so the sentence still reads.
function ignoreWord(D: Session): void {
  const target = currentTarget(D);
  if (!target || D.ignoreSet.has(target)) return;
  D.ignoreSet.add(target);
  D.ignored.push(target);

  const tok = D.tokens[D.wordIdx];
  if (!D.drillNow && D.attempts) { // un-score it: an ignored word never counts
    D.wordsTotal--;
    if (tok?.firstTryWrong) { D.wordsWrong--; tok.firstTryWrong = false; }
  }
  D.misses = D.misses.filter((m) => m.w !== target);
  D.mastered = D.mastered.filter((w) => w !== target);
  for (const d of D.drill.filter((d) => d.w === target)) dropDrill(D, d);

  // If it was being drilled, the drill is over; otherwise stay on the word and
  // let it be copied through.
  if (D.drillNow) {
    D.drillNow = null;
    D.wordsSeen++;
    return loadNext(D);
  }
  advanceWord(D); // it is context from here on, not something to type
}

// พิมพ์ผิด: that was a slipped finger, not a spelling you don't have. Undoes
// exactly what the miss did — the word scores as spelled right first time, its
// miss is struck from the run log (so it is not owed next session) and its drill
// is dropped (so it does not come back three times). It is deliberately NOT
// added to the ignore set: unlike ไม่ต้องจำ this word is worth meeting again, so
// the very next cue that holds it asks for it as normal.
function typoWord(D: Session): void {
  const target = currentTarget(D);
  const tok = D.tokens[D.wordIdx];
  const item = D.drillNow;
  // only meaningful once this word has actually been marked wrong
  if (!target || (!item && !tok?.firstTryWrong)) return;

  if (item) {
    // a slip mid-drill: the repetition stands and the schedule is not reset
    item.fails--;
    item.reps = item.preMissReps ?? item.reps;
    D.tokensTyped += target.length;
    sound.word();
    passWord(D, true);
    return;
  }

  D.wordsWrong--; // wordsTotal stays: the word was answered, and answered right
  if (tok) tok.firstTryWrong = false;
  D.misses = D.misses.filter((m) => m.w !== target);
  for (const d of D.drill.filter((d) => d.w === target)) dropDrill(D, d);
  D.tokensTyped += target.length;
  sound.word();
  advanceWord(D);
}

// Study: the answer is on screen and the box is inert. It sits above the typing
// bar, deliberately not in it — an answer in the same line you type into makes
// the whole thing a transcription exercise.
function enterStudy(D: Session, guess: string, target: string): void {
  D.phase = 'study';
  const box = $<HTMLInputElement>('#dict-typebox');
  box.readOnly = true;
  box.value = '';
  if (guess) {
    $('#dict-diff').innerHTML = diffHTML(guess, target);
    $('#dict-diff').hidden = false;
  }
  $('#dict-ghost').textContent = target;
  // the opt-out is offered here, where you have just seen the word and can tell
  // whether it is worth learning — a transliterated name usually isn't
  $('#dict-phase').innerHTML =
    'จำรูปคำไว้ — กด Enter แล้วพิมพ์จากความจำ'
    + ' · <button class="linkbtn" id="dict-skip">ไม่ต้องจำคำนี้</button>'
    + ' · <button class="linkbtn" id="dict-typo">พิมพ์ผิด</button>';
  $('#dict-skip').onclick = () => { if (D) ignoreWord(D); };
  $('#dict-typo').onclick = () => { if (D) typoWord(D); };
  box.focus();
}

// Recall: the cover step. The answer disappears and has to come back out of
// memory — this is the part that actually moves spelling.
function enterRecall(D: Session): void {
  D.phase = 'recall';
  const box = $<HTMLInputElement>('#dict-typebox');
  box.readOnly = false;
  box.value = '';
  $('#dict-diff').hidden = true;
  $('#dict-ghost').textContent = '';
  $('#dict-phase').textContent = 'พิมพ์จากความจำ (Esc = ดูอีกครั้ง)';
  box.focus();
}

function checkRecall(D: Session, typed: string): void {
  const target = currentTarget(D);
  if (typed.normalize('NFC') !== target) {
    sound.error();
    flashBox();
    enterStudy(D, '', target); // no diff on a recall slip: just look again
    return;
  }
  D.tokensTyped += target.length;
  sound.word();
  passWord(D, false);
}

// A word is done for now. `clean` means it was right on the first guess, which
// is what advances a drill item toward being retired.
function passWord(D: Session, clean: boolean): void {
  D.wordsSeen++;
  const item = D.drillNow;
  if (item) {
    if (clean) {
      item.reps++;
      if (item.reps >= DRILL_GAPS.length) {
        D.mastered.push(item.w);
        dropDrill(D, item);
      } else {
        item.due = D.wordsSeen + (DRILL_GAPS[item.reps] ?? 5);
      }
    } else if (item.fails >= DRILL_GIVEUP) {
      dropDrill(D, item); // stop interrupting; it stays owed for next session
    } else {
      item.due = D.wordsSeen + (DRILL_GAPS[0] ?? 5);
    }
    D.drillNow = null;
    setTimeout(() => { if (D) loadNext(D); }, 450);
    return;
  }
  advanceWord(D);
}

function advanceWord(D: Session): void {
  D.wordIdx++;
  skipNonTargets(D);
  beginWord(D);
  if (D.wordIdx >= D.tokens.length) cueDone(D);
}

function cueDone(D: Session): void {
  D.cuesDone++;
  sound.word();
  setTimeout(() => {
    if (!D) return;
    if (!D.drillNow) D.qpos++;
    loadNext(D);
  }, 700);
}

function flashBox(): void {
  const box = $<HTMLInputElement>('#dict-typebox');
  box.value = '';
  box.classList.remove('flash-red');
  void box.offsetWidth; // restart the animation
  box.classList.add('flash-red');
}

function modalNote(title: string, text: string): void {
  const card = modal(`<h2>${title}</h2><div class="modal-sub">${text}</div>
    <div class="play-actions"><button class="btn gold" id="m-go">ลุยต่อ</button></div>`);
  on(card, '#m-go', () => { closeModal(); $('#dict-typebox').focus(); });
}

// `complete` separates the two ways a round ends: the cues ran out (start the
// media fresh next time) or you stopped for the night (come back to this cue).
// They used to be the same call, so stopping mid-episode threw away your place.
// Write the round. `complete` means the cues ran out, which is the only ending
// that clears the resume cursor; `leaving` means the page is on its way out, so
// the request has to be allowed to outlive it.
async function saveSession(D: Session, complete: boolean, leaving = false): Promise<void> {
  const acc = D.wordsTotal ? 1 - D.wordsWrong / D.wordsTotal : 1;
  const secs = (performance.now() - D.t0) / 1000;
  const mastered = [...new Set(D.mastered)];
  const run: NewRun = {
    game: 'dictation', name: D.pair.name, cues: D.cuesDone,
    words: D.wordsTotal, acc: Math.round(acc * 1000) / 1000,
    secs: Math.round(secs),
    chars: D.tokensTyped || 0,
    ...(D.read ? { read: true } : { misses: D.misses, mastered, ignored: [...new Set(D.ignored)] }),
  };
  await saveRun(run, leaving);
  // ending a round is the moment the place matters most: send it now rather
  // than waiting out the timer
  if (complete) clearResume(D.pair.name);
  else await flushResume(leaving);
}

// The explicit ending: the cues ran out, so there is a score to show.
async function finishSession(D: Session, complete: boolean): Promise<void> {
  await saveSession(D, complete);
  sound.level();
  const acc = D.wordsTotal ? 1 - D.wordsWrong / D.wordsTotal : 1;
  const mastered = [...new Set(D.mastered)];
  const drilled = mastered.length
    ? `<div class="modal-sub">ทบทวนจนสะกดได้เอง ${mastered.length} คำ</div>` : '';
  // say where you will pick up, so stopping mid-episode is plainly safe
  const place = complete ? ''
    : `<div class="modal-sub">ครั้งหน้าเล่นต่อจากท่อนที่ ${D.cueAt + 1} / ${D.cues.length}</div>`;
  const card = modal(`
    <h2>จบรอบ · ${D.pair.name}</h2>
    <div class="modal-cpm">${Math.round(acc * 100)}%</div>
    <div class="modal-sub">สะกดถูกตั้งแต่ครั้งแรก ${D.wordsTotal - D.wordsWrong} จาก ${D.wordsTotal} คำ</div>
    ${drilled}
    ${place}
    <div class="play-actions"><button class="btn" id="m-close">กลับ</button></div>`);
  on(card, '#m-close', () => { closeModal(); exitSession(); });
}

// Leaving the view, or the page, ends the round: the words you missed and the
// ones you retired are what the next session opens on, so they must not depend
// on remembering to press something. Nothing is written if you typed nothing —
// glancing at ฟัง–พิมพ์ and going elsewhere is not a round.
export function leaveDictation(pageGoing = false): void {
  const session = D;
  D = null;
  void flushResume(pageGoing); // the cursor goes either way
  if (!session) return;
  $<HTMLVideoElement>('#dict-media').pause();
  if (session.wordsTotal) void saveSession(session, false, pageGoing);
  if (!pageGoing) exitSession();
}

function exitSession(): void {
  D = null;
  const m = $<HTMLVideoElement>('#dict-media');
  m.pause();
  m.removeAttribute('src');
  $('#dict-session').hidden = true;
  $('#dict-setup').hidden = false;
  void initDictation();
}

// ---- read mode ------------------------------------------------------------------------
// ดูแล้วพิมพ์ is the copy-typing mode on purpose (it trains the keyboard, not
// spelling), so it keeps the old plain behaviour: wrong word, flash, retype.
function readModeInput(D: Session, typed: string): void {
  const target = currentTarget(D);
  if (!target || typed.length < target.length) return;
  const attempt = typed.slice(0, target.length).normalize('NFC');
  D.attempts++;
  if (attempt === target) {
    if (D.attempts === 1) D.wordsTotal++;
    D.tokensTyped += target.length;
    sound.word();
    advanceWord(D);
    return;
  }
  if (D.attempts === 1) {
    D.wordsTotal++;
    D.wordsWrong++;
    const tok = D.tokens[D.wordIdx];
    if (tok) tok.firstTryWrong = true;
  }
  sound.error();
  flashBox();
}

// ---- input --------------------------------------------------------------------------
export function initDictationInput(): void {
  // a closing tab still ends the round properly: cursor and run both go out
  addEventListener('pagehide', () => { leaveDictation(true); });

  // mode chips on the setup screen; the choice applies to the next session
  const modes = $('#dict-modes');
  const paintModes = () => {
    for (const b of modes.querySelectorAll<HTMLElement>('.chip')) {
      b.classList.toggle('sel', (b.dataset.mode === 'read') === readMode);
    }
  };
  paintModes();
  modes.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest<HTMLElement>('.chip') : null;
    if (!b) return;
    readMode = b.dataset.mode === 'read';
    localStorage.setItem('tt.dictMode', readMode ? 'read' : 'listen');
    paintModes();
  });

  const box = $<HTMLInputElement>('#dict-typebox');
  box.addEventListener('input', (e) => {
    if (!D) return;
    box.placeholder = ''; // stop it reappearing between words
    if (inserted(e)) sound.click();
    if (D.read) return readModeInput(D, box.value);
    // Reaching the answer's length auto-submits, which keeps the rhythm of the
    // old game; Enter exists for guesses you can't fill out that far.
    const target = currentTarget(D);
    if (!target || box.value.length < target.length) return;
    if (D.phase === 'guess') submitGuess(D, box.value.slice(0, target.length));
    else if (D.phase === 'recall') checkRecall(D, box.value.slice(0, target.length));
  });

  box.addEventListener('keydown', (e) => {
    if (!D) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      playCue(D, e.shiftKey ? 0.7 : 1);
      return;
    }
    if (D.read) return;

    // Ctrl+Enter: ไม่ต้องจำ. Bound to a modifier rather than a character because
    // the Kedmanee layout has no free printable key — under Thai input every
    // physical key already produces a letter.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      ignoreWord(D);
      return;
    }

    // Shift+Enter: พิมพ์ผิด. Same reason as Ctrl+Enter above — under Thai input
    // every printable key already produces a letter, so a modifier it is.
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      if (D.phase === 'study') typoWord(D);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (D.phase === 'study') enterRecall(D);
      else if (D.phase === 'recall') checkRecall(D, box.value);
      else if (box.value) submitGuess(D, box.value);
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      if (D.phase === 'study') return;          // the answer is already up
      if (D.phase === 'recall') {               // forgot it again — look once more
        enterStudy(D, '', currentTarget(D));
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
      submitGuess(D, box.value);
    }
  });

  $('#dict-replay').addEventListener('click', () => { if (D) { playCue(D, 1); box.focus(); } });
}
