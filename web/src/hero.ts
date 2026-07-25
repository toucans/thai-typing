// The hero landscape, drawn as pixel art to match the journey map: one
// procedural scene — dithered sky, sun or moon, drifting clouds, two mountain
// ridges, water — recolored by the region's hue, plus a hand-placed foreground
// silhouette per region (karsts, mangroves, terraces, the twin chedis…).
// Day and night palettes follow the theme. Logical height is fixed; width
// follows the viewport, so nothing is stretched — every pixel stays square.
import { makePainter, mulberry32 } from './pixel.ts';
import type { Painter } from './pixel.ts';

const H = 78;          // logical rows
const WATER = 62;      // the waterline row
// Bound by init(), which every entry point (setHeroRegion, redrawHero via
// `inited`, the ticker) runs through first — nothing here draws before it.
let cv!: HTMLCanvasElement;
let P!: Painter;
let W = 0, scale = 3;
let region = 0, hue = 172;
let frame = 0, inited = false;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

function init(): void {
  if (inited) return;
  const canvas = document.getElementById('hero-art');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  inited = true;
  cv = canvas;
  P = makePainter(cv);
  resize();
  addEventListener('resize', () => { if (resize()) draw(); });
  if (!still) {
    let last = 0;
    (function loop(t) {
      requestAnimationFrame(loop);
      if (document.hidden || !cv.offsetParent || t - last < 300) return;
      last = t;
      frame++;
      draw();
    })(0);
  }
}

function resize(): boolean {
  const cw = cv.parentElement?.clientWidth || innerWidth;
  const s = cw > 700 ? 3 : 2;
  const w = Math.ceil(cw / s);
  if (w === W && s === scale) return false;
  W = w; scale = s;
  cv.width = W; cv.height = H;
  cv.style.height = `${H * s}px`;
  return true;
}

export function setHeroRegion(idx: number, h: number): void {
  init();
  region = idx; hue = h;
  draw();
}

export function redrawHero(): void { if (inited) draw(); }

// ---- palettes -------------------------------------------------------------------
interface Pal {
  dark: boolean;
  sky: [string, string, string, string];
  orb: string;
  glow: string;
  cloud: string;
  m1: string;
  m2: string;
  waterHi: string;
  waterLo: string;
  wave: string;
  fg: string;
  fgSoft: string;
  accent: string;
  gold: string;
}

function pal(): Pal {
  const dark = document.documentElement.dataset.theme === 'dark';
  const h = hue;
  return dark ? {
    dark,
    sky: [`hsl(${h} 30% 18%)`, `hsl(${h} 31% 14%)`, `hsl(${h} 32% 10%)`, `hsl(${h} 33% 7%)`],
    orb: '#e9e2c6', glow: `hsl(${h} 26% 22%)`, cloud: 'rgba(223,230,240,.13)',
    m1: `hsl(${h} 25% 19%)`, m2: `hsl(${h} 28% 11%)`,
    waterHi: `hsl(${h} 30% 22%)`, waterLo: `hsl(${h} 32% 12%)`, wave: `hsl(${h} 35% 38%)`,
    fg: `hsl(${h} 22% 7%)`, fgSoft: `hsl(${h} 22% 13%)`,
    accent: 'rgba(235,243,250,.3)', gold: '#c9a03a',
  } : {
    dark,
    sky: [`hsl(${h} 48% 88%)`, `hsl(${h} 45% 83%)`, `hsl(${h} 43% 77%)`, `hsl(${h} 41% 72%)`],
    orb: '#f2cd5e', glow: `hsl(45 85% 80%)`, cloud: 'rgba(255,255,255,.8)',
    m1: `hsl(${h} 30% 42%)`, m2: `hsl(${h} 34% 27%)`,
    waterHi: `hsl(${h} 45% 72%)`, waterLo: `hsl(${h} 42% 55%)`, wave: `hsl(${h} 42% 88%)`,
    fg: `hsl(${h} 28% 17%)`, fgSoft: `hsl(${h} 26% 27%)`,
    accent: 'rgba(255,255,255,.65)', gold: '#d4a72c',
  };
}

// ---- shared silhouette pieces ---------------------------------------------------
function cloud(x: number, y: number, c: string) {
  const { rect, disc } = P;
  rect(x - 8, y, 17, 3, c);
  disc(x - 4, y - 1, 3, c); disc(x + 2, y - 2, 4, c); disc(x + 7, y, 2, c);
}

function karst(x: number, top: number, c: string) {
  const { rect } = P;
  for (let j = top; j < WATER + 4; j++) {
    const w = 8 + Math.round(3 * Math.sin(j * 0.9 + x));
    rect(x - (w >> 1), j, w, 1, c);
  }
}

function canopyTree(x: number, base: number, s: number, c: string) {
  const { rect, disc } = P;
  disc(x, base - s * 3, s * 2, c);
  disc(x - s * 2, base - s * 2.4, s * 1.4, c);
  disc(x + s * 2, base - s * 2.4, s * 1.4, c);
  rect(x - 1, base - s * 2, 3, s * 2, c);
}

function pine(x: number, base: number, h: number, c: string) {
  const { rect } = P;
  for (let j = 0; j < h; j++) rect(x - Math.round((j / h) * (h / 2.6)), base - h + j, 1 + 2 * Math.round((j / h) * (h / 2.6)), 1, c);
  rect(x, base, 1, 2, c);
}

function chedi(x: number, base: number, h: number, c: string) {
  const { rect } = P;
  for (let j = 0; j < h; j++) {
    const t = j / h;
    let w;
    if (t < 0.08) w = 1;
    else if (t < 0.2) w = 2;
    else if (t < 0.32) w = 3;
    else if (t < 0.75) w = 3 + Math.round((t - 0.32) * 16);
    else w = Math.round(h * 0.48);
    rect(x - (w >> 1), base - h + j, w, 1, c);
  }
}

// ---- the ten foregrounds ----------------------------------------------------------
// Each gets the palette, a seeded rng and the frame; silhouettes stand on the
// waterline. The hero-title sits bottom-left, so the left side stays low.
type Scene = (p: Pal, rng: () => number, f: number) => void;

const SCENES: Scene[] = [
  (p, _rng, f) => { // 0 เกาะทะเลใต้ — karsts out of the sea, a long-tail boat
    const { px, rect } = P;
    karst(W - 22, 18, p.fg); karst(W - 40, 30, p.fg); karst(W - 62, 40, p.fgSoft);
    const bx = Math.round(W * 0.42);
    rect(bx - 7, WATER + 3, 15, 2, p.fg); rect(bx - 5, WATER + 5, 11, 1, p.fg);
    rect(bx - 3, WATER + 1, 7, 1, p.fg); px(bx + 8, WATER + 1, p.fg); px(bx + 9, WATER, p.fg);
    for (let x = 0; x < W; x += 7) if ((x + f) % 14 < 7) px(x + (x % 5), WATER + 8 + (x % 4), p.accent);
  },
  (p, _rng, f) => { // 1 ป่าชายเลน — mangroves wading on stilt roots
    const { px, rect, disc } = P;
    for (const mx of [Math.round(W * 0.14), Math.round(W * 0.82), Math.round(W * 0.93)]) {
      disc(mx, 40, 9, p.fg); disc(mx - 8, 44, 6, p.fg); disc(mx + 8, 44, 6, p.fg);
      rect(mx - 1, 46, 3, 12, p.fg);
      for (const d of [-6, -3, 3, 6]) {
        rect(mx + d, WATER - 2 + Math.abs(d) - 4, 1, 8 - Math.abs(d) + 2, p.fg);
        px(mx + (d > 0 ? d - 1 : d + 1), WATER + 1, p.fg);
      }
    }
    for (let x = 3; x < W; x += 11) if ((x + f * 2) % 22 < 11) px(x, WATER + 6 + (x % 5), p.accent);
  },
  (p) => { // 2 ทุ่งนาเขียว — stepped terraces and a sala
    const { px, rect } = P;
    for (let b = 0; b < 3; b++) {
      const y0 = 46 + b * 6;
      const field = p.dark
        ? `hsl(${hue} 22% ${11 + b * 4}%)` : `hsl(${hue} ${32 - b * 3}% ${34 + b * 7}%)`;
      for (let x = 0; x < W; x++) {
        const y = y0 + Math.round(2 * Math.sin(x / 26 + b));
        rect(x, y, 1, WATER + 6 - y, field);
        if (x % 2 === 0) px(x, y, p.fgSoft);
      }
      for (let x = 6 + b * 5; x < W; x += 14) px(x, y0 + 3 + Math.round(2 * Math.sin(x / 26 + b)), p.fg);
    }
    const sx = Math.round(W * 0.12);
    rect(sx - 6, 40, 13, 2, p.fg); rect(sx - 4, 38, 9, 2, p.fg); px(sx, 36, p.fg);
    rect(sx - 4, 42, 2, 6, p.fg); rect(sx + 3, 42, 2, 6, p.fg);
  },
  (p) => { // 3 ริมแม่น้ำ — a stilt house over the water, reeds
    const { px, rect } = P;
    const hx = Math.round(W * 0.82);
    rect(hx - 10, 38, 21, 2, p.fg); rect(hx - 8, 35, 17, 3, p.fg); rect(hx - 5, 33, 11, 2, p.fg);
    px(hx - 9, 34, p.fg); px(hx + 9, 34, p.fg); // kalae horns
    rect(hx - 8, 40, 17, 8, p.fg);
    rect(hx - 3, 42, 3, 6, p.fgSoft); // doorway
    for (const d of [-7, -2, 3, 7]) rect(hx + d, 48, 1, WATER - 44, p.fg);
    for (const rx of [10, 14, 19, 25, 30]) {
      rect(rx, 44 + (rx % 4), 1, WATER - 40 - (rx % 4), p.fg);
      px(rx, 42 + (rx % 4), p.fgSoft);
    }
  },
  (p) => { // 4 สวนผลไม้ — an orchard heavy with fruit
    const { px, rect } = P;
    for (let x = 0; x < W; x++) rect(x, 54 + Math.round(2 * Math.sin(x / 30)), 1, 10, p.fgSoft);
    [0.55, 0.68, 0.8, 0.92].forEach((t, i) => {
      const x = Math.round(W * t);
      canopyTree(x, 56, 3, p.fg);
      px(x - 3, 46 + i, p.gold); px(x + 2, 44 + (i % 2), p.gold); px(x, 49, p.gold);
    });
    canopyTree(Math.round(W * 0.08), 58, 2, p.fg);
  },
  (p) => { // 5 ป่าฝน — canopy pressing in from above, vines
    const { px, rect, disc } = P;
    for (let x = 0; x < W; x += 6) disc(x, 2 + (x * 7) % 5, 5, p.fg);
    for (const vx of [Math.round(W * 0.2), Math.round(W * 0.45), Math.round(W * 0.72), Math.round(W * 0.9)]) {
      rect(vx, 6, 1, 14 + (vx % 9), p.fg); px(vx, 21 + (vx % 9), p.fgSoft);
    }
    canopyTree(Math.round(W * 0.06), WATER + 2, 4, p.fg);
    canopyTree(Math.round(W * 0.95), WATER + 2, 5, p.fg);
  },
  (p, _rng, f) => { // 6 น้ำตกในหุบเขา — the falls pour off a cliff
    const { px, rect, disc } = P;
    const cx0 = Math.round(W * 0.7);
    for (let x = cx0; x < W; x++) {
      const y = 10 + Math.round(3 * Math.sin(x / 9));
      rect(x, y, 1, WATER + 4 - y, p.fg);
    }
    for (const wx of [cx0 + 8, cx0 + Math.round((W - cx0) * 0.55)]) {
      rect(wx, 12, 4, WATER - 10, p.accent);
      for (let y = 14; y < WATER; y += 4) px(wx + ((y + f) % 4), y, '#ffffff');
      disc(wx + 2, WATER + 2, 3, p.accent);
    }
    for (let x = 4; x < cx0; x += 9) if ((x + f * 2) % 18 < 9) px(x, WATER + 5 + (x % 6), p.accent);
  },
  (p) => { // 7 ถ้ำหินปูน — looking out from inside the cave
    const { px, rect } = P;
    for (let x = 0; x < W; x += 7) {
      const len = 6 + ((x * 13) % 13);
      for (let j = 0; j < len; j++) rect(x - ((len - j) >> 2), j, 1 + ((len - j) >> 1), 1, p.fg);
    }
    rect(0, 0, 5, H, p.fg); rect(W - 5, 0, 5, H, p.fg);
    for (let j = 0; j < 16; j++) { // flowstone columns at the mouth
      rect(6, H - j, 3 + (j >> 1), 1, p.fg);
      rect(W - 9 - (j >> 1), H - j, 3 + (j >> 1), 1, p.fg);
    }
    px(Math.round(W * 0.3), 26, p.accent); px(Math.round(W * 0.62), 20, p.accent);
  },
  (p, _rng, f) => { // 8 ดอยหมอก — ridge upon ridge in the mist
    const { rect } = P;
    const { cx } = P;
    for (let x = 0; x < W; x++) {
      const y = 44 + Math.round(5 * Math.sin(x / 26 + 4));
      rect(x, y, 1, WATER + 6 - y, p.fgSoft);
    }
    pine(Math.round(W * 0.1), 48, 12, p.fg);
    pine(Math.round(W * 0.2), 52, 9, p.fg);
    cx.globalAlpha = 0.3;
    rect(-((f * 2) % 60), 38, W + 60, 3, p.accent);
    rect(((f * 2) % 60) - 60, 52, W + 60, 2, p.accent);
    cx.globalAlpha = 1;
  },
  (p, _rng, f) => { // 9 ยอดดอยอินทนนท์ — the twin chedis above the clouds
    const { rect, disc } = P;
    const { cx } = P;
    for (let x = 0; x < W; x++) {
      const y = 48 + Math.round(4 * Math.sin(x / 30 + 1));
      rect(x, y, 1, WATER + 6 - y, p.fgSoft);
    }
    const c1 = Math.round(W * 0.78), c2 = Math.round(W * 0.9);
    if (p.dark) {
      cx.globalAlpha = 0.2;
      disc(c1, 36, 12, '#ffdf8a'); disc(c2, 42, 9, '#ffdf8a');
      cx.globalAlpha = 1;
    }
    chedi(c1, 48, 26, p.gold);
    chedi(c2, 51, 19, p.gold);
    pine(Math.round(W * 0.08), 52, 11, p.fg);
    cx.globalAlpha = 0.7;
    cloud(Math.round(W * 0.3) + (f % 40 > 20 ? 1 : 0), 55, p.cloud);
    cx.globalAlpha = 1;
  },
];

// ---- the frame ---------------------------------------------------------------------
function draw() {
  if (!W) return;
  const p = pal();
  const { cx, px, rect, disc } = P;
  const rng = mulberry32(region * 131 + 9);

  // sky, four bands with dithered seams
  const bh = Math.ceil(WATER / 4);
  for (let b = 0; b < 4; b++) rect(0, b * bh, W, bh, p.sky[b] ?? p.sky[3]);
  for (let b = 1; b < 4; b++) for (let x = 0; x < W; x += 2) px(x + (b % 2), b * bh, p.sky[b - 1] ?? p.sky[0]);

  if (p.dark) {
    for (let i = 0; i < 30; i++) {
      const x = rng() * W, y = rng() * (WATER - 22);
      if ((frame + i) % 9 < 7) px(x, y, i % 3 ? 'rgba(245,239,219,.8)' : 'rgba(245,239,219,.4)');
    }
  }

  // the sun / the moon
  const ox = W - 42, oy = 15;
  if (!p.dark) disc(ox, oy, frame % 8 < 4 ? 9 : 10, p.glow);
  disc(ox, oy, 6, p.orb);
  if (p.dark) { px(ox - 2, oy - 1, p.sky[1]); px(ox + 1, oy + 2, p.sky[1]); }

  cloud(Math.round(((frame * 0.6 + 30) % (W + 60)) - 30), 9, p.cloud);
  cloud(Math.round(((frame * 0.35 + W * 0.6) % (W + 60)) - 30), 20, p.cloud);

  if (!p.dark) { // a pair of birds
    const bx = Math.round(W * 0.32), by = 14 + (frame % 4 < 2 ? 0 : 1);
    const birds: [number, number][] = [[0, 0], [9, -3]];
    for (const [dx, b2] of birds) {
      px(bx + dx - 2, by + b2, p.fgSoft); px(bx + dx - 1, by + b2 - 1, p.fgSoft);
      px(bx + dx, by + b2, p.fgSoft);
      px(bx + dx + 1, by + b2 - 1, p.fgSoft); px(bx + dx + 2, by + b2, p.fgSoft);
    }
  }

  // two mountain ridges
  for (let x = 0; x < W; x++) {
    const y1 = Math.round(27 + 9 * Math.sin(x / 34 + region) + 4 * Math.sin(x / 11 + region * 2));
    rect(x, y1, 1, WATER - y1, p.m1);
    const y2 = Math.round(42 + 7 * Math.sin(x / 21 + 2 + region) + 3 * Math.sin(x / 7));
    rect(x, y2, 1, WATER - y2, p.m2);
  }

  // water
  rect(0, WATER, W, H - WATER, p.waterLo);
  rect(0, WATER, W, 3, p.waterHi);
  const swell: [number, number][] = [[2, 1], [6, 2], [11, 3]];
  for (const [row, sp] of swell) {
    for (let x = 0; x < W; x++) {
      if ((x + frame * sp + row * 5) % 11 < 3) px(x, WATER + row, p.wave);
    }
  }
  for (let y = WATER + 1; y < H; y += 2) { // the orb's reflection
    if ((y + frame) % 4 < 2) px(ox + ((y * 7) % 3) - 1, y, p.dark ? 'rgba(233,226,198,.4)' : 'rgba(242,205,94,.5)');
  }

  SCENES[region]?.(p, rng, frame);
}
