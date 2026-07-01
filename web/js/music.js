// Generative ambient music — synthesized, like the key clicks, so there are no
// audio files to source, license, or store. One "track" per 10 levels: the track
// id seeds root note, tempo, note choices and a nature layer that follows the
// journey region (waves in the isles, rain in the rainforest, drips in the
// caves...). Deterministic per track, so each decade of levels has its own
// recognizable mood, and the track carries over between levels within a decade.
import { ac } from './audio.js';

const PENT_MAJOR = [0, 2, 4, 7, 9];
const PENT_MINOR = [0, 3, 5, 7, 10];
// nature layer per journey region (track 0-9 = region 0, 10-19 = region 1, ...)
const NATURE = ['waves', 'waves', 'wind', 'stream', 'wind', 'rain', 'stream', 'drips', 'wind', 'wind'];

let enabled = localStorage.getItem('tt.music') !== 'off';
let playing = null; // { trackId, out, timers[], srcs[], stop() }
let wanted = null;

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let noiseBuf = null;
function noise(ctx) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}

// reverb from a generated decaying-noise impulse response — no IR asset needed
function reverb(ctx) {
  const len = Math.floor(ctx.sampleRate * 2.2);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  const c = ctx.createConvolver();
  c.buffer = ir;
  return c;
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
      g.gain.value = 0.30;
      lfo(ctx, 0.07, 0.22, g.gain, srcs); // slow swell, like surf
      break;
    case 'rain':
      f.type = 'bandpass'; f.frequency.value = 3200; f.Q.value = 0.6;
      g.gain.value = 0.16;
      lfo(ctx, 0.05, 0.04, g.gain, srcs);
      break;
    case 'wind':
      f.type = 'bandpass'; f.frequency.value = 420; f.Q.value = 1.3;
      g.gain.value = 0.22;
      lfo(ctx, 0.06, 180, f.frequency, srcs); // wandering pitch
      lfo(ctx, 0.11, 0.10, g.gain, srcs);
      break;
    case 'stream':
      f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 0.8;
      g.gain.value = 0.18;
      lfo(ctx, 1.1, 0.05, g.gain, srcs); // burble
      break;
    case 'drips': // cave: near-silent room tone, the drips come from the scheduler
      f.type = 'lowpass'; f.frequency.value = 260;
      g.gain.value = 0.05;
      break;
  }
  src.start();
  srcs.push(src);
}

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

  stop() { wanted = null; stopEngine(); },
};

function stopEngine() {
  if (!playing) return;
  const p = playing;
  playing = null;
  for (const t of p.timers) clearInterval(t);
  const ctx = ac();
  p.out.gain.cancelScheduledValues(ctx.currentTime);
  p.out.gain.setValueAtTime(p.out.gain.value, ctx.currentTime);
  p.out.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
  setTimeout(() => {
    for (const s of p.srcs) { try { s.stop(); } catch { /* already stopped */ } }
    p.out.disconnect();
  }, 900);
}

function start(trackId) {
  if (playing && playing.trackId === trackId) return; // same decade: keep playing
  stopEngine();
  const ctx = ac();
  const rng = mulberry32(trackId * 7919 + 29);
  const region = Math.floor(trackId / 10) % 10;
  const scale = (region === 7 || region === 8) ? PENT_MINOR : PENT_MAJOR; // moodier up high
  const root = 196 * Math.pow(2, Math.floor(rng() * 5) / 12); // G3..B3
  const halfBeat = 60 / (42 + Math.floor(rng() * 22)) / 2;
  const pluckChance = 0.22 + rng() * 0.2;

  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(ctx.destination);
  out.gain.linearRampToValueAtTime(0.13, ctx.currentTime + 2.5);

  const srcs = [];
  const rev = reverb(ctx);
  const revIn = ctx.createGain();
  const revOut = ctx.createGain();
  revOut.gain.value = 0.8;
  revIn.connect(rev).connect(revOut).connect(out);

  natureLayer(ctx, region, out, srcs);

  // low drone on the root, barely there
  const drone = ctx.createOscillator();
  const droneG = ctx.createGain();
  drone.frequency.value = root / 2;
  droneG.gain.value = 0.05;
  lfo(ctx, 0.05, 0.02, droneG.gain, srcs);
  drone.connect(droneG).connect(out);
  drone.start();
  srcs.push(drone);

  function pluck(t, freq, vol, dur) {
    for (const [mult, v] of [[1, vol], [2, vol * 0.3]]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq * mult;
      g.gain.setValueAtTime(v, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g);
      g.connect(out);
      g.connect(revIn);
      o.start(t); o.stop(t + dur + 0.1);
    }
  }

  function pad(t, degrees, dur) {
    for (const deg of degrees) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      o.type = 'triangle';
      o.frequency.value = root * Math.pow(2, deg / 12);
      f.type = 'lowpass'; f.frequency.value = 700;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.045, t + 2.5);
      g.gain.setValueAtTime(0.045, t + dur - 2.5);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(f).connect(g);
      g.connect(out);
      g.connect(revIn);
      o.start(t); o.stop(t + dur + 0.1);
    }
  }

  // lookahead scheduler on a half-beat grid; noteRng is seeded, so each track
  // "plays the same song" every time you visit its decade
  const noteRng = mulberry32(trackId * 104729 + 7);
  let next = ctx.currentTime + 0.2;
  let n = 0;
  const tick = setInterval(() => {
    while (next < ctx.currentTime + 0.8) {
      if (n % 32 === 0) { // chord change every 16 beats
        const base = scale[Math.floor(noteRng() * scale.length)];
        pad(next, [base, base + 7, base + 12 + scale[Math.floor(noteRng() * scale.length)]],
          32 * halfBeat + 2);
      }
      if (noteRng() < pluckChance) {
        const deg = scale[Math.floor(noteRng() * scale.length)] + 12 * (1 + Math.floor(noteRng() * 2));
        pluck(next, root * Math.pow(2, deg / 12), 0.06 + noteRng() * 0.05, 1.6);
      }
      if (NATURE[region] === 'drips' && noteRng() < 0.07) { // cave drips, heavy reverb
        pluck(next + noteRng() * halfBeat, 500 + noteRng() * 500, 0.05, 0.4);
      }
      if (NATURE[region] === 'stream' && noteRng() < 0.1) { // little water bubbles
        pluck(next + noteRng() * halfBeat, 900 + noteRng() * 700, 0.02, 0.15);
      }
      next += halfBeat;
      n++;
    }
  }, 150);

  playing = { trackId, out, srcs, timers: [tick] };
}
