// Generative Thai ambient music, v2 — real sampled wooden-bar instruments
// (assets/ranat/, CC0 VCSL recordings) played with ranat ek idioms:
//
//  - near-equidistant Thai tuning (7-TET), with a per-track ±8¢ "bar tuning"
//    table like a real hand-tuned instrument
//  - octave doubling with a few ms of flam between the two mallets
//  - kro (กรอ) tremolo rolls on cadence notes
//  - ching-chap timekeeping (real finger cymbals) and a soft gong at sections
//
// What makes it sound composed rather than random: each track (one per 10
// levels, seeded) generates two short motifs and then *repeats* them with
// variation — phrase, answer, cadence, silence — over a curated chord cycle.
// The nature bed (waves/rain/wind/stream/drips by region) carries the rests.
import { ac } from './audio.js';
import { loadInstruments, strike, makeReverb, makePingPong } from './instruments.js';

const STEP = 1200 / 7; // cents per 7-TET step
const PENTA = [0, 1, 2, 4, 5]; // the pentatonic degrees within the 7 steps
const NATURE = ['waves', 'waves', 'wind', 'stream', 'wind', 'rain', 'stream', 'drips', 'wind', 'wind'];
const MELLOW = new Set([1, 5, 7, 8]); // regions voiced on balafon instead of xylophone
// hand-picked one-bar rhythm cells (slots in 8ths) — curation is what keeps
// generated melodies from sounding like dice
const CELLS = [
  [0, 2, 4, 6], [0, 3, 6], [0, 4, 6], [0, 2, 5, 7], [0, 1, 4, 6],
  [0, 2, 4, 5, 6], [4, 6], [0, 2, 4, 6, 7], [0, 3, 4, 7], [0, 6],
];
const PROGRESSIONS = [
  [0, 3, 4, 0], [0, 2, 3, 0], [0, 4, 3, 4], [0, 3, 2, 4], [0, 2, 4, 3],
];

// The front page's own theme — the one piece that is composed by hand, not
// generated: a kro shimmer opens, a rising four-bar phrase answers itself,
// and everything settles back onto the tonic. Same bar format as the engine.
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
  const home = trackId === 'home'; // the front page: fixed, hand-composed
  const rng = mulberry32(home ? 9 : trackId * 7919 + 29);
  const region = home ? 0 : Math.floor(trackId / 10) % 10;
  const rootHz = home ? 233.08 : 220 * Math.pow(2, (rng() * 7) / 12); // tonic A3..E4
  const beat = home ? 60 / 63 : 60 / (58 + Math.floor(rng() * 24));
  const slot = beat / 2; // 8th-note grid
  const barDur = beat * 4;
  const voice = inst ? (!home && MELLOW.has(region) ? inst.bala : inst.xylo) : null;
  const barTuning = PENTA.map(() => (rng() - 0.5) * (home ? 10 : 16)); // ±8¢ per bar, per track
  const progression = PROGRESSIONS[Math.floor(rng() * PROGRESSIONS.length)];
  const useChing = inst && !home && rng() < 0.7;

  // -- mix chain
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

  const srcs = [];
  natureLayer(ctx, region, comp, srcs);

  // -- note helpers
  const freqOf = (penta) => {
    const oct = Math.floor(penta / 5);
    const deg = ((penta % 5) + 5) % 5;
    return rootHz * Math.pow(2, (PENTA[deg] * STEP + oct * 1200 + barTuning[deg]) / 1200);
  };

  function ranat(t, penta, vel, { double: dbl = true, sends = true } = {}) {
    let f = freqOf(penta);
    if (voice && f > voice.maxFreq * 1.25) f /= 2; // keep inside the sampled range
    const pan = Math.max(-0.25, Math.min(0.25, (penta - 8) * 0.03)) + (rng() - 0.5) * 0.06;
    const dests = sends ? [dry, revSend, dlySend] : [dry, revSend];
    const jit = () => (rng() - 0.5) * 0.012;
    const detune = Math.pow(2, ((rng() - 0.5) * 6) / 1200); // mallet-position variance
    if (voice) {
      voice.play(ctx, t + Math.max(0, jit()), f * detune, vel, pan, dests);
      if (dbl) voice.play(ctx, t + Math.max(0, 0.004 + jit()), (f / 2) * detune, vel * 0.72, pan - 0.05, dests);
    } else {
      synthPluck(ctx, t, f * detune, vel, dests);
      if (dbl) synthPluck(ctx, t + 0.005, (f / 2) * detune, vel * 0.7, dests);
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

  function pad(t, chordDeg, dur) {
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

  // -- composition: two motifs, then phrases built from their variations
  function genMotif() {
    const bars = [];
    let penta = [5, 7, 9][Math.floor(rng() * 3)]; // start on a chord tone, octave up
    for (let b = 0; b < 2; b++) {
      const cell = CELLS[Math.floor(rng() * CELLS.length)];
      const bar = [];
      for (const s of cell) {
        penta += [-2, -1, -1, 0, 1, 1, 2][Math.floor(rng() * 7)];
        penta = Math.max(3, Math.min(12, penta));
        bar.push({ slot: s, penta });
      }
      bars.push(bar);
    }
    return bars;
  }

  const vary = (motif) => motif.map((bar) => bar.map((n) => {
    if (rng() < 0.18) return { ...n, penta: Math.max(3, Math.min(12, n.penta + (rng() < 0.5 ? -1 : 1))) };
    if (rng() < 0.1) return { ...n, penta: n.penta + (n.penta < 8 ? 5 : -5) };
    return n;
  }));

  const motifA = genMotif();
  const motifB = genMotif();

  function phrase(first, second) {
    // A A' B cadence — 8 bars; the cadence lands on the tonic with a kro roll
    const bars = [...first, ...vary(first), ...vary(second), null, null].map((m, i) => ({
      chordDeg: progression[i % 4],
      melody: m,
      cadence: i === 6,
      grace: i === 4 && rng() < 0.35,
    }));
    return bars;
  }

  function* barPlan() {
    let section = 0;
    while (true) {
      const bars = home
        ? HOME_BARS.map((b) => ({ ...b }))
        : [
          ...phrase(motifA, motifB),
          ...phrase(motifB, motifA),
          { chordDeg: 0, rest: true }, { chordDeg: 0, rest: true }, // let the forest answer
        ];
      bars[0].sectionStart = section > 0;
      yield* bars;
      section++;
    }
  }

  // -- scheduling
  const plan = barPlan();
  let barStart = ctx.currentTime + 0.4;
  let barIdx = 0;
  const tick = setInterval(() => {
    while (barStart < ctx.currentTime + 1.4) {
      const bar = plan.next().value;
      const t = barStart;
      if (bar.sectionStart && inst) {
        strike(ctx, inst.gong, t, 0.05, [dry, revSend], { rate: 0.92 + rng() * 0.12 });
      }
      if (!bar.rest) bass(t, bar.chordDeg);
      if (barIdx % 2 === 0) pad(t, bar.chordDeg, 2 * barDur + 1.5);
      if (useChing) {
        strike(ctx, inst.ching, t + 2 * slot, 0.035, [dry], { rate: 0.98 + rng() * 0.04 });
        strike(ctx, inst.ching, t + 6 * slot, 0.05, [dry], { rate: 0.98 + rng() * 0.04, cut: 0.14 });
      }
      if (bar.cadence) {
        kro(t, 5, barDur * 1.5);
      } else if (bar.melody) {
        if (bar.grace) { // quick สะบัด run into the phrase
          for (let i = 0; i < 3; i++) {
            ranat(t - (3 - i) * slot * 0.25, bar.melody[0].penta + (3 - i), 0.3, { double: false });
          }
        }
        for (const n of bar.melody) {
          const accent = n.slot === 0 ? 0.8 : n.slot === 4 ? 0.68 : 0.5 + rng() * 0.15;
          ranat(t + n.slot * slot, n.penta, accent);
        }
      }
      barStart += barDur;
      barIdx++;
    }
  }, 200);

  playing = { trackId, master, srcs, timers: [tick] };
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

// ---- the nature bed (same voices as v1, rebalanced under the instruments) -------
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

function natureLayer(ctx, region, out, srcs) {
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
    case 'rain':
      f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.6;
      g.gain.value = 0.10;
      lfo(ctx, 0.05, 0.03, g.gain, srcs);
      break;
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
