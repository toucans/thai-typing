// พิมพ์ไล่ผี — the night game. Thai ghosts drift out of the dark toward the
// spirit house, each carrying one word; typing that word through is the chant
// that banishes it. Where the journey trains careful accuracy at your own
// pace, this trains the other half of fluency: recall under time pressure —
// a wrong keystroke isn't a statistic here, it's a Krasue two steps closer.
//
// Rules of the hunt:
//  - your first keystroke locks the nearest ghost whose word starts with it
//    (spawns are arranged so no two active ghosts share a first character)
//  - wrong keys are rejected, cost accuracy, and make the locked ghost lurch
//    forward; backspacing to empty releases the lock so you can retarget
//  - a locked ghost drifts at less than half speed — keep chanting
//  - a ghost that reaches the shrine puts out a candle; three candles is the
//    night, and the night is over when the third goes out
//  - three waves, then the boss: a เปรต carrying a whole proverb, banished
//    one segment at a time, knocked back with each one
//
// Nights are generated, not stored (same trick as levels.js): a seeded PRNG
// samples the frequency-ordered pool, wider and faster as nights deepen, so
// every night is deterministic and replayable. Runs append to the same
// per-user JSONL as everything else, as game:'ghosts'.
import { WORDS } from './data/words.js';
import { SENTENCES } from './data/sentences.js';
import { thaiNum } from './data/mongkhon.js';
import { sound } from './audio.js';
import { loadRuns, saveRun } from './records.js';
import { $, modal, closeModal, confetti, segmentThai } from './ui.js';
import { makePainter, mulberry32 } from './pixel.js';

const W = 320, H = 180;
const LX = 160, LY = 105;      // where the ghosts are headed: the spirit house
const WAVES = 3, WAVE_SIZE = 8;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---- palette + sprites (night colors are fixed — it is always night here) ------
const N = {
  sky0: '#0a0d1c', sky1: '#0f142c', sky2: '#151b3a',
  star: '#cfc6ab', starHi: '#f6f1e4', moon: '#f3e9c8', moonD: '#d8cba0',
  hill: '#0d1712', hill2: '#122019',
  ground: '#101c14', grass: '#17281c', grassL: '#1f3524',
  leaf: '#152819', leafL: '#1c3421',
  post: '#4a3626', roof: '#7a2f24', cream: '#cfc0a0', lit: '#ffcf7a',
  gold: '#d4a72c', goldHi: '#f0cc5e',
  flame: '#ffb03a', flameHi: '#ffe08a',
  red: '#c04a3f', glow: '#7fe08a', smoke: '#39415a',
  robe: '#d97f28', skin: '#d9a06b',
};

const KRASUE = ['.kkkkkkk.', 'kkkkkkkkk', 'kkfffffkk', 'kfefffefk', 'kfffffffk',
  '.kfffffk.', '..frrrf..', '...v.v...', '..v.r.v..', '...v.v...'];
const KRASUE_PAL = { k: '#231a2c', f: '#d9c8a0', e: '#ffd24a', r: '#a83232', v: N.glow };

const KRAHANG = ['w.........w', 'ww..kkk..ww', 'www.fff.www', '.ww..f..ww.',
  '..wbbbbbw..', '...bbbbb...', '....b.b....', '....p.p....'];
const KRAHANG_PAL = { w: '#8a6a3a', k: '#231a2c', f: '#c99b6e', b: '#b3865d', p: '#4a3b2f' };

const POP = ['..kkk..', '.kkkkk.', '.kfffk.', '.kefek.', '..fff..',
  '.ppppp.', 'p.ppp.p', '..p.p..'];
const POP_PAL = { k: '#4a4060', f: '#b7a98d', e: '#ff5544', p: '#3a3152' };

const TANI = ['.kkkkk.', 'kkkkkkk', 'kkfffkk', 'kfefefk', 'kkfffkk',
  '.ttttt.', '.ttttt.', '.ttttt.', '..ttt..', '..t.t..'];
const TANI_PAL = { k: '#231a2c', f: '#cfe0b8', e: '#1a1420', t: '#3f8f5a' };

const AM = ['..aaa..', '.aaaaa.', 'aaeaeaa', 'aaaaaaa', '.a.a.a.'];
const AM_PAL = { a: '#38304a', e: '#ffd24a' };

// word length decides who comes for you: short words are the small quick
// horrors, long words the big slow ones — the TotD "tougher enemy carries a
// longer phrase" rule, in Thai folklore terms
const TYPES = [
  { rows: AM, pal: AM_PAL, name: 'ผีอำ', maxLen: 3 },
  { rows: POP, pal: POP_PAL, name: 'ผีปอบ', maxLen: 4 },
  { rows: KRASUE, pal: KRASUE_PAL, name: 'กระสือ', maxLen: 5, glow: true },
  { rows: TANI, pal: TANI_PAL, name: 'นางตานี', maxLen: 7 },
  { rows: KRAHANG, pal: KRAHANG_PAL, name: 'กระหัง', maxLen: 99 },
];

// the boss: a towering, pinhole-mouthed เปรต — the hungry ghost of Thai
// Buddhist lore, fittingly banished by a whole proverb
const PRET = ['...kkk...', '..fffff..', '..fefef..', '....m....', '....f....',
  '....f....', '..sssss..', '.ss.s.ss.', '.s..s..s.', '.s..s..s.', '....s....',
  '....s....', '...s.s...', '...s.s...', '...s.s...', '..s...s..'];
const PRET_PAL = { k: '#3a3145', f: '#b7a98d', e: '#1a1420', m: '#a83232', s: '#9aa08b' };

const SAAN = ['.......g.......', '......grg......', '.....rrrrr.....', '....rrrrrrr....',
  '...rrrrrrrrr...', '..rrrrrrrrrrr..', '...ccccccccc...', '...cWWWWWWWc...',
  '...cWWWWWWWc...', '...ccccccccc...', '....ttttttt....'];
const SAAN_PAL = { g: N.goldHi, r: N.roof, c: N.cream, W: N.lit, t: N.post };

const MONK = ['..fff..', '..fff..', '..ooo..', '.ooooo.', 'ooooooo', 'ooooooo'];
const MONK_PAL = { f: N.skin, o: N.robe };

// ---- module state ----------------------------------------------------------------
let G = null;        // current night session
let raf = 0;
let P = null;        // painter on the visible canvas
let bg = null;       // pre-painted night scene (static per night)

const pace = (n) => Math.max(0.5, Math.pow(0.97, n - 1));
const poolFor = (n) => Math.min(WORDS.length, 80 + 60 * (n - 1));
const maxActive = (n) => Math.min(4, 2 + Math.floor((n - 1) / 3));
const travelFor = (word, n) => (4.5 + 1.15 * word.length) * pace(n);

// ---- the night scene (painted once per night onto an offscreen canvas) -----------
function paintScene(night) {
  bg = document.createElement('canvas');
  bg.width = W; bg.height = H;
  const { px, rect, disc, spr } = makePainter(bg);
  const rng = mulberry32(night * 271 + 9);

  // sky bands, dithered at the seams
  rect(0, 0, W, 46, N.sky0);
  rect(0, 46, W, 34, N.sky1);
  rect(0, 80, W, 44, N.sky2);
  for (let x = 0; x < W; x += 2) {
    if (rng() < 0.5) px(x, 45 + (x % 4 ? 1 : 0), N.sky1);
    if (rng() < 0.5) px(x + 1, 79 + (x % 4 ? 1 : 0), N.sky2);
  }
  for (let i = 0; i < 70; i++) { // stars, a few of them bright
    const x = rng() * W, y = rng() * 78;
    px(x, y, rng() < 0.18 ? N.starHi : N.star);
  }
  disc(272, 26, 11, N.moon); // full moon, cratered
  px(268, 22, N.moonD); px(276, 30, N.moonD); px(271, 31, N.moonD);
  px(277, 21, N.moonD); px(265, 27, N.moonD);
  for (let a = 0; a < 24; a++) { // a sparse pixel halo
    const th = (a / 24) * Math.PI * 2;
    if (a % 2) px(272 + Math.cos(th) * 14, 26 + Math.sin(th) * 14, '#2a2f52');
  }

  // two hill ridges, then the dark field
  for (let x = 0; x < W; x++) {
    const y1 = 96 + Math.round(6 * Math.sin(x / 34) + 3 * Math.sin(x / 11 + 2));
    rect(x, y1, 1, 124 - y1, N.hill);
  }
  for (let x = 0; x < W; x++) {
    const y2 = 110 + Math.round(5 * Math.sin(x / 23 + 5) + 2 * Math.sin(x / 7));
    rect(x, y2, 1, 124 - y2, N.hill2);
  }
  rect(0, 124, W, H - 124, N.ground);
  for (let i = 0; i < 260; i++) { // grass speckle, thicker up close
    const y = 124 + Math.pow(rng(), 0.6) * (H - 125);
    px(rng() * W, y, rng() < 0.3 ? N.grassL : N.grass);
  }
  for (let i = 0; i < 30; i++) { // grass blades in the foreground
    const x = rng() * W, y = 150 + rng() * 26;
    rect(x, y - 3, 1, 3, N.grassL);
  }

  // banana groves flanking the clearing — นางตานี's home turf
  for (const gx of [16, 34, 292, 306]) {
    const gh = 96 + rng() * 14;
    rect(gx, gh, 2, 124 - gh, N.leaf); // stem
    for (let b = 0; b < 5; b++) {      // drooping leaf blades
      const dir = b % 2 ? 1 : -1, ly = gh + b * 3;
      for (let s = 0; s < 9; s++) px(gx + 1 + dir * s, ly + (s * s) / 14, s < 5 ? N.leafL : N.leaf);
    }
  }

  // the shrine: house lit warm on its post, the monk keeping vigil, a step
  // with three candles — the whole reason to hold the line
  spr(152, 92, SAAN, SAAN_PAL);
  rect(158, 103, 4, 22, N.post);
  rect(155, 124, 10, 2, N.post);
  spr(140, 116, MONK, MONK_PAL);
  rect(149, 127, 22, 3, N.post);                    // the candle step
  for (const cx of [152, 159, 166]) rect(cx, 123, 2, 4, N.cream); // candle bodies
  // warm light pooling on the ground around the candles
  for (let i = 0; i < 60; i++) {
    const a = rng() * Math.PI * 2, r = Math.pow(rng(), 0.7) * 15;
    px(160 + Math.cos(a) * r * 1.7, 129 + Math.sin(a) * r * 0.45, r < 7 ? '#43331c' : '#2c2415');
  }
}

// ---- session ---------------------------------------------------------------------
export function startNight(night) {
  const rng = mulberry32(night * 7919 + 13);
  G = {
    night, rng, pool: poolFor(night), maxActive: maxActive(night),
    phase: 'wave', wave: 1, waveLeft: WAVE_SIZE,
    ghosts: [], boss: null, parts: [], recent: [],
    lock: null, buf: '', keys: 0, wrong: 0, chars: 0, banished: 0,
    candles: 3, spawnCd: 1.6, shake: 0,
    t0: performance.now(), lastT: 0, over: false,
  };
  paintScene(night);
  $('#gh-setup').hidden = true;
  $('#gh-session').hidden = false;
  $('#gh-labels').innerHTML = '';
  const box = $('#gh-typebox');
  box.value = ''; box.focus();
  hud();
  banner(`คืนที่ ${thaiNum(night)}`);
  cancelAnimationFrame(raf);
  G.lastT = performance.now();
  raf = requestAnimationFrame(loop);
}

// biased sample from the night's pool; active ghosts must not share a first
// character (that is what makes first-keystroke lock-on unambiguous) or a word
function pickWord() {
  for (let tries = 0; tries < 60; tries++) {
    const w = WORDS[Math.floor(Math.pow(G.rng(), 1.6) * G.pool)];
    if (!w) continue;
    if (G.ghosts.some((o) => o.word[0] === w[0] || o.word === w)) continue;
    if (tries < 40 && G.recent.includes(w)) continue;
    return w;
  }
  return null; // wait a beat; the screen is crowded with lookalikes
}

function spawnGhost() {
  const word = pickWord();
  if (!word) return;
  G.recent.push(word);
  if (G.recent.length > 12) G.recent.shift();
  const type = TYPES.find((t) => word.length <= t.maxLen) || TYPES[TYPES.length - 1];
  const g = {
    word, type, p: 0, travel: travelFor(word, G.night),
    x0: 24 + Math.random() * (W - 48), y0: 14 + Math.random() * 26,
    x: 0, y: 0, phase: Math.random() * Math.PI * 2,
    el: label('gh-label'),
  };
  G.ghosts.push(g);
  G.waveLeft--;
  refreshLabels();
}

function startBoss() {
  G.phase = 'boss';
  const segs = segmentThai(SENTENCES[Math.floor(G.rng() * SENTENCES.length)]);
  G.boss = {
    segs, i: 0, word: segs[0], p: 0,
    travel: (10 + 2.5 * segs.length) * pace(G.night),
    x: LX, y: 14, phase: Math.random() * Math.PI * 2,
    el: label('gh-label boss'),
  };
  setLock(G.boss);
  banner('เปรตมา!');
  hud();
}

function label(cls) {
  const el = document.createElement('span');
  el.className = cls;
  $('#gh-labels').appendChild(el);
  return el;
}

// ---- typing: lock on, chant through, let go with backspace ------------------------
function onInput(e) {
  if (!G || G.over) return;
  const box = $('#gh-typebox');
  let nv = box.value.replace(/\s/g, '').normalize('NFC');
  if (nv !== box.value) box.value = nv;

  if (!e.data) {           // deletion: shrink the chant, maybe release the lock
    G.buf = nv;
    if (!nv && G.lock && G.lock !== G.boss) setLock(null);
    refreshLabels();
    return;
  }
  const anyTarget = G.boss || G.ghosts.length;
  let target = G.lock;
  if (!target) {           // first keystroke picks the nearest matching ghost
    const cands = G.ghosts.filter((g) => g.word.startsWith(nv));
    if (cands.length) target = cands.reduce((a, b) => (a.p > b.p ? a : b));
  }
  if (target && target.word.startsWith(nv)) {
    if (!G.lock) setLock(target);
    G.keys++; G.buf = nv;
    sound.click();
    if (nv === target.word) complete(target);
    else refreshLabels();
  } else {
    box.value = G.buf;     // wrong keys are rejected — the chant must be clean
    if (anyTarget) {
      G.keys++; G.wrong++;
      sound.thud();
      const l = G.lock;
      if (l) l.p = Math.min(0.98, l.p + (l === G.boss ? 0.03 : 0.045));
    }
  }
}

function setLock(g) {
  G.lock = g;
  refreshLabels();
}

function complete(t) {
  const box = $('#gh-typebox');
  box.value = ''; G.buf = '';
  G.chars += t.word.length;
  if (t === G.boss) {
    burst(t.x, t.y, N.goldHi, 10);
    t.i++;
    if (t.i >= t.segs.length) return banishBoss();
    t.word = t.segs[t.i];
    t.p = Math.max(0, t.p - 0.2); // the chant drives it back up into the dark
    sound.word();
    refreshLabels();
    return;
  }
  G.banished++;
  burst(t.x, t.y, N.goldHi, 14);
  if (t.type.glow) burst(t.x, t.y + 4, N.glow, 5);
  t.el.remove();
  G.ghosts = G.ghosts.filter((g) => g !== t);
  setLock(null);
  sound.word();
  hud();
}

function banishBoss() {
  burst(G.boss.x, G.boss.y, N.goldHi, 22);
  burst(G.boss.x, G.boss.y + 8, N.glow, 10);
  G.boss.el.remove();
  G.boss = null; G.lock = null;
  G.banished++;
  endNight(true);
}

function candleOut(byBoss) {
  G.candles--;
  G.shake = 0.5;
  sound.error();
  hud();
  if (G.candles <= 0) return endNight(false);
  if (byBoss) G.boss.p = 0.1; // it recoils from the flame it just took
}

// ---- the loop ----------------------------------------------------------------------
function loop(t) {
  if (!G) return;
  if ($('#view-ghosts').hidden) return quitNight(true); // user navigated away
  raf = requestAnimationFrame(loop);
  const dt = Math.min(0.05, (t - G.lastT) / 1000); // tab-hidden gaps don't teleport ghosts
  G.lastT = t;
  if (!G.over) update(dt, t);
  draw(t);
}

function update(dt, now) {
  // spawning: steady drip while the wave has ghosts left to send
  if (G.phase === 'wave') {
    G.spawnCd -= dt;
    if (G.waveLeft > 0 && G.ghosts.length < G.maxActive && G.spawnCd <= 0) {
      spawnGhost();
      G.spawnCd = 1.1 + Math.random() * 0.9;
    }
    if (G.waveLeft <= 0 && !G.ghosts.length) {
      if (G.wave >= WAVES) startBoss();
      else {
        G.wave++; G.waveLeft = WAVE_SIZE; G.spawnCd = 1.6;
        banner(`ระลอกที่ ${thaiNum(G.wave)}`);
        hud();
      }
    }
  }

  for (const g of [...G.ghosts]) {
    g.p = Math.min(1, g.p + (dt / g.travel) * (G.lock === g ? 0.45 : 1));
    const sway = 10 * (1 - g.p);
    g.x = g.x0 + (LX - g.x0) * g.p + Math.sin(now / 650 + g.phase) * sway;
    g.y = g.y0 + (LY - g.y0) * g.p;
    if (g.p >= 1) { // it got through the chant line
      burst(g.x, g.y, N.red, 8);
      g.el.remove();
      G.ghosts = G.ghosts.filter((o) => o !== g);
      if (G.lock === g) { $('#gh-typebox').value = ''; G.buf = ''; setLock(null); }
      candleOut(false);
    }
    if (g.type.glow && Math.random() < dt * 8) { // Krasue's viscera shed light
      G.parts.push({ x: g.x, y: g.y + 5, vx: 0, vy: 8, ttl: 0.6, life: 0.6, c: N.glow });
    }
  }

  const b = G.boss;
  if (b) {
    b.p = Math.min(1, b.p + dt / b.travel);
    b.x = LX + Math.sin(now / 900 + b.phase) * 40 * (1 - b.p * 0.6);
    b.y = 14 + (LY - 22 - 14) * b.p;
    if (b.p >= 1) { burst(b.x, b.y, N.red, 10); candleOut(true); }
  }

  for (const p of [...G.parts]) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.ttl -= dt;
    if (p.ttl <= 0) G.parts = G.parts.filter((o) => o !== p);
  }
  G.shake = Math.max(0, G.shake - dt);
}

function burst(x, y, c, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, v = 14 + Math.random() * 34;
    G.parts.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 22,
      ttl: 0.4 + Math.random() * 0.5, life: 0.9, c,
    });
  }
}

function draw(t) {
  const { cx, px, spr, rect } = P;
  cx.save();
  if (G.shake > 0 && !still) {
    cx.translate(Math.round((Math.random() * 4 - 2) * G.shake * 2),
      Math.round((Math.random() * 4 - 2) * G.shake * 2));
  }
  cx.drawImage(bg, 0, 0);

  for (let i = 0; i < 5; i++) { // wandering fireflies, stateless from t
    const x = 160 + Math.sin(t / 1700 + i * 2.1) * 140;
    const y = 58 + Math.sin(t / 1300 + i * 1.3) * 36;
    const a = Math.abs(Math.sin(t / 700 + i * 1.7));
    if (a > 0.35) px(x, y, a > 0.75 ? '#ffe58a' : '#8a7d4a');
  }

  for (let i = 0; i < G.candles; i++) { // the flames still burning
    const cxp = [152, 159, 166][i];
    const h = 1 + (((t / 130) | 0) + i * 7) % 3;
    px(cxp, 122 - h + 1, N.flame);
    px(cxp, 122, N.flameHi);
    if (h > 2) px(cxp + (i % 2 ? 1 : -1), 121, N.flame);
  }

  const bob = still ? 0 : Math.round(Math.sin(t / 300) * 2);
  for (const g of G.ghosts) {
    const w = g.type.rows[0].length, h = g.type.rows.length;
    const gx = Math.round(g.x - w / 2), gy = Math.round(g.y - h / 2) + bob;
    // a faint spectral mist behind each ghost — without it they melt into the night
    cx.globalAlpha = 0.14;
    P.disc(g.x, g.y + bob, Math.max(w, h) / 2 + 3, '#9fd3b4');
    cx.globalAlpha = 1;
    if (G.lock === g && ((t / 160) | 0) % 2) auraCorners(px, gx, gy, w, h);
    spr(gx, gy, g.type.rows, g.type.pal);
  }
  const b = G.boss;
  if (b) { // the เปรต towers: drawn at double scale
    const w = PRET[0].length * 2, h = PRET.length * 2;
    const gx = Math.round(b.x - w / 2), gy = Math.round(b.y - h / 2) + bob;
    cx.globalAlpha = 0.12;
    P.disc(b.x, b.y + bob, h / 2 + 4, '#c9a37f');
    cx.globalAlpha = 1;
    if (((t / 160) | 0) % 2) auraCorners(px, gx, gy, w, h);
    for (let j = 0; j < PRET.length; j++) for (let i = 0; i < PRET[j].length; i++) {
      const c = PRET_PAL[PRET[j][i]];
      if (c) rect(gx + i * 2, gy + j * 2, 2, 2, c);
    }
  }

  for (const p of G.parts) {
    cx.globalAlpha = Math.max(0, p.ttl / p.life);
    px(p.x, p.y, p.c);
    cx.globalAlpha = 1;
  }
  cx.restore();
  syncLabels();
}

function auraCorners(px, x, y, w, h) {
  px(x - 2, y - 2, N.goldHi); px(x + w + 1, y - 2, N.goldHi);
  px(x - 2, y + h + 1, N.goldHi); px(x + w + 1, y + h + 1, N.goldHi);
}

// ---- labels: crisp DOM text floating over the pixel canvas ------------------------
// Thai script is unreadable at 320x180, so the words live in a DOM layer above
// the canvas — pixel ghosts below, real Sarabun above.
function syncLabels() {
  for (const g of G.ghosts) {
    g.el.style.left = `${(g.x / W) * 100}%`;
    g.el.style.top = `${((g.y - g.type.rows.length / 2 - 3) / H) * 100}%`;
  }
  const b = G.boss;
  if (b) {
    b.el.style.left = `${(b.x / W) * 100}%`;
    b.el.style.top = `${((b.y - PRET.length - 5) / H) * 100}%`;
  }
}

function refreshLabels() {
  for (const g of G.ghosts) {
    if (G.lock === g) {
      g.el.classList.add('lock');
      g.el.innerHTML = `<b>${G.buf}</b>${g.word.slice(G.buf.length)}`;
    } else {
      g.el.classList.remove('lock');
      g.el.textContent = g.word;
    }
  }
  const b = G.boss;
  if (b) {
    b.el.classList.add('lock');
    b.el.innerHTML = b.segs.map((s, k) =>
      k < b.i ? `<span class="done">${s}</span>`
        : k === b.i ? `<span><b>${G.buf}</b>${s.slice(G.buf.length)}</span>`
          : `<span class="dim">${s}</span>`).join('');
  }
}

function hud() {
  $('#gh-title').textContent = `คืนที่ ${thaiNum(G.night)}`;
  const phase = G.phase === 'boss' ? 'เปรต' : `ระลอกที่ ${thaiNum(G.wave)}/${thaiNum(WAVES)}`;
  $('#gh-hud').textContent = `${phase} · ไล่แล้ว ${thaiNum(G.banished)} ตน · ${'🕯'.repeat(G.candles) || 'มืดสนิท'}`;
}

let bannerTimer = 0;
function banner(text) {
  const el = $('#gh-banner');
  el.textContent = text;
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth; // restart the entrance animation
  el.style.animation = '';
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { el.hidden = true; }, 1700);
}

// ---- night's end -------------------------------------------------------------------
async function endNight(cleared) {
  G.over = true;
  // read everything off G before awaiting — quitNight() can null it under us
  const { night, banished } = G;
  const secs = (performance.now() - G.t0) / 1000;
  const cpm = secs > 0 ? Math.round((G.chars / (secs / 60)) * 10) / 10 : 0;
  const acc = Math.round((G.keys ? 1 - G.wrong / G.keys : 1) * 1000) / 1000;
  const run = {
    game: 'ghosts', night, cleared, cpm, acc,
    chars: G.chars, errors: G.wrong, secs: Math.round(secs * 10) / 10,
    ghosts: banished,
  };

  const prev = deepestNight(await loadRuns());
  await saveRun(run);
  const newDeep = cleared && night > prev;
  if (newDeep) { sound.pb(); confetti(); } else if (cleared) { sound.level(); }

  const card = modal(`
    <h2>คืนที่ ${thaiNum(night)}</h2>
    <div class="modal-cpm">${cleared ? 'รอดถึงเช้า 🌅' : 'เทียนดับหมด…'}</div>
    <div class="modal-sub">
      ไล่ผีได้ ${thaiNum(banished)} ตน · ${Math.round(cpm)} ตัวอักษร/นาที · ความแม่นยำ ${Math.round(acc * 100)}%
      ${newDeep ? '<div class="modal-pb">🏮 คืนที่ลึกที่สุดของคุณ!</div>' : ''}
      ${!cleared ? '<div>พิมพ์ให้ไว อย่าให้ผิด — ผีช้าลงเกือบเท่าตัวตอนถูกเล็ง</div>' : ''}
    </div>
    <div class="play-actions">
      <button class="btn ghost" id="m-back">กลับ</button>
      <button class="btn ${cleared ? '' : 'gold'}" id="m-retry">ล่าอีกครั้ง</button>
      ${cleared ? `<button class="btn gold" id="m-next">คืนที่ ${thaiNum(night + 1)} →</button>` : ''}
    </div>`);
  card.querySelector('#m-retry').onclick = () => { closeModal(); startNight(night); };
  card.querySelector('#m-back').onclick = () => { closeModal(); quitNight(); };
  const next = card.querySelector('#m-next');
  if (next) next.onclick = () => { closeModal(); startNight(night + 1); };
}

function quitNight(silent) {
  cancelAnimationFrame(raf);
  G = null;
  $('#gh-labels').innerHTML = '';
  $('#gh-session').hidden = true;
  $('#gh-setup').hidden = false;
  if (!silent) renderGhosts();
}

// ---- records ----------------------------------------------------------------------
const deepestNight = (runs) => runs.filter((r) => r.game === 'ghosts' && r.cleared)
  .reduce((m, r) => Math.max(m, r.night || 0), 0);

// ---- the setup screen ---------------------------------------------------------------
export async function renderGhosts() {
  const runs = await loadRuns();
  const gr = runs.filter((r) => r.game === 'ghosts');
  const deepest = deepestNight(runs);
  const banished = gr.reduce((s, r) => s + (r.ghosts || 0), 0);
  const best = gr.reduce((m, r) => Math.max(m, r.acc >= 0.9 ? r.cpm || 0 : 0), 0);

  $('#gh-stats').innerHTML = `
    <span>🌙 ลึกสุด <b>${deepest ? `คืนที่ ${deepest}` : '—'}</b></span>
    <span>ไล่ผีแล้ว <b>${thaiNum(banished)}</b> ตน</span>
    <span>เร็วสุด <b>${best ? Math.round(best) : '—'}</b> ตัวอักษร/นาที</span>`;

  const startBtn = $('#gh-start');
  startBtn.textContent = deepest === 0 ? 'ออกล่าคืนแรก 🕯' : `ออกล่าคืนที่ ${thaiNum(deepest + 1)} 🕯`;
  startBtn.onclick = () => startNight(deepest + 1);

  const nights = $('#gh-nights');
  nights.innerHTML = '';
  for (let n = 1; n <= deepest + 1; n++) {
    const chip = document.createElement('button');
    const done = n <= deepest;
    chip.className = 'chip' + (done ? '' : ' sel');
    chip.textContent = done ? `คืนที่ ${thaiNum(n)} ✓` : `คืนที่ ${thaiNum(n)}`;
    chip.onclick = () => startNight(n);
    nights.appendChild(chip);
  }
}

export function initGhosts() {
  P = makePainter($('#gh-canvas'));
  $('#gh-typebox').addEventListener('input', onInput);
  $('#gh-quit').addEventListener('click', () => quitNight());
  $('#gh-wrap').addEventListener('click', () => $('#gh-typebox').focus());
}
