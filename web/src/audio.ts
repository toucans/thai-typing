// All sounds are synthesized with WebAudio — no audio files to source, license,
// or rot. Keystrokes get a mechanical click; milestones get a pentatonic chime.

// Embedded (the dashboard's preview tile iframes this page, same-origin):
// stay silent. A preview must not make sound — audio belongs to the real page.
export const EMBEDDED = window.self !== window.top;

// The context and the two nodes every voice here hangs off. Built on first use
// (an AudioContext made before a user gesture starts suspended), then kept.
interface Rig {
  ctx: AudioContext;
  master: GainNode;
  noiseBuf: AudioBuffer;
}

let rig: Rig | null = null;
let enabled = !EMBEDDED && localStorage.getItem('tt.sound') !== 'off';

function ensure(): Rig {
  if (!rig) {
    const ctx = new AudioContext();
    const master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.1, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    rig = { ctx, master, noiseBuf };
  }
  if (!EMBEDDED && rig.ctx.state === 'suspended') rig.ctx.resume();
  return rig;
}

export function ac(): AudioContext { // shared context; music.ts builds its own graph on it
  return ensure().ctx;
}

function env(gainNode: GainNode, t: number, peak: number, decay: number) {
  gainNode.gain.setValueAtTime(peak, t);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t + decay);
}

function blip(t: number, freq: number, peak: number, decay: number, type: OscillatorType = 'sine') {
  const { ctx, master } = ensure();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type; o.frequency.value = freq;
  env(g, t, peak, decay);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + decay + 0.05);
}

function noise(t: number, freq: number, q: number, peak: number, decay: number) {
  const { ctx, master, noiseBuf } = ensure();
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  env(g, t, peak, decay);
  src.connect(f).connect(g).connect(master);
  src.start(t); src.stop(t + decay + 0.05);
}

export const sound = {
  get enabled(): boolean { return enabled; },
  toggle(): boolean {
    if (EMBEDDED) return false;
    enabled = !enabled;
    localStorage.setItem('tt.sound', enabled ? 'on' : 'off');
    return enabled;
  },
  // mechanical key click: noise snap + tiny thump, slightly randomized
  click() {
    if (!enabled) return;
    const t = ac().currentTime;
    noise(t, 2800 + Math.random() * 900, 1.2, 0.22, 0.03);
    blip(t, 150 + Math.random() * 30, 0.12, 0.04);
  },
  // duller click for a wrong keystroke — audible but not punishing
  thud() {
    if (!enabled) return;
    const t = ac().currentTime;
    noise(t, 700, 1.5, 0.18, 0.05);
    blip(t, 110, 0.14, 0.07, 'triangle');
  },
  // soft high tick when a word lands correctly
  word() {
    if (!enabled) return;
    const t = ac().currentTime;
    blip(t, 1320, 0.08, 0.07);
  },
  // two falling tones for a wrong word
  error() {
    if (!enabled) return;
    const t = ac().currentTime;
    blip(t, 300, 0.15, 0.12, 'triangle');
    blip(t + 0.09, 180, 0.15, 0.16, 'triangle');
  },
  // pentatonic chime for a finished level
  level() {
    if (!enabled) return;
    const t = ac().currentTime;
    [587, 659, 740, 880].forEach((f, i) => {
      blip(t + i * 0.09, f, 0.16, 0.5);
      blip(t + i * 0.09, f * 2, 0.05, 0.4);
    });
  },
  // longer golden run for a personal best
  pb() {
    if (!enabled) return;
    const t = ac().currentTime;
    [587, 740, 880, 1175, 1480, 1760].forEach((f, i) => {
      blip(t + i * 0.11, f, 0.15, 0.7);
      blip(t + i * 0.11, f * 2, 0.04, 0.5);
    });
    blip(t + 0.7, 2349, 0.06, 1.2);
  },
};
