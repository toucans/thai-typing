// Sampled instruments for the music engine. The wavs in assets/ranat/ are real
// VCSL recordings (CC0, see assets/ranat/manifest.json; rebuild with
// tools/build-assets.py). Struck voices have two velocity layers blended
// equal-power so dynamics are continuous; sustained voices (flute, saw) are
// single-layer with a shaped envelope. Pitches between sampled notes come
// from playbackRate.

// One line of a manifest: a wav plus how it is addressed. A pitched note has a
// freq and a velocity layer; a drum has a stroke name (var); ching and gong
// have neither and are one-shots.
export type Layer = 'pp' | 'ff' | 'solo';

interface ManifestNote {
  set: string;
  file: string;
  freq?: number;
  layer?: Layer;
  var?: string;
}

type LayerSet = { [L in Layer]?: AudioBuffer };
type ByFreq = Record<string, LayerSet | undefined>;

export interface Instruments {
  xylo: Sampler;
  bala: Sampler;
  zith: Sampler;
  khong: Sampler;
  thon: Record<string, AudioBuffer[] | undefined>;
  ram: Record<string, AudioBuffer[] | undefined>;
  ching: AudioBuffer | undefined;
  gong: AudioBuffer | undefined;
  nat: Record<string, AudioBuffer | undefined>; // the nature collection, by set
}

let loaded: Promise<Instruments> | null = null; // promise, resolved once

export function loadInstruments(ctx: AudioContext): Promise<Instruments> {
  if (loaded) return loaded;
  loaded = (async () => {
    const man = await (await fetch('assets/ranat/manifest.json')).json();
    let notes: (ManifestNote & { dir: string })[] = man.notes.map((n: ManifestNote) => ({ ...n, dir: 'assets/ranat' }));
    // optional local overlay (assets/lexar/, gitignored): higher-quality voices
    // built from the Lexar drive by tools/build-lexar.py. A set present there
    // replaces the committed set of the same name; a fresh clone skips this.
    try {
      const r = await fetch('assets/lexar/manifest.json');
      if (r.ok) {
        const lex = await r.json();
        const replaced = new Set<string>(lex.notes.map((n: ManifestNote) => n.set));
        notes = notes.filter((n) => !replaced.has(n.set))
          .concat(lex.notes.map((n: ManifestNote) => ({ ...n, dir: 'assets/lexar' })));
      }
    } catch { /* offline or absent: the committed set carries everything */ }
    // sets the engine actually plays; retired voices in the manifests are
    // not fetched
    const WANTED = new Set(['xylo', 'bala', 'zith', 'khong', 'thon', 'ram',
      'ching', 'gong', 'rain', 'stream', 'falls', 'birds', 'birds2',
      'breeze', 'wind', 'drips']);
    notes = notes.filter((n) => WANTED.has(n.set));
    const buffers = await Promise.all(notes.map(async (n) => ({
      ...n,
      buffer: await ctx.decodeAudioData(await (await fetch(`${n.dir}/${n.file}`)).arrayBuffer()),
    })));
    const byFreq: Record<string, ByFreq | undefined> = {}; // pitched sets: freq -> layer -> buffer
    const byVar: Record<string, Record<string, AudioBuffer[] | undefined> | undefined> = {}; // drums: var -> [buffers]
    const single: Record<string, AudioBuffer | undefined> = {}; // one-shot sets (ching, gong)
    for (const n of buffers) {
      if (n.freq) {
        const set = byFreq[n.set] ??= {};
        const layers = set[n.freq] ??= {};
        if (n.layer) layers[n.layer] = n.buffer;
      } else if (n.var) {
        const set = byVar[n.set] ??= {};
        (set[n.var] ??= []).push(n.buffer);
      } else {
        single[n.set] = n.buffer;
      }
    }
    return {
      xylo: new Sampler(byFreq.xylo ?? {}),
      bala: new Sampler(byFreq.bala ?? {}),
      zith: new Sampler(byFreq.zith ?? {}),
      khong: new Sampler(byFreq.khong ?? {}),
      thon: byVar.thon ?? {},
      ram: byVar.ram ?? {},
      ching: single.ching,
      gong: single.gong,
      nat: single, // the nature collection: waves, stream, falls, birds… by set
    };
  })();
  return loaded;
}

// Shape a sustained note: dur cuts it with a release tail, attack fades it in,
// slideFrom starts off-pitch and glides home (the khlui's slide).
export interface PlayOpts {
  dur?: number;
  attack?: number;
  release?: number;
  slideFrom?: number;
  slideTime?: number;
}

type SampledNote = LayerSet & { freq: number };

export class Sampler {
  notes: SampledNote[];
  maxFreq: number;

  constructor(byFreq: ByFreq) {
    this.notes = Object.entries(byFreq)
      .map(([f, layers]) => ({ freq: +f, ...layers }))
      .sort((a, b) => a.freq - b.freq);
    // Infinity, not 0, when a set is missing: callers halve a note until it
    // fits under maxFreq, and a 0 ceiling would never be reached.
    this.maxFreq = this.notes[this.notes.length - 1]?.freq ?? Infinity;
  }

  nearest(freq: number): SampledNote | undefined {
    let best = this.notes[0];
    for (const n of this.notes) {
      if (!best || Math.abs(Math.log(n.freq / freq)) < Math.abs(Math.log(best.freq / freq))) best = n;
    }
    return best;
  }

  // vel 0..1 → equal-power blend of the soft and loud takes (or the single
  // 'solo' layer for sustained voices).
  play(ctx: AudioContext, t: number, freq: number, vel: number, pan: number,
    dests: AudioNode[], opts: PlayOpts = {}): void {
    const note = this.nearest(freq);
    if (!note) return;
    const rate = freq / note.freq;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    for (const d of dests) p.connect(d);
    const layers: [AudioBuffer | undefined, number][] = note.solo
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
// chokes the ring (the damped "chap"); rate varies the pitch slightly. A
// missing buffer (a set absent from the manifest) simply plays nothing.
export function strike(ctx: AudioContext, buffer: AudioBuffer | undefined, t: number,
  gain: number, dests: AudioNode[],
  { rate = 1, cut = 0, pan = 0 }: { rate?: number; cut?: number; pan?: number } = {}): void {
  if (!buffer) return;
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
export function makeReverb(ctx: AudioContext, secs = 2.8): ConvolverNode {
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
export function makePingPong(ctx: AudioContext, time: number, feedback = 0.35): { input: GainNode; out: GainNode } {
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
