// The speed game: 10fastfingers-style word stream. Type the highlighted word,
// hit space to commit. Also drives free-text mode (same engine, words in order).
//
// Levels are generated, not stored: a seeded PRNG samples the frequency-ordered
// word pool, with the sampling window widening as levels rise. Every level is
// deterministic, so replaying "ด่าน 217" always gives the same words.
import { sound } from './audio.ts';
import { music } from './music.ts';
import { loadRuns, saveRun, stats, starsFor } from './records.ts';
import { $, show, modal, closeModal, confetti, inserted, on, setRegion, REGION_SIZE, TOTAL_LEVELS } from './ui.ts';
import { levelWords } from './levels.ts';
import { hasThai } from './segment.ts';
import { BY_LEVEL, thaiNum } from './data/mongkhon.ts';
import type { NewRun } from './types.ts';

// One typing session, in the shape finishSession needs. The ข่าว reader
// (reader.ts) builds its own with the same fields plus a couple of its own, so
// this is the contract between the two surfaces — not just speed.ts's state.
export interface Session {
  mode: 'speed' | 'text';
  title: string;
  words: string[];
  breaks?: boolean[];
  skip: boolean[];   // tokens with no Thai: read, not typed (see hasThai)
  spans: HTMLElement[];
  idx: number;
  keys: number;
  wrong: number;
  correctChars: number;
  t0: number | null;   // set on the first keystroke; the clock starts there
  done: boolean;
  backView: string;
  nospace?: boolean;
  name?: string;       // text runs
  level?: number;      // speed runs
  extra?: Record<string, string>; // e.g. { src } for a ข่าว run
  restart?: () => void; // a mode whose "เล่นอีกครั้ง" isn't begin() (the reader)
}

let S: Session | null = null; // current session

// เส้นทาง levels run words together like real Thai prose by default; the
// journey-bar toggle brings the classic word-gap-word stream back.
export const levelSpaces = {
  enabled: localStorage.getItem('tt.levelSpaces') === 'on',
  toggle(): boolean {
    this.enabled = !this.enabled;
    localStorage.setItem('tt.levelSpaces', this.enabled ? 'on' : 'off');
    return this.enabled;
  },
};

export function startLevel(level: number): void {
  const { words, breaks, bonus } = levelWords(level);
  setRegion(Math.floor((level - 1) / REGION_SIZE));
  begin({
    mode: 'speed', level, words, breaks,
    title: bonus ? `ด่าน ${level} · โบนัสสุภาษิต 🍃` : `ด่าน ${level}`,
    backView: 'journey',
  });
}

// เรื่องอ่าน and ข่าว both run here. opts lets ข่าว return to its own tab
// (backView) and stamp the run with extra fields (run: { src }) so news stats
// can be attributed to a สำนักข่าว.
export function startText(name: string, title: string, words: string[], breaks: boolean[],
  opts: { backView?: string; run?: Record<string, string> } = {}): void {
  begin({ mode: 'text', name, words, breaks, title, backView: opts.backView || 'texts', extra: opts.run });
}

type SessionConfig = Omit<Session, 'skip' | 'spans' | 'idx' | 'keys' | 'wrong' | 'correctChars' | 't0' | 'done'>;

function begin(cfg: SessionConfig): void {
  // A dropped .txt or a news lead can carry anything: quotes, a year, a percent
  // sign, an English name. You type the Thai and read the rest, exactly as the
  // ข่าว reader does — otherwise a stray em dash is an unpassable wall, and
  // every keystroke spent trying to get past it counts against your accuracy.
  const skip = cfg.words.map((w) => !hasThai(w));
  if (skip.every(Boolean)) { // nothing to type: never open a session that can't end
    const card = modal(`<h2>${cfg.title}</h2>
      <div class="modal-sub">ไม่มีคำภาษาไทยให้พิมพ์ในเรื่องนี้</div>
      <div class="play-actions"><button class="btn" id="m-close">กลับ</button></div>`);
    on(card, '#m-close', () => { closeModal(); show(cfg.backView); });
    return;
  }
  S = { ...cfg, skip, spans: [], idx: 0, keys: 0, wrong: 0, correctChars: 0, t0: null, done: false };
  $('#play-title').textContent = S.title;
  $('#play-progress').style.width = '0';
  const stream = $('#wordstream');
  // words run together with no gaps, like natural Thai prose: always in
  // เรื่องอ่าน, and in เส้นทาง unless the journey-bar toggle turned spaces on
  S.nospace = S.mode === 'text' || !levelSpaces.enabled;
  stream.classList.toggle('nospace', S.nospace);
  stream.innerHTML = '';
  const breaks = S.breaks;
  S.spans = S.words.map((w, i) => {
    const sp = document.createElement('span');
    sp.textContent = w;
    // where words butt together, a 'brk' span keeps the space the source had
    if (breaks && breaks[i]) sp.classList.add('brk');
    // dimmed from the start, not once the cursor reaches it: you should be able
    // to see it was never your turn, rather than find out by typing it
    if (skip[i]) sp.classList.add('skip');
    stream.appendChild(sp);
    return sp;
  });
  passSkips(S);
  S.spans[S.idx]?.classList.add('cur');
  show('play');
  // reset AFTER show(): the stream lives in the play view, which is hidden until
  // now when a เรื่องอ่าน story is launched from its list. Setting scrollTop while
  // the element is display:none is a no-op (nothing to scroll), so the browser
  // would reveal it on a stale offset with line one hidden above the two-line
  // window. show() lays it out; only then can we pin line one to the top.
  stream.scrollTop = 0;
  if (S.mode === 'speed') music.playForLevel(S.level ?? 1);
  else music.playForName(S.name || S.title);
  const box = $<HTMLInputElement>('#typebox');
  box.value = '';
  // no-gap modes flow word-to-word on their own; with spaces, commit with a space
  box.placeholder = !S.nospace
    ? 'พิมพ์คำ แล้วเคาะวรรคเพื่อส่ง…' // shown until the first keystroke
    : S.mode === 'text'
      ? 'พิมพ์ตามเรื่อง เว้นวรรคเมื่อเจอช่องว่าง…'
      : S.breaks
        ? 'พิมพ์คำติดกัน เว้นวรรคระหว่างสุภาษิต…' // bonus proverb levels
        : 'พิมพ์คำติดกันได้เลย ไม่ต้องเคาะวรรค…';
  box.focus();
}

// Step over the tokens you don't type: marked passed, never scored — they add
// nothing to correctChars, so cpm stays a measure of what you actually typed.
function passSkips(S: Session): void {
  while (S.idx < S.words.length && S.skip[S.idx]) S.idx++;
}

function scrollCurrentIntoView(S: Session): void {
  // span.offsetTop is already relative to the stream (its position:relative
  // offsetParent). Anchor on the first span so line one sits at scrollTop 0
  // and every later line scrolls up to the top of the two-line window.
  const stream = $('#wordstream');
  const sp = S.spans[S.idx];
  const first = S.spans[0];
  if (sp && first) stream.scrollTop = Math.max(0, sp.offsetTop - first.offsetTop);
}

function commitWord(S: Session, typed: string): void {
  const target = S.words[S.idx];
  const sp = S.spans[S.idx];
  if (!sp) return;
  sp.classList.remove('cur', 'bad');
  const ok = typed === target;
  sp.classList.add(ok ? 'ok' : 'err');
  if (ok && target) { S.correctChars += target.length; sound.word(); } else { sound.error(); }
  S.idx++;
  passSkips(S);
  $('#play-progress').style.width = `${(S.idx / S.words.length) * 100}%`;
  if (S.idx >= S.words.length) { void finishSession(S); return; }
  S.spans[S.idx]?.classList.add('cur');
  scrollCurrentIntoView(S);
}

// The one scoring/results implementation, shared by every text-shaped mode:
// the wordstream (levels, เรื่องอ่าน) and the ข่าว reader (reader.ts) both end
// here, so cpm/acc/stars math and the run-record contract stay in one place.
export async function finishSession(S: Session): Promise<void> {
  S.done = true;
  const secs = (performance.now() - (S.t0 ?? performance.now())) / 1000;
  const cpm = Math.round((S.correctChars / (secs / 60)) * 10) / 10;
  const acc = Math.round((S.keys ? 1 - S.wrong / S.keys : 1) * 1000) / 1000;

  const st = stats(await loadRuns());
  const stars = starsFor(acc, cpm, st.baseline); // rules live in records.ts
  const pb = acc >= 0.90 && cpm > st.pb;
  // the mirror reward: a new accuracy best is a record too, so slowing down to
  // type cleanly is celebrated exactly like a speed PB. Floored at a solid run
  // (0.85, ~the median) so early flails don't trigger it every time.
  const cleanPb = acc > st.accPb && acc >= 0.85;
  const level = S.mode === 'speed' ? S.level ?? 0 : 0;

  const run: NewRun = {
    game: S.mode, cpm, acc, chars: S.correctChars, errors: S.wrong,
    secs: Math.round(secs * 10) / 10, stars,
  };
  if (level) { run.level = level; run.pb = pb; }
  if (S.name) run.name = S.name;
  if (S.extra) Object.assign(run, S.extra); // e.g. { src } for a ข่าว run
  await saveRun(run);

  // finishing a shrine level for the first time opens its มงคลชีวิต blessing
  const blessing = level > st.maxDone ? BY_LEVEL.get(level) : null;

  if (pb || cleanPb || blessing) { sound.pb(); confetti(); } else { sound.level(); }

  const delta = st.pb ? Math.round((cpm - st.pb) * 10) / 10 : null;
  const starHtml = [1, 2, 3].map((n) =>
    `<span class="star ${n <= stars ? 'on' : ''}" style="animation-delay:${n * 0.25}s">★</span>`).join('');
  const nextLevel = level ? level + 1 : null;
  const card = modal(`
    <h2>${S.title}</h2>
    <div class="modal-stars">${starHtml}</div>
    <div class="modal-cpm">${Math.round(cpm)} <small style="font-size:.9rem">ตัวอักษร/นาที</small></div>
    <div class="modal-sub">
      ความแม่นยำ ${Math.round(acc * 100)}%
      ${pb ? '<div class="modal-pb">🏆 สถิติความเร็วใหม่!' + (delta !== null && delta > 0 ? ` เร็วขึ้น ${delta}` : '') + '</div>'
           : (delta !== null && delta < 0 ? `<div>ห่างสถิติ ${Math.abs(Math.round(delta))} ตัวอักษร/นาที</div>` : '')}
      ${cleanPb ? `<div class="modal-pb clean">🎯 แม่นที่สุดเท่าที่เคยพิมพ์! ${Math.round(acc * 100)}%</div>` : ''}
      ${acc < 0.85
        ? '<div class="slow-note">🐢 ช้าลงหน่อย — ต่ำกว่า 85% แปลว่าเร็วเกินกว่าที่มือจะจำได้ ผ่อนความเร็วลงจนหยุดผิด แล้วปล่อยให้ความแม่นสร้างความเร็วให้เอง</div>'
        : (stars === 1 ? '<div>รักษาความแม่น 88% ที่จังหวะสบาย ๆ ของคุณ แล้วดาวดวงที่สองจะมาเอง</div>'
        : stars === 2 ? '<div>พิมพ์ให้นิ่งที่ 93% ไปเรื่อย ๆ ความเร็วจะไต่ขึ้นเองจนได้ ★★★</div>' : '')}
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
      ${level
        ? '<button class="btn" id="m-map">🗺 กลับแผนที่</button>'
        : '<button class="btn" id="m-close">กลับ</button>'}
      ${nextLevel && nextLevel <= TOTAL_LEVELS
        ? '<button class="btn gold" id="m-next">ด่านต่อไป →</button>' : ''}
    </div>`);
  on(card, '#m-retry', () => {
    closeModal();
    if (S.restart) return S.restart();
    if (level) startLevel(level);
    else begin({ ...S }); // begin() recomputes skip/spans from words
  });
  if (nextLevel && nextLevel <= TOTAL_LEVELS) {
    on(card, '#m-next', () => { closeModal(); startLevel(nextLevel); });
  }
  if (level) on(card, '#m-map', () => { closeModal(); show('journey'); });
  else on(card, '#m-close', () => { closeModal(); show(S.backView); });
}

export function initSpeed(): void {
  const box = $<HTMLInputElement>('#typebox');
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
      if (typed) commitWord(S, typed);
      return;
    }
    const target = S.words[S.idx] ?? '';
    const nv = v.normalize('NFC');
    if (inserted(e)) { // a real inserted character (not backspace)
      S.keys++;
      const pos = v.length - 1;
      if (nv[pos] === target[pos]) sound.click();
      else { S.wrong++; sound.thud(); }
    }
    S.spans[S.idx]?.classList.toggle('bad', !target.startsWith(nv));
    // no-gap modes: words run together, so a finished word advances on its own —
    // no space needed. A space is only for real sentence breaks (S.breaks[idx]).
    if (S.nospace && !(S.breaks && S.breaks[S.idx]) && nv === target) {
      box.value = '';
      commitWord(S, nv);
    }
  });
  $('#play-quit').addEventListener('click', () => {
    const back = S ? S.backView : 'journey';
    S = null;
    show(back);
  });
}
