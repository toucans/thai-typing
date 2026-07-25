// Generative Thai ambient music, v4 — a sampled ensemble of short struck and
// plucked sounds playing *heterophonically*, the way Thai ensembles actually
// work: everyone performs the same melody at different densities at once.
// Nothing sustained, nothing synthesized: the space between notes belongs to
// the nature bed, which is real field recordings looped seamlessly.
//
//  - each region has a hand-composed skeletal melody (its "theme"): 16
//    structural notes, two per bar, landing on the ching and chap beats
//  - the khong (marimba) states the skeleton plainly, an octave down
//  - the ranat lead (xylophone or balafon) improvises a division around it —
//    walks, neighbor notes, octave sparks — always arriving on the structural
//    note together with the khong; density grows with the decade
//  - the kanun plucks a pattern, and every third decade it takes the melody
//    itself while the mallets answer; soft thon-rammana drums join late
//
// One track per 10 levels: same theme as its region, realized differently
// (tempo, density, which voices join) — ten regions, ten decades each, so all
// hundred tracks are authored melodies, not dice. Tuning is near-7-TET with a
// per-track bar-tuning table; kro rolls close every phrase.
import { ac, EMBEDDED } from './audio.ts';
import { loadInstruments, strike, makeReverb, makePingPong } from './instruments.ts';
import type { Instruments, Sampler } from './instruments.ts';

// One of the hundred decade tracks (0..99), or the front page's own piece.
type TrackId = number | 'home';

const STEP = 1200 / 7; // cents per 7-TET step
const PENTA = [0, 1, 2, 4, 5]; // the pentatonic degrees within the 7 steps
// per-region nature bed: real field recordings (see manifest credits), each a
// seamless loop, layered where the landscape asks for it. The bed carries the
// track — instruments sit inside it, not on top of it.
type NatureRecipe = [string, number][]; // [sample set, gain]

const NATURE: NatureRecipe[] = [
  [['breeze', 0.30]],                     // เกาะทะเลใต้ — island morning air
  [['stream', 0.24], ['birds2', 0.14]],   // ป่าชายเลน — water through the roots
  [['breeze', 0.30]],                     // ทุ่งนาเขียว
  [['stream', 0.28]],                     // ริมแม่น้ำ
  [['birds', 0.26], ['stream', 0.12]],    // สวนผลไม้
  [['rain', 0.30]],                       // ป่าฝน
  [['falls', 0.28]],                      // น้ำตกในหุบเขา
  [['drips', 0.26]],                      // ถ้ำหินปูน
  [['wind', 0.28]],                       // ดอยหมอก
  [['wind', 0.18], ['birds2', 0.12]],     // ยอดดอยอินทนนท์
];
const HOME_NATURE: NatureRecipe = [['breeze', 0.30]]; // the journey begins on a bright morning

// The ten regional themes. skel = the skeletal melody in pentatonic degrees
// (0 = tonic, 5 = octave), two structural notes per bar for 8 bars; chords =
// one root per bar. zith/drums = the decade (0..9) that voice joins;
// false = never.
// Every voice is a short struck or plucked sound — nothing sustained,
// nothing synthesized; the nature bed carries the space between notes.
interface Theme {
  tempo: [number, number];   // bpm at decade 0 and decade 9
  lead: 'xylo' | 'bala';
  zith: number | false;      // the decade this voice joins; false = never
  drums: number | false;
  chords: number[];          // one root per bar
  skel: number[];            // 16 structural notes, two per bar
}

const THEMES: Theme[] = [
  { // 0 เกาะทะเลใต้ — open water, rising and falling like swell
    tempo: [64, 78], lead: 'xylo', zith: 3, drums: 5,
    chords: [0, 3, 4, 0, 0, 3, 4, 0],
    skel: [5, 7, 8, 7, 9, 8, 7, 5, 7, 8, 9, 10, 8, 7, 6, 5] },
  { // 1 ป่าชายเลน — rocking, narrow, patient as roots in the tide
    tempo: [56, 68], lead: 'bala', zith: 4, drums: 6,
    chords: [0, 2, 3, 0, 0, 2, 4, 0],
    skel: [5, 6, 5, 6, 7, 6, 5, 3, 5, 6, 7, 8, 6, 5, 4, 5] },
  { // 2 ทุ่งนาเขียว — pastoral, stepwise, wide open
    tempo: [68, 82], lead: 'xylo', zith: 3, drums: 4,
    chords: [0, 3, 2, 0, 0, 4, 3, 0],
    skel: [7, 8, 9, 8, 7, 6, 5, 6, 7, 8, 9, 10, 9, 8, 7, 5] },
  { // 3 ริมแม่น้ำ — an arch, out with the current and home again
    tempo: [62, 74], lead: 'xylo', zith: 2, drums: 5,
    chords: [0, 2, 4, 3, 0, 2, 3, 0],
    skel: [5, 7, 9, 10, 9, 8, 7, 6, 5, 6, 8, 7, 6, 6, 7, 5] },
  { // 4 สวนผลไม้ — playful skips, fruit dropping from branches
    tempo: [72, 86], lead: 'xylo', zith: 2, drums: 3,
    chords: [0, 4, 3, 0, 2, 4, 3, 0],
    skel: [7, 9, 7, 9, 10, 8, 9, 7, 8, 10, 8, 6, 7, 9, 6, 5] },
  { // 5 ป่าฝน — low, mysterious, moving under the canopy
    tempo: [54, 66], lead: 'bala', zith: 5, drums: false,
    chords: [0, 2, 0, 3, 4, 2, 3, 0],
    skel: [3, 4, 5, 4, 3, 2, 4, 5, 6, 5, 4, 3, 5, 4, 3, 5] },
  { // 6 น้ำตกในหุบเขา — cascading descents
    tempo: [66, 80], lead: 'xylo', zith: 4, drums: 6,
    chords: [0, 4, 0, 3, 4, 2, 4, 0],
    skel: [10, 9, 8, 7, 10, 9, 8, 5, 9, 8, 7, 6, 8, 7, 6, 5] },
  { // 7 ถ้ำหินปูน — sparse and dark, notes like water in the deep
    tempo: [50, 62], lead: 'bala', zith: false, drums: false,
    chords: [0, 3, 0, 2, 0, 3, 2, 0],
    skel: [5, 3, 4, 3, 5, 4, 3, 2, 3, 4, 5, 6, 4, 3, 2, 0] },
  { // 8 ดอยหมอก — floating, high, slow as drifting cloud
    tempo: [52, 64], lead: 'bala', zith: 5, drums: false,
    chords: [0, 2, 3, 2, 0, 2, 4, 0],
    skel: [8, 9, 8, 7, 8, 9, 10, 8, 7, 8, 9, 8, 7, 6, 7, 5] },
  { // 9 ยอดดอยอินทนนท์ — ascending, triumphant, the whole walk below you
    tempo: [58, 72], lead: 'xylo', zith: 3, drums: 7,
    chords: [0, 3, 4, 0, 3, 4, 2, 0],
    skel: [5, 6, 7, 8, 9, 10, 9, 8, 9, 10, 11, 10, 9, 8, 7, 5] },
];

// A bar of the plan, in one of three shapes: the front page's hand-written
// melody, a realized bar of a region's theme, or the two rests that close a
// section. `home` and `rest` are the discriminants the scheduler switches on.
interface Melody {
  slot: number;
  penta: number;
}

interface HomeBar {
  home: true;
  chordDeg: number;
  melody?: Melody[];
  cadence?: boolean;
  rest?: boolean;
  grace?: boolean;
  sectionStart?: boolean;
}

interface ThemeBar {
  home?: false;
  rest?: false;
  b: number;      // 0..7 within the phrase
  phase: number;  // 0 = plain statement, 1 = the fuller answer
  sectionStart: boolean;
  cadence: boolean;
  grace: boolean;
}

interface RestBar {
  home?: false;
  rest: true;
  sectionStart?: boolean;
}

type Bar = HomeBar | ThemeBar | RestBar;

// The front page's theme — the one piece where the *lead line itself* is
// written out by hand: a kro shimmer opens, a rising phrase answers itself,
// and everything settles back onto the tonic.
const N = (slot: number, penta: number): Melody => ({ slot, penta });
const HOME_BARS: Omit<HomeBar, 'home'>[] = [
  { chordDeg: 0, cadence: true },                                    // kro on the tonic
  { chordDeg: 0, rest: true },
  { chordDeg: 0, melody: [N(0, 5), N(2, 7), N(4, 8), N(6, 7)] },     // theme
  { chordDeg: 3, melody: [N(0, 9), N(3, 8), N(6, 7)] },
  { chordDeg: 4, melody: [N(0, 7), N(2, 8), N(4, 9), N(6, 10)] },
  { chordDeg: 0, melody: [N(0, 10), N(4, 9), N(6, 8)] },
  { chordDeg: 0, melody: [N(0, 5), N(2, 7), N(4, 8), N(6, 7)] },     // theme again…
  { chordDeg: 3, melody: [N(0, 9), N(3, 8), N(6, 10)] },
  { chordDeg: 4, melody: [N(0, 8), N(2, 7), N(4, 6), N(6, 7)] },     // …turned downward
  { chordDeg: 0, cadence: true },
  { chordDeg: 0, melody: [N(0, 10), N(2, 9), N(4, 10), N(6, 12)], grace: true }, // answer, higher
  { chordDeg: 2, melody: [N(0, 11), N(3, 10), N(6, 9)] },
  { chordDeg: 4, melody: [N(0, 9), N(2, 8), N(4, 7), N(6, 8)] },
  { chordDeg: 0, melody: [N(0, 7), N(4, 5)] },
  { chordDeg: 3, melody: [N(0, 8), N(2, 9), N(4, 8), N(6, 7)] },     // gentle descent home
  { chordDeg: 4, melody: [N(0, 6), N(3, 7), N(6, 8)] },
  { chordDeg: 0, cadence: true },
  { chordDeg: 0, rest: true },
  { chordDeg: 0, rest: true },
];

// What the engine is playing right now: the track, its master gain (faded on
// stop), the looping nature sources and the scheduler's timer.
interface Playing {
  trackId: TrackId;
  master: GainNode;
  srcs: AudioScheduledSourceNode[];
  timers: number[];
}

let enabled = localStorage.getItem('tt.music') !== 'off';
let playing: Playing | null = null;
let wanted: TrackId | null = null;

function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- public API ---------------------------------------------------------------
export const music = {
  get enabled(): boolean { return enabled; },
  toggle(): boolean {
    enabled = !enabled;
    localStorage.setItem('tt.music', enabled ? 'on' : 'off');
    if (!enabled) stopEngine();
    else if (wanted !== null) start(wanted);
    return enabled;
  },
  playForLevel(level: number) {
    wanted = Math.floor((level - 1) / 10) % 100;
    if (enabled) start(wanted);
  },
  playForName(name: string) {
    let h = 0;
    for (const c of name) h = (h * 31 + (c.codePointAt(0) ?? 0)) >>> 0;
    wanted = h % 100;
    if (enabled) start(wanted);
  },
  playHome() {
    wanted = 'home';
    if (enabled) start('home');
  },
  stop() { wanted = null; stopEngine(); },
};

function start(trackId: TrackId) {
  if (EMBEDDED) return;   // dashboard preview tile: no music, no resume listeners
  if (playing && playing.trackId === trackId) return; // same decade: play on
  const ctx = ac();
  if (ctx.state === 'suspended') {
    // autoplay policy: the context only runs after a user gesture. Try to
    // resume now (works if we are inside one), and also arm a one-time
    // listener so the front-page theme starts on the first click or key.
    armResume(ctx);
    ctx.resume().then(() => { if (enabled && wanted === trackId) start(trackId); });
    return;
  }
  loadInstruments(ctx).then(
    (inst) => { if (enabled && wanted === trackId) engineStart(ctx, trackId, inst); },
    () => { if (enabled && wanted === trackId) engineStart(ctx, trackId, null); }, // offline: synth fallback
  );
}

let armed = false;
function armResume(ctx: AudioContext) {
  if (armed) return;
  armed = true;
  const kick = () => {
    ctx.resume().then(() => { if (enabled && wanted !== null) start(wanted); });
  };
  window.addEventListener('pointerdown', kick, { once: true });
  window.addEventListener('keydown', kick, { once: true });
}

function stopEngine() {
  if (!playing) return;
  const p = playing;
  playing = null;
  for (const t of p.timers) clearInterval(t);
  const ctx = ac();
  p.master.gain.cancelScheduledValues(ctx.currentTime);
  p.master.gain.setValueAtTime(p.master.gain.value, ctx.currentTime);
  p.master.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.2);
  setTimeout(() => {
    for (const s of p.srcs) { try { s.stop(); } catch { /* already stopped */ } }
    p.master.disconnect();
  }, 1400);
}

// ---- the engine -----------------------------------------------------------------
function engineStart(ctx: AudioContext, trackId: TrackId, inst: Instruments | null) {
  stopEngine();
  const home = trackId === 'home';
  const region = home ? 0 : Math.floor(trackId / 10) % 10;
  const decade = home ? 0 : trackId % 10;
  const theme = THEMES[region];
  if (!theme) return;
  const rng = mulberry32(home ? 9 : trackId * 7919 + 29);

  // density and tempo grow through a region: early decades are sparse and
  // calm, late ones full and lively — ten realizations of one melody
  const dens = home ? 1 : 1 + (decade >= 3 ? 1 : 0) + (decade >= 7 ? 1 : 0);
  const bpmLo = theme.tempo[0], bpmHi = theme.tempo[1];
  const bpm = home ? 63 : bpmLo + ((bpmHi - bpmLo) * decade) / 9 + (rng() - 0.5) * 3;
  const beat = 60 / bpm;
  const slot = beat / 2; // 8th-note grid
  const barDur = beat * 4;
  const rootHz = home ? 233.08 : 220 * Math.pow(2, (rng() * 7) / 12);
  const barTuning = PENTA.map(() => (rng() - 0.5) * (home ? 10 : 16)); // ±8¢, hand-tuned bars

  // which voices sit in tonight's ensemble — all of them short struck or
  // plucked sounds; the space between notes belongs to the nature bed
  const lead: Sampler | null = inst ? (home ? inst.xylo : inst[theme.lead]) : null;
  const hasZith = !!inst && !home && theme.zith !== false && decade >= theme.zith;
  const hasDrums = !!inst && !home && theme.drums !== false && decade >= theme.drums && dens >= 2;
  const useChing = !!inst && (home ? false : dens >= 2);
  // every third decade the kanun carries the theme and the mallets answer —
  // the same melody, told by a different voice
  const zithLed = hasZith && decade % 3 === 2;

  // -- mix chain: per-voice buses into one compressor
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  master.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 2.5);
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -28; comp.knee.value = 20; comp.ratio.value = 2.5;
  comp.attack.value = 0.008; comp.release.value = 0.35;
  comp.connect(master);
  const dry = ctx.createGain();
  dry.connect(comp);
  const revSend = ctx.createGain();
  const preDelay = ctx.createDelay(0.2);
  preDelay.delayTime.value = 0.035;
  const revHp = ctx.createBiquadFilter();
  revHp.type = 'highpass'; revHp.frequency.value = 250;
  const revGain = ctx.createGain();
  revGain.gain.value = 0.55;
  revSend.connect(preDelay).connect(revHp).connect(makeReverb(ctx)).connect(revGain).connect(comp);
  const pp = makePingPong(ctx, beat * 1.5); // dotted 8th
  const dlySend = ctx.createGain();
  const dlyGain = ctx.createGain();
  dlyGain.gain.value = 0.14;
  dlySend.connect(pp.input);
  pp.out.connect(dlyGain).connect(comp);

  // a bus = one voice's level into dry + reverb (wetter for the airy voices);
  // lp darkens a voice that records brighter than its role wants
  function bus(level: number, wet = 1, lp = 0): GainNode {
    const g = ctx.createGain();
    g.gain.value = level;
    let head = g;
    if (lp) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = lp;
      g.connect(f); head = f;
    }
    head.connect(dry);
    const w = ctx.createGain();
    w.gain.value = wet;
    head.connect(w).connect(revSend);
    return g;
  }
  const khongBus = bus(0.8);
  const leadBus = bus(0.88);
  const zithBus = bus(zithLed ? 0.7 : 0.5);
  const percBus = bus(1.0, 0.5);

  const srcs: AudioScheduledSourceNode[] = [];
  natureLayer(ctx, home ? HOME_NATURE : NATURE[region] ?? HOME_NATURE, region, comp, srcs, inst);

  // -- note helpers
  const freqOf = (penta: number) => {
    const oct = Math.floor(penta / 5);
    const deg = ((penta % 5) + 5) % 5;
    return rootHz * Math.pow(2, ((PENTA[deg] ?? 0) * STEP + oct * 1200 + (barTuning[deg] ?? 0)) / 1200);
  };
  const clampP = (p: number) => Math.max(0, Math.min(13, p));

  function ranat(t: number, penta: number, vel: number,
    { double: dbl = true, sends = true }: { double?: boolean; sends?: boolean } = {}) {
    let f = freqOf(penta);
    if (lead && f > lead.maxFreq * 1.25) f /= 2; // keep inside the sampled range
    while (f > 1250) f /= 2; // and keep the top dark — nothing piercing
    const pan = Math.max(-0.25, Math.min(0.25, (penta - 8) * 0.03)) + (rng() - 0.5) * 0.06;
    const dests = sends ? [leadBus, dlySend] : [leadBus];
    const jit = () => (rng() - 0.5) * 0.012;
    const detune = Math.pow(2, ((rng() - 0.5) * 6) / 1200); // mallet-position variance
    if (lead) {
      lead.play(ctx, t + Math.max(0, jit()), f * detune, vel, pan, dests);
      if (dbl) lead.play(ctx, t + Math.max(0, 0.004 + jit()), (f / 2) * detune, vel * 0.72, pan - 0.05, dests);
    } else {
      synthPluck(ctx, t, f * detune, vel, [dry, revSend]);
      if (dbl) synthPluck(ctx, t + 0.005, (f / 2) * detune, vel * 0.7, [dry, revSend]);
    }
  }

  function kro(t: number, penta: number, dur: number) { // tremolo roll, the ranat's signature sustain
    const strikes = Math.floor(dur / 0.066);
    for (let i = 0; i < strikes; i++) {
      const ph = i / strikes;
      const vel = 0.25 + 0.4 * Math.sin(Math.PI * Math.min(1, ph * 1.4)); // swell, then fade
      ranat(t + i * (0.066 + (rng() - 0.5) * 0.008), i % 2 ? penta : penta + 5, vel,
        { double: false, sends: i % 4 === 0 });
    }
  }

  // the khong states a structural note, round and plain
  function khong(t: number, penta: number, vel: number) {
    if (!inst) return;
    let f = freqOf(penta);
    while (f < 92) f *= 2;
    inst.khong.play(ctx, t + Math.max(0, (rng() - 0.5) * 0.008), f, vel, -0.2, [khongBus]);
  }

  function zith(t: number, penta: number, vel: number) {
    if (!hasZith || !inst) return;
    let f = freqOf(penta);
    while (f > inst.zith.maxFreq * 1.06) f /= 2;
    inst.zith.play(ctx, t, f, vel, -0.32, [zithBus]);
  }

  function bass(t: number, chordDeg: number) {
    if (inst) inst.bala.play(ctx, t, freqOf(chordDeg) / 2, 0.22, 0, [dry, revSend]);
    else synthPluck(ctx, t, freqOf(chordDeg) / 2, 0.25, [dry, revSend]);
  }

  function drumHit(kind: 'thom' | 'tek' | 'ting' | 'mute', t: number, gain: number) {
    if (!inst) return;
    const bufs = kind === 'thom' || kind === 'tek' ? inst.thon[kind]
      : inst.ram[kind === 'ting' ? (rng() < 0.5 ? 'ting' : 'ting2') : 'mute'];
    if (!bufs?.length) return;
    const buf = bufs[Math.floor(rng() * bufs.length)];
    strike(ctx, buf, t, gain, [percBus], { rate: 0.96 + rng() * 0.08, pan: kind === 'thom' ? -0.15 : 0.3 });
  }

  // -- heterophonic division: walk between structural notes -----------------------
  function fill(fromP: number, toP: number, slots: number[]) {
    return slots.map((s, i) => {
      const f = (i + 1) / (slots.length + 1);
      let p = Math.round(fromP + (toP - fromP) * f);
      if (rng() < 0.3) p += rng() < 0.5 ? -1 : 1; // neighbor detour
      if (rng() < 0.08) p += 5;                   // octave spark
      return { slot: s, penta: clampP(p), vel: 0.42 + rng() * 0.18 };
    });
  }

  // one bar of lead melody around targets T1 (slot 2) and T2 (slot 6)
  function divide(prev: number, T1: number, T2: number, next: number) {
    const ev: { slot: number; penta: number; vel: number }[] = [];
    if (dens >= 2 && rng() < 0.6) ev.push(...fill(prev, T1, dens >= 3 ? [0, 1] : [0]));
    if (dens >= 3 && rng() < 0.15) { // circle the note, land late — the khong holds it
      ev.push({ slot: 2, penta: clampP(T1 + 1), vel: 0.5 }, { slot: 3, penta: T1, vel: 0.55 });
    } else {
      ev.push({ slot: 2, penta: T1, vel: 0.62 });
      if (dens >= 3 || (dens === 2 && rng() < 0.5)) ev.push(...fill(T1, T2, dens >= 3 ? [3, 4, 5] : [4]));
      else if (dens === 1 && rng() < 0.4) ev.push(...fill(T1, T2, [4]));
    }
    ev.push({ slot: 6, penta: T2, vel: 0.78 }); // the chap: stressed arrival
    if (dens >= 2 && rng() < (dens >= 3 ? 0.7 : 0.45)) ev.push(...fill(T2, next, [7]));
    return ev;
  }

  // -- the plan: A (plain) + A' (fuller) + two rest bars, forever ------------------
  function* barPlan(): Generator<Bar, never, void> {
    let section = 0;
    while (true) {
      if (home) {
        const bars: HomeBar[] = HOME_BARS.map((b) => ({ ...b, home: true }));
        const opening = bars[0];
        if (opening) opening.sectionStart = section > 0;
        yield* bars;
      } else {
        for (let phase = 0; phase < 2; phase++) {
          for (let b = 0; b < 8; b++) {
            yield {
              b, phase,
              sectionStart: b === 0 && phase === 0 && section > 0,
              cadence: b === 7,
              grace: b === 0 && dens >= 2 && rng() < 0.4,
            };
          }
        }
        yield { rest: true }; yield { rest: true };
      }
      section++;
    }
  }

  function playHomeBar(bar: HomeBar, t: number) {
    if (!bar.rest) {
      bass(t, bar.chordDeg);
      khong(t + 6 * slot, bar.chordDeg - 5, 0.45); // soft root under the chap beat
    }
    if (bar.cadence) {
      kro(t, 5, barDur * 1.5);
    } else if (bar.melody) {
      if (bar.grace) {
        const head = bar.melody[0]?.penta ?? 0;
        for (let i = 0; i < 3; i++) {
          ranat(t - (3 - i) * slot * 0.25, head + (3 - i), 0.3, { double: false });
        }
      }
      for (const n of bar.melody) {
        const accent = n.slot === 0 ? 0.8 : n.slot === 4 ? 0.68 : 0.5 + rng() * 0.15;
        ranat(t + n.slot * slot, n.penta, accent);
      }
    }
  }

  const playThemeBar = (bar: ThemeBar, t: number, prevT2: number): number => {
    const T1 = theme.skel[bar.b * 2] ?? 0;
    const T2 = theme.skel[bar.b * 2 + 1] ?? 0;
    const next = theme.skel[(bar.b * 2 + 2) % 16] ?? 0;
    const chordDeg = theme.chords[bar.b] ?? 0;

    bass(t, chordDeg);
    // the skeleton: always there, always calm, an octave below the lead
    khong(t + 2 * slot, T1 - 5, 0.48);
    khong(t + 6 * slot, T2 - 5, 0.58);

    if (bar.cadence) {
      kro(t, T2, barDur * 1.2);
      if (zithLed) zith(t, T2 + 5, 0.6); // the kanun rings out over the roll
    } else if (zithLed) {
      // the kanun tells the division, bright and plucked, an octave up;
      // the mallets step back to quiet punctuation on the structural beats
      for (const n of divide(prevT2, T1, T2, next)) {
        zith(t + n.slot * slot, n.penta + 5, Math.min(0.9, n.vel + 0.12));
      }
      for (const n of divide(prevT2, T1, T2, next)) {
        if (n.slot === 2 || n.slot === 6 || rng() < 0.2) {
          ranat(t + n.slot * slot, n.penta, n.vel * 0.55);
        }
      }
    } else {
      if (bar.grace) {
        for (let i = 0; i < 3; i++) {
          ranat(t - (3 - i) * slot * 0.25, T1 + (3 - i), 0.3, { double: false });
        }
      }
      for (const n of divide(prevT2, T1, T2, next)) {
        ranat(t + n.slot * slot, n.penta, n.vel);
      }
      if (hasZith) { // plucked pattern on chord tones
        const pat: [number, number][] = [[0, chordDeg + 5], [3, chordDeg + 8], [4, chordDeg + 7], [7, chordDeg + 10]];
        for (const [s, p] of pat) {
          if (rng() < 0.8) zith(t + s * slot, p, 0.4 + rng() * 0.15);
        }
      }
    }

    if (hasDrums && bar.phase === 1) { // the thon-rammana joins for the answer
      drumHit('thom', t, 0.07);
      drumHit('ting', t + 4 * slot, 0.05);
      if (rng() < 0.5) drumHit('tek', t + 5 * slot, 0.04);
      drumHit('ting', t + 6 * slot, 0.055);
      if (rng() < 0.3) drumHit('mute', t + 7 * slot, 0.035);
    }
    return T2;
  };

  // -- scheduling
  const plan = barPlan();
  let barStart = ctx.currentTime + 0.4;
  let prevT2 = theme.skel[14] ?? 0; // pretend we arrive from the end of the melody
  const tick = setInterval(() => {
    while (barStart < ctx.currentTime + 1.4) {
      const bar = plan.next().value;
      const t = barStart;
      if (bar.sectionStart && inst) {
        strike(ctx, inst.gong, t, 0.05, [dry, revSend], { rate: 0.92 + rng() * 0.12 });
      }
      if (useChing && inst && !bar.rest) {
        strike(ctx, inst.ching, t + 2 * slot, 0.035, [dry], { rate: 0.98 + rng() * 0.04 });
        strike(ctx, inst.ching, t + 6 * slot, 0.05, [dry], { rate: 0.98 + rng() * 0.04, cut: 0.14 });
      }
      if (bar.home) playHomeBar(bar, t);
      else if (bar.rest) {
        // the forest answers; sometimes the kanun lays a slow broken chord over it
        if (hasZith && rng() < 0.35) {
          for (const [i, p] of [0, 3, 5].entries()) {
            zith(t + i * slot * 1.5, p + 5, 0.3 + rng() * 0.08);
          }
        }
      } else {
        prevT2 = playThemeBar(bar, t, prevT2);
      }
      barStart += barDur;
    }
  }, 200);

  playing = { trackId, master, srcs, timers: [tick] };
}

// fallback voice when the samples can't be fetched (offline cache miss)
function synthPluck(ctx: AudioContext, t: number, freq: number, vel: number, dests: AudioNode[]) {
  const partials: [number, number][] = [[1, vel * 0.12], [2.76, vel * 0.03]];
  for (const [mult, v] of partials) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = freq * mult;
    g.gain.setValueAtTime(v, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(g);
    for (const d of dests) g.connect(d);
    o.start(t); o.stop(t + 1.3);
  }
}

// ---- the nature bed (unchanged voices, sitting under the ensemble) --------------
let noiseBuf: AudioBuffer | null = null;
function noise(ctx: AudioContext): AudioBuffer {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function lfo(ctx: AudioContext, rate: number, depth: number, param: AudioParam,
  srcs: AudioScheduledSourceNode[]) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = rate;
  g.gain.value = depth;
  o.connect(g).connect(param);
  o.start();
  srcs.push(o);
}

function natureLayer(ctx: AudioContext, recipe: NatureRecipe, region: number,
  out: AudioNode, srcs: AudioScheduledSourceNode[], inst: Instruments | null) {
  if (inst && inst.nat) {
    // real field recordings, looped seamlessly (tails crossfaded into heads
    // at build time), layered per region; see the manifest for credits
    for (const [name, gain] of recipe) {
      const buf = inst.nat[name];
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = gain;
      src.connect(g).connect(out);
      lfo(ctx, 0.04 + Math.random() * 0.05, gain * 0.18, g.gain, srcs); // weather drifts
      src.start(0, Math.random() * buf.duration); // each visit begins elsewhere
      srcs.push(src);
    }
    return;
  }
  // offline fallback (samples unreachable): one filtered-noise wash
  const kind = ['waves', 'waves', 'wind', 'stream', 'wind', 'rain', 'stream', 'drips', 'wind', 'wind'][region] ?? 'wind';
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  src.connect(f).connect(g).connect(out);
  if (kind === 'waves' || kind === 'drips') {
    f.type = 'lowpass'; f.frequency.value = kind === 'waves' ? 480 : 260;
    g.gain.value = kind === 'waves' ? 0.2 : 0.04;
    if (kind === 'waves') lfo(ctx, 0.07, 0.15, g.gain, srcs);
  } else {
    const HZ: Record<string, number | undefined> = { rain: 1700, wind: 420, stream: 1500 };
    const LEVEL: Record<string, number | undefined> = { rain: 0.055, wind: 0.14, stream: 0.12 };
    f.type = 'bandpass';
    f.frequency.value = HZ[kind] ?? 420;
    f.Q.value = 0.8;
    g.gain.value = LEVEL[kind] ?? 0.14;
    lfo(ctx, 0.08, g.gain.value * 0.3, g.gain, srcs);
  }
  src.start();
  srcs.push(src);
}
