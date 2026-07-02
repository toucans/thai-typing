// Sampled instruments for the music engine. The wavs in assets/ranat/ are real
// VCSL recordings (CC0, see assets/ranat/manifest.json; rebuild with
// tools/build-assets.py). Struck voices have two velocity layers blended
// equal-power so dynamics are continuous; sustained voices (flute, saw) are
// single-layer with a shaped envelope. Pitches between sampled notes come
// from playbackRate.

let loaded = null; // promise, resolved once

export function loadInstruments(ctx) {
  if (loaded) return loaded;
  loaded = (async () => {
    const man = await (await fetch('assets/ranat/manifest.json')).json();
    let notes = man.notes.map((n) => ({ ...n, dir: 'assets/ranat' }));
    // optional local overlay (assets/lexar/, gitignored): higher-quality voices
    // built from the Lexar drive by tools/build-lexar.py. A set present there
    // replaces the committed set of the same name; a fresh clone skips this.
    try {
      const r = await fetch('assets/lexar/manifest.json');
      if (r.ok) {
        const lex = await r.json();
        const replaced = new Set(lex.notes.map((n) => n.set));
        notes = notes.filter((n) => !replaced.has(n.set))
          .concat(lex.notes.map((n) => ({ ...n, dir: 'assets/lexar' })));
      }
    } catch { /* offline or absent: the committed set carries everything */ }
    // sets the engine actually plays; retired voices in the manifests
    // (recorder, psaltery, kaval, duduk) are not fetched
    const WANTED = new Set(['xylo', 'bala', 'zith', 'khong', 'metal', 'thon', 'ram',
      'ching', 'gong', 'rain', 'waves', 'stream', 'falls', 'birds', 'birds2',
      'breeze', 'wind', 'drips']);
    notes = notes.filter((n) => WANTED.has(n.set));
    const buffers = await Promise.all(notes.map(async (n) => ({
      ...n,
      buffer: await ctx.decodeAudioData(await (await fetch(`${n.dir}/${n.file}`)).arrayBuffer()),
    })));
    const byFreq = {};   // pitched sets: freq -> layer -> buffer
    const byVar = {};    // unpitched variant sets (drums): var -> [buffers]
    const single = {};   // one-shot sets (ching, gong)
    for (const n of buffers) {
      if (n.freq) {
        byFreq[n.set] = byFreq[n.set] || {};
        byFreq[n.set][n.freq] = byFreq[n.set][n.freq] || {};
        byFreq[n.set][n.freq][n.layer] = n.buffer;
      } else if (n.var) {
        byVar[n.set] = byVar[n.set] || {};
        (byVar[n.set][n.var] = byVar[n.set][n.var] || []).push(n.buffer);
      } else {
        single[n.set] = n.buffer;
      }
    }
    return {
      xylo: new Sampler(byFreq.xylo),
      bala: new Sampler(byFreq.bala),
      zith: new Sampler(byFreq.zith),
      khong: new Sampler(byFreq.khong),
      metal: byFreq.metal ? new Sampler(byFreq.metal) : null,
      thon: byVar.thon,
      ram: byVar.ram,
      ching: single.ching,
      gong: single.gong,
      nat: single, // the nature collection: waves, stream, falls, birds… by set
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

  // vel 0..1 → equal-power blend of the soft and loud takes (or the single
  // 'solo' layer for sustained voices). opts shape sustained notes:
  //   dur      cut the note to this length with a release tail
  //   attack   fade-in seconds (breath, bow)
  //   release  fade-out seconds when dur is set
  //   slideFrom  start at this pitch ratio and glide to 1 (the khlui's slide)
  play(ctx, t, freq, vel, pan, dests, opts = {}) {
    const note = this.nearest(freq);
    const rate = freq / note.freq;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    for (const d of dests) p.connect(d);
    const layers = note.solo
      ? [[note.solo, 1]]
      : [[note.pp, Math.cos(vel * Math.PI / 2)], [note.ff, Math.sin(vel * Math.PI / 2)]];
    for (const [buffer, g] of layers) {
      if (!buffer || g < 0.01) continue;
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      if (opts.slideFrom) {
        src.playbackRate.setValueAtTime(rate * opts.slideFrom, t);
        src.playbackRate.linearRampToValueAtTime(rate, t + (opts.slideTime || 0.09));
      } else {
        src.playbackRate.value = rate;
      }
      const gain = ctx.createGain();
      const level = g * (0.35 + 0.65 * vel);
      if (opts.attack) {
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(level, t + opts.attack);
      } else {
        gain.gain.value = level;
      }
      if (opts.dur) {
        const rel = opts.release || 0.25;
        gain.gain.setValueAtTime(level, t + opts.dur);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur + rel);
        src.stop(t + opts.dur + rel + 0.05);
      }
      src.connect(gain).connect(p);
      src.start(t);
    }
  }
}

// One-shot for the unpitched buffers (ching, gong, drum strokes). cut > 0
// chokes the ring (the damped "chap"); rate varies the pitch slightly.
export function strike(ctx, buffer, t, gain, dests, { rate = 1, cut = 0, pan = 0 } = {}) {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = rate;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  if (cut) {
    g.gain.setValueAtTime(gain, t + cut * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + cut);
  }
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  src.connect(g).connect(p);
  for (const d of dests) p.connect(d);
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
  return { input, out };
}
