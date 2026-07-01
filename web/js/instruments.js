// Sampled instruments for the music engine. The wavs in assets/ranat/ are real
// VCSL recordings (CC0, see assets/ranat/manifest.json; rebuild with
// tools/build-assets.py). Two velocity layers per note, blended equal-power so
// dynamics are continuous; pitches between sampled notes come from playbackRate.

let loaded = null; // promise, resolved once

export function loadInstruments(ctx) {
  if (loaded) return loaded;
  loaded = (async () => {
    const man = await (await fetch('assets/ranat/manifest.json')).json();
    const buffers = await Promise.all(man.notes.map(async (n) => ({
      ...n,
      buffer: await ctx.decodeAudioData(await (await fetch(`assets/ranat/${n.file}`)).arrayBuffer()),
    })));
    const sets = {};
    for (const n of buffers) {
      if (n.freq) {
        sets[n.set] = sets[n.set] || {};
        sets[n.set][n.freq] = sets[n.set][n.freq] || {};
        sets[n.set][n.freq][n.layer] = n.buffer;
      } else {
        sets[n.set] = n.buffer; // ching, gong: single buffers
      }
    }
    return {
      xylo: new Sampler(sets.xylo),
      bala: new Sampler(sets.bala),
      ching: sets.ching,
      gong: sets.gong,
    };
  })();
  return loaded;
}

export class Sampler {
  constructor(byFreq) {
    this.notes = Object.entries(byFreq)
      .map(([f, layers]) => ({ freq: +f, ...layers }))
      .sort((a, b) => a.freq - b.freq);
    this.maxFreq = this.notes[this.notes.length - 1].freq;
  }

  nearest(freq) {
    let best = this.notes[0];
    for (const n of this.notes) {
      if (Math.abs(Math.log(n.freq / freq)) < Math.abs(Math.log(best.freq / freq))) best = n;
    }
    return best;
  }

  // vel 0..1 → equal-power blend of the soft and loud takes
  play(ctx, t, freq, vel, pan, dests) {
    const note = this.nearest(freq);
    const rate = freq / note.freq;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    for (const d of dests) p.connect(d);
    const layers = [[note.pp, Math.cos(vel * Math.PI / 2)], [note.ff, Math.sin(vel * Math.PI / 2)]];
    for (const [buffer, g] of layers) {
      if (!buffer || g < 0.01) continue;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      const gain = ctx.createGain();
      gain.gain.value = g * (0.35 + 0.65 * vel);
      src.connect(gain).connect(p);
      src.start(t);
    }
  }
}

// One-shot for the unpitched buffers (ching, gong). cut > 0 chokes the ring
// (the damped "chap" stroke); rate varies the pitch slightly.
export function strike(ctx, buffer, t, gain, dests, { rate = 1, cut = 0 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  if (cut) {
    g.gain.setValueAtTime(gain, t + cut * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + cut);
  }
  src.connect(g);
  for (const d of dests) g.connect(d);
  src.start(t);
  if (cut) src.stop(t + cut + 0.05);
}

// Reverb from a generated stereo decaying-noise impulse response.
export function makeReverb(ctx, secs = 2.8) {
  const len = Math.floor(ctx.sampleRate * secs);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  const conv = ctx.createConvolver();
  conv.buffer = ir;
  return conv;
}

// Classic ping-pong: two cross-fed delays panned hard left/right.
export function makePingPong(ctx, time, feedback = 0.35) {
  const input = ctx.createGain();
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 400;
  const dl = ctx.createDelay(2);
  const dr = ctx.createDelay(2);
  dl.delayTime.value = time;
  dr.delayTime.value = time;
  const fbl = ctx.createGain();
  const fbr = ctx.createGain();
  fbl.gain.value = feedback;
  fbr.gain.value = feedback;
  const pl = ctx.createStereoPanner();
  const pr = ctx.createStereoPanner();
  pl.pan.value = -0.7;
  pr.pan.value = 0.7;
  const out = ctx.createGain();
  input.connect(hp).connect(dl);
  dl.connect(pl).connect(out);
  dl.connect(fbl).connect(dr);
  dr.connect(pr).connect(out);
  dr.connect(fbr).connect(dl);
  return { input, out };
}
