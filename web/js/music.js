// Generative Thai ambient music, v3 — a sampled mahori-style ensemble playing
// *heterophonically*, the way Thai ensembles actually work: everyone performs
// the same melody at different densities at once.
//
//  - each region has a hand-composed skeletal melody (its "theme"): 16
//    structural notes, two per bar, landing on the ching and chap beats
//  - the khong (marimba) states the skeleton plainly, an octave down
//  - the ranat lead (xylophone or balafon) improvises a division around it —
//    walks, neighbor notes, octave sparks — always arriving on the structural
//    note together with the khong; density grows with the decade
//  - the khlui (recorder) floats long notes above, sliding into pitch
//  - the jakhe (dan tranh) plucks a pattern; thon-rammana drums join late
//  - in the misty regions a bowed psaltery replaces the synth pad
//
// One track per 10 levels: same theme as its region, realized differently
// (tempo, density, which voices join) — ten regions, ten decades each, so all
// hundred tracks are authored melodies, not dice. Tuning is near-7-TET with a
// per-track bar-tuning table; kro rolls close every phrase.
import { ac } from './audio.js';
import { loadInstruments, strike, makeReverb, makePingPong } from './instruments.js';

const STEP = 1200 / 7; // cents per 7-TET step
const PENTA = [0, 1, 2, 4, 5]; // the pentatonic degrees within the 7 steps
const NATURE = ['waves', 'waves', 'wind', 'stream', 'wind', 'rain', 'stream', 'drips', 'wind', 'wind'];

// The ten regional themes. skel = the skeletal melody in pentatonic degrees
// (0 = tonic, 5 = octave), two structural notes per bar for 8 bars; chords =
// one root per bar. flute/zith/drums = the decade (0..9) that voice joins;
// false = never. saw = bowed sustains instead of the synth pad.
const THEMES = [
  { // 0 เกาะทะเลใต้ — open water, rising and falling like swell
    tempo: [64, 78], lead: 'xylo', flute: 2, zith: 4, drums: 5, saw: false,
    chords: [0, 3, 4, 0, 0, 3, 4, 0],
    skel: [5, 7, 8, 7, 9, 8, 7, 5, 7, 8, 9, 10, 8, 7, 6, 5] },
  { // 1 ป่าชายเลน — rocking, narrow, patient as roots in the tide
    tempo: [56, 68], lead: 'bala', flute: 1, zith: false, drums: 6, saw: false,
    chords: [0, 2, 3, 0, 0, 2, 4, 0],
    skel: [5, 6, 5, 6, 7, 6, 5, 3, 5, 6, 7, 8, 6, 5, 4, 5] },
  { // 2 ทุ่งนาเขียว — pastoral, stepwise, wide open
    tempo: [68, 82], lead: 'xylo', flute: 3, zith: 4, drums: 4, saw: false,
    chords: [0, 3, 2, 0, 0, 4, 3, 0],
    skel: [7, 8, 9, 8, 7, 6, 5, 6, 7, 8, 9, 10, 9, 8, 7, 5] },
  { // 3 ริมแม่น้ำ — an arch, out with the current and home again
    tempo: [62, 74], lead: 'xylo', flute: 2, zith: 3, drums: 5, saw: false,
    chords: [0, 2, 4, 3, 0, 2, 3, 0],
    skel: [5, 7, 9, 10, 9, 8, 7, 6, 5, 6, 8, 7, 6, 6, 7, 5] },
  { // 4 สวนผลไม้ — playful skips, fruit dropping from branches
    tempo: [72, 86], lead: 'xylo', flute: 4, zith: 3, drums: 3, saw: false,
    chords: [0, 4, 3, 0, 2, 4, 3, 0],
    skel: [7, 9, 7, 9, 10, 8, 9, 7, 8, 10, 8, 6, 7, 9, 6, 5] },
  { // 5 ป่าฝน — low, mysterious, moving under the canopy
    tempo: [54, 66], lead: 'bala', flute: 2, zith: false, drums: false, saw: false,
    chords: [0, 2, 0, 3, 4, 2, 3, 0],
    skel: [3, 4, 5, 4, 3, 2, 4, 5, 6, 5, 4, 3, 5, 4, 3, 5] },
  { // 6 น้ำตกในหุบเขา — cascading descents
    tempo: [66, 80], lead: 'xylo', flute: 3, zith: false, drums: 6, saw: false,
    chords: [0, 4, 0, 3, 4, 2, 4, 0],
    skel: [10, 9, 8, 7, 10, 9, 8, 5, 9, 8, 7, 6, 8, 7, 6, 5] },
  { // 7 ถ้ำหินปูน — sparse and dark, notes like water in the deep
    tempo: [50, 62], lead: 'bala', flute: 5, zith: false, drums: false, saw: true,
    chords: [0, 3, 0, 2, 0, 3, 2, 0],
    skel: [5, 3, 4, 3, 5, 4, 3, 2, 3, 4, 5, 6, 4, 3, 2, 0] },
  { // 8 ดอยหมอก — floating, high, slow as drifting cloud
    tempo: [52, 64], lead: 'bala', flute: 1, zith: false, drums: false, saw: true,
    chords: [0, 2, 3, 2, 0, 2, 4, 0],
    skel: [8, 9, 8, 7, 8, 9, 10, 8, 7, 8, 9, 8, 7, 6, 7, 5] },
  { // 9 ยอดดอยอินทนนท์ — ascending, triumphant, the whole walk below you
    tempo: [58, 72], lead: 'xylo', flute: 1, zith: 4, drums: 7, saw: false,
    chords: [0, 3, 4, 0, 3, 4, 2, 0],
    skel: [5, 6, 7, 8, 9, 10, 9, 8, 9, 10, 11, 10, 9, 8, 7, 5] },
];

// The front page's theme — the one piece where the *lead line itself* is
// written out by hand: a kro shimmer opens, a rising phrase answers itself,
// and everything settles back onto the tonic.
const N = (slot, penta) => ({ slot, penta });
const HOME_BARS = [
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

let enabled = localStorage.getItem('tt.music') !== 'off';
let playing = null;
let wanted = null;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- public API ---------------------------------------------------------------
export const music = {
  get enabled() { return enabled; },
  toggle() {
    enabled = !enabled;
    localStorage.setItem('tt.music', enabled ? 'on' : 'off');
    if (!enabled) stopEngine();
    else if (wanted !== null) start(wanted);
    return enabled;
  },
  playForLevel(level) {
    wanted = Math.floor((level - 1) / 10) % 100;
    if (enabled) start(wanted);
  },
  playForName(name) {
    let h = 0;
    for (const c of name) h = (h * 31 + c.codePointAt(0)) >>> 0;
    wanted = h % 100;
    if (enabled) start(wanted);
  },
  playHome() {
    wanted = 'home';
    if (enabled) start('home');
  },
  stop() { wanted = null; stopEngine(); },
};

function start(trackId) {
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
function armResume(ctx) {
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
function engineStart(ctx, trackId, inst) {
  stopEngine();
  const home = trackId === 'home';
  const region = home ? 0 : Math.floor(trackId / 10) % 10;
  const decade = home ? 0 : trackId % 10;
  const theme = THEMES[region];
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

  // which voices sit in tonight's ensemble
  const lead = inst ? (home ? inst.xylo : inst[theme.lead]) : null;
  const hasFlute = inst && !home && theme.flute !== false && decade >= theme.flute;
  const hasZith = inst && !home && theme.zith !== false && decade >= theme.zith && dens >= 2;
  const hasDrums = inst && !home && theme.drums !== false && decade >= theme.drums && dens >= 2;
  const useChing = inst && (home ? false : dens >= 2);
  const useSaw = inst && !home && theme.saw;

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
  function bus(level, wet = 1, lp = 0) {
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
  const leadBus = bus(1.0);
  const fluteBus = bus(0.42, 1.7);
  const zithBus = bus(0.5);
  const sawBus = bus(0.16, 1.8, 900); // the psaltery records sharp: darken and sit it back
  const percBus = bus(1.0, 0.5);

  const srcs = [];
  const natTimers = [];
  natureLayer(ctx, region, comp, srcs, natTimers);

  // -- note helpers
  const freqOf = (penta) => {
    const oct = Math.floor(penta / 5);
    const deg = ((penta % 5) + 5) % 5;
    return rootHz * Math.pow(2, (PENTA[deg] * STEP + oct * 1200 + barTuning[deg]) / 1200);
  };
  const clampP = (p) => Math.max(0, Math.min(13, p));

  function ranat(t, penta, vel, { double: dbl = true, sends = true } = {}) {
    let f = freqOf(penta);
    if (lead && f > lead.maxFreq * 1.25) f /= 2; // keep inside the sampled range
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

  function kro(t, penta, dur) { // tremolo roll, the ranat's signature sustain
    const strikes = Math.floor(dur / 0.066);
    for (let i = 0; i < strikes; i++) {
      const ph = i / strikes;
      const vel = 0.25 + 0.4 * Math.sin(Math.PI * Math.min(1, ph * 1.4)); // swell, then fade
      ranat(t + i * (0.066 + (rng() - 0.5) * 0.008), i % 2 ? penta : penta + 5, vel,
        { double: false, sends: i % 4 === 0 });
    }
  }

  // the khong states a structural note, round and plain
  function khong(t, penta, vel) {
    if (!inst) return;
    let f = freqOf(penta);
    while (f < 92) f *= 2;
    inst.khong.play(ctx, t + Math.max(0, (rng() - 0.5) * 0.008), f, vel, -0.2, [khongBus]);
  }

  function flute(t, penta, dur, vel = 0.5) {
    if (!hasFlute) return;
    let f = freqOf(penta);
    while (f > 680) f /= 2;
    while (f < 170) f *= 2;
    inst.flute.play(ctx, t, f, vel, 0.25, [fluteBus], {
      dur, attack: 0.1, release: 0.4,
      slideFrom: Math.pow(2, -STEP / 1200), slideTime: 0.1, // slide up a bar-step
    });
  }

  function zith(t, penta, vel) {
    if (!hasZith) return;
    let f = freqOf(penta);
    while (f > 740) f /= 2;
    inst.zith.play(ctx, t, f, vel, -0.32, [zithBus]);
  }

  function sawPad(t, chordDeg, dur) {
    if (!useSaw) return;
    for (const p of [chordDeg + 5, chordDeg + 8]) { // root + fifth-ish, mid register
      let f = freqOf(p);
      while (f > 700) f /= 2;
      inst.saw.play(ctx, t + rng() * 0.15, f, 0.3, (rng() - 0.5) * 0.8, [sawBus], {
        dur: dur - 0.4, attack: 0.8, release: 0.9,
      });
    }
  }

  function synthPad(t, chordDeg, dur) {
    for (const cents of [0, 4 * STEP, 1200]) {
      const o = ctx.createOscillator();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = freqOf(chordDeg) * Math.pow(2, cents / 1200) / 2;
      f.type = 'lowpass'; f.frequency.value = 550;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.028, t + 2);
      g.gain.setValueAtTime(0.028, t + dur - 2);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(f).connect(g);
      g.connect(dry);
      g.connect(revSend);
      o.start(t); o.stop(t + dur + 0.1);
    }
  }

  function bass(t, chordDeg) {
    if (inst) inst.bala.play(ctx, t, freqOf(chordDeg) / 2, 0.22, 0, [dry, revSend]);
    else synthPluck(ctx, t, freqOf(chordDeg) / 2, 0.25, [dry, revSend]);
  }

  function drumHit(kind, t, gain) {
    const bufs = kind === 'thom' || kind === 'tek' ? inst.thon[kind]
      : inst.ram[kind === 'ting' ? (rng() < 0.5 ? 'ting' : 'ting2') : 'mute'];
    const buf = bufs[Math.floor(rng() * bufs.length)];
    strike(ctx, buf, t, gain, [percBus], { rate: 0.96 + rng() * 0.08, pan: kind === 'thom' ? -0.15 : 0.3 });
  }

  // -- heterophonic division: walk between structural notes -----------------------
  function fill(fromP, toP, slots) {
    return slots.map((s, i) => {
      const f = (i + 1) / (slots.length + 1);
      let p = Math.round(fromP + (toP - fromP) * f);
      if (rng() < 0.3) p += rng() < 0.5 ? -1 : 1; // neighbor detour
      if (rng() < 0.08) p += 5;                   // octave spark
      return { slot: s, penta: clampP(p), vel: 0.42 + rng() * 0.18 };
    });
  }

  // one bar of lead melody around targets T1 (slot 2) and T2 (slot 6)
  function divide(prev, T1, T2, next) {
    const ev = [];
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
  function* barPlan() {
    let section = 0;
    while (true) {
      if (home) {
        const bars = HOME_BARS.map((b) => ({ ...b, home: true }));
        bars[0].sectionStart = section > 0;
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

  function playHomeBar(bar, t) {
    if (!bar.rest) {
      bass(t, bar.chordDeg);
      khong(t + 6 * slot, bar.chordDeg - 5, 0.45); // soft root under the chap beat
    }
    if (bar.cadence) {
      kro(t, 5, barDur * 1.5);
      if (inst && theme.flute !== false) { // breath over the shimmer
        inst.flute.play(ctx, t, Math.min(660, freqOf(5)), 0.4, 0.25, [fluteBus],
          { dur: barDur * 1.4, attack: 0.5, release: 0.8 });
      }
    } else if (bar.melody) {
      if (bar.grace) {
        for (let i = 0; i < 3; i++) {
          ranat(t - (3 - i) * slot * 0.25, bar.melody[0].penta + (3 - i), 0.3, { double: false });
        }
      }
      for (const n of bar.melody) {
        const accent = n.slot === 0 ? 0.8 : n.slot === 4 ? 0.68 : 0.5 + rng() * 0.15;
        ranat(t + n.slot * slot, n.penta, accent);
      }
    }
  }

  function playThemeBar(bar, t, prevT2) {
    const T1 = theme.skel[bar.b * 2];
    const T2 = theme.skel[bar.b * 2 + 1];
    const next = theme.skel[(bar.b * 2 + 2) % 16];
    const chordDeg = theme.chords[bar.b];

    bass(t, chordDeg);
    // the skeleton: always there, always calm, an octave below the lead
    khong(t + 2 * slot, T1 - 5, 0.48);
    khong(t + 6 * slot, T2 - 5, 0.58);

    if (bar.cadence) {
      kro(t, T2, barDur * 1.2);
      flute(t, T2, barDur * 1.6, 0.45);
    } else {
      if (bar.grace) {
        for (let i = 0; i < 3; i++) {
          ranat(t - (3 - i) * slot * 0.25, T1 + (3 - i), 0.3, { double: false });
        }
      }
      for (const n of divide(prevT2, T1, T2, next)) {
        ranat(t + n.slot * slot, n.penta, n.vel);
      }
      // the khlui sings alternate structural notes, sliding in late
      if (bar.b % 2 === 1 && (bar.phase === 1 || dens >= 2) && rng() < 0.75) {
        flute(t + 6 * slot, T2, barDur * 0.9, 0.42 + rng() * 0.12);
      }
    }

    if (hasZith && !bar.cadence) { // plucked pattern on chord tones
      const pat = [[0, chordDeg + 5], [3, chordDeg + 8], [4, chordDeg + 7], [7, chordDeg + 10]];
      for (const [s, p] of pat) {
        if (rng() < 0.8) zith(t + s * slot, p, 0.4 + rng() * 0.15);
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
  }

  // -- scheduling
  const plan = barPlan();
  let barStart = ctx.currentTime + 0.4;
  let barIdx = 0;
  let prevT2 = theme.skel[14]; // pretend we arrive from the end of the melody
  const tick = setInterval(() => {
    while (barStart < ctx.currentTime + 1.4) {
      const bar = plan.next().value;
      const t = barStart;
      if (bar.sectionStart && inst) {
        strike(ctx, inst.gong, t, 0.05, [dry, revSend], { rate: 0.92 + rng() * 0.12 });
      }
      const chordDeg = bar.home ? (bar.chordDeg || 0) : bar.rest ? 0 : theme.chords[bar.b];
      if (useSaw) {
        // re-bow every bar: the psaltery samples are ~4.5s, a two-bar pad
        // at slow tempi would fall silent halfway through
        if (!bar.rest || rng() < 0.5) sawPad(t, chordDeg, barDur + 0.8);
      } else if (barIdx % 2 === 0) {
        synthPad(t, chordDeg, 2 * barDur + 1.5);
      }
      if (useChing && !bar.rest) {
        strike(ctx, inst.ching, t + 2 * slot, 0.035, [dry], { rate: 0.98 + rng() * 0.04 });
        strike(ctx, inst.ching, t + 6 * slot, 0.05, [dry], { rate: 0.98 + rng() * 0.04, cut: 0.14 });
      }
      if (bar.home) playHomeBar(bar, t);
      else if (bar.rest) {
        if (rng() < 0.4) flute(t, 5, barDur * 1.8, 0.35); // a long breath over the forest
      } else {
        prevT2 = playThemeBar(bar, t, prevT2);
      }
      barStart += barDur;
      barIdx++;
    }
  }, 200);

  playing = { trackId, master, srcs, timers: [tick, ...natTimers] };
}

// fallback voice when the samples can't be fetched (offline cache miss)
function synthPluck(ctx, t, freq, vel, dests) {
  for (const [mult, v] of [[1, vel * 0.12], [2.76, vel * 0.03]]) {
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
let noiseBuf = null;
function noise(ctx) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

function lfo(ctx, rate, depth, param, srcs) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = rate;
  g.gain.value = depth;
  o.connect(g).connect(param);
  o.start();
  srcs.push(o);
}

function natureLayer(ctx, region, out, srcs, timers) {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.loop = true;
  const f = ctx.createBiquadFilter();
  const g = ctx.createGain();
  src.connect(f).connect(g).connect(out);
  switch (NATURE[region]) {
    case 'waves':
      f.type = 'lowpass'; f.frequency.value = 480;
      g.gain.value = 0.20;
      lfo(ctx, 0.07, 0.15, g.gain, srcs);
      break;
    case 'rain': {
      // static bandpass noise reads as hiss, not weather. Rain on a canopy is
      // a darker patter that flutters, plus countless single drops on leaves —
      // little pitched blips, endlessly irregular.
      f.type = 'bandpass'; f.frequency.value = 1700; f.Q.value = 0.5;
      g.gain.value = 0.055;
      lfo(ctx, 0.05, 0.02, g.gain, srcs);
      lfo(ctx, 4.3, 0.018, g.gain, srcs); // the patter
      const drip = () => {
        const t = ctx.currentTime + Math.random() * 0.09;
        const o = ctx.createOscillator();
        const dg = ctx.createGain();
        const p = ctx.createStereoPanner();
        o.frequency.setValueAtTime(1400 + Math.random() * 1800, t);
        o.frequency.exponentialRampToValueAtTime(600 + Math.random() * 500, t + 0.05);
        dg.gain.setValueAtTime(0.006 + Math.random() * 0.02, t);
        dg.gain.exponentialRampToValueAtTime(0.0001, t + 0.04 + Math.random() * 0.07);
        p.pan.value = (Math.random() - 0.5) * 1.4;
        o.connect(dg).connect(p).connect(out);
        o.start(t); o.stop(t + 0.15);
      };
      timers.push(setInterval(() => {
        if (Math.random() < 0.9) drip();
        if (Math.random() < 0.35) drip();
      }, 90));
      break;
    }
    case 'wind':
      f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 1.3;
      g.gain.value = 0.14;
      lfo(ctx, 0.06, 180, f.frequency, srcs);
      lfo(ctx, 0.11, 0.06, g.gain, srcs);
      break;
    case 'stream':
      f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 0.8;
      g.gain.value = 0.12;
      lfo(ctx, 1.1, 0.035, g.gain, srcs);
      break;
    case 'drips':
      f.type = 'lowpass'; f.frequency.value = 260;
      g.gain.value = 0.04;
      break;
  }
  src.start();
  srcs.push(src);
}
