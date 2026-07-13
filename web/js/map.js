// The journey map: one pixel-art overworld per region, drawn entirely in code
// (string-art sprites + seeded scatter — no image assets). A serpentine stone
// path carries the region's 100 levels; the traveler stands on the next level;
// shrines along the way hold the region's มงคลชีวิต stanza (data/mongkhon.js),
// lit gold once their level is passed. Click a stone to play, a shrine to read.
//
// The canvas is a fixed 320x180 logical grid upscaled by CSS with
// image-rendering: pixelated; a slow ticker (~4 fps) animates water, flames
// and the traveler's bob, and is skipped entirely under prefers-reduced-motion.
import { REGION_SIZE, modal, closeModal } from './ui.js';
import { STANZAS, BY_LEVEL, thaiNum, unlockedCount } from './data/mongkhon.js';
import { makePainter, mulberry32 } from './pixel.js';

const W = 320, H = 180, COLS = 20, ROWS = 5;

let cv, cx, px, rect, disc, spr; // painter, bound in initMap
let tip, onPlay;
let st = null;        // { region, next, starsByLevel, maxDone }
let frame = 0;
let nodesPts = [];    // node positions for the drawn region
let shrinePts = [];   // { x, y, b, open } for the drawn region
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

let rng = mulberry32(1);
function speckle(x, y, w, h, c, n) {
  for (let i = 0; i < n; i++) px(x + rng() * w, y + rng() * h, c);
}
// 3x5 digit font for the level numbers in the margins
const DIG = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111',
  4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001010010',
  8: '111101111101111', 9: '111101111001111',
};
function num(x, y, n, c) {
  for (const d of String(n)) {
    const bits = DIG[d];
    for (let j = 0; j < 5; j++) for (let i = 0; i < 3; i++)
      if (bits[j * 3 + i] === '1') px(x + i, y + j, c);
    x += 4;
  }
}

// ---- palette + sprites ---------------------------------------------------------
const C = {
  leaf1: '#2d6a4f', leaf2: '#40916c', leaf3: '#79c393',
  trunk: '#7a5230', trunkL: '#9a6b3f',
  gold: '#d4a72c', goldD: '#b8860b', goldHi: '#f0cc5e',
  roof: '#b0402f', roofL: '#cd5a44',
  cream: '#f3ead0', ink: '#3a352c',
  water1: '#8ecdd2', water2: '#5aa9b0', foam: '#eef8f2',
  stone: '#9a917f', stoneD: '#736b5b',
  skin: '#e8b88a', indigo: '#3f5b8f', pants: '#4a3b2f',
};

const TRAVELER = ['..hhh..', '.hhhhh.', 'hhhhhhh', '..fff..', '..fff..', '.iiiib.',
  '.iiiib.', '..iii..', '..p.p..', '..p.p..', '.s...s.'];
const TRAVELER_PAL = { h: C.gold, f: C.skin, i: C.indigo, b: C.trunk, p: C.pants, s: C.ink };

const SHRINE = ['....g....', '...ggg...', '..rrrrr..', '.rrrrrrr.', 'rrrrrrrrr',
  '.ccccccc.', '.c.....c.', '.c.ggg.c.', '.c.ggg.c.', '..t...t..', '..t...t..'];
const SHRINE_OPEN = { g: C.gold, r: C.roof, c: C.cream, t: C.trunk };
const SHRINE_SHUT = { g: '#a09884', r: '#8b8371', c: '#b8b09c', t: '#7d7566' };

const CHEDI = ['......g......', '......g......', '.....ggg.....', '....ggggg....',
  '......y......', '.....yyy.....', '....yyyyy....', '...yyyyyyy...', '...yyyyyyy...',
  '..yyyyyyyyy..', '..yyyyyyyyy..', '..yyyyyyyyy..', '.ddddddddddd.', '..wwwwwwwww..',
  '.wwwwwwwwwww.', 'wwwwwwwwwwwww'];
const CHEDI_PAL = { g: C.goldHi, y: C.gold, d: C.goldD, w: C.cream };
const CHEDI_SHUT = { g: '#a8a08c', y: '#98907c', d: '#847c68', w: '#b8b09c' };
const CHEDI_SMALL = ['...g...', '...y...', '..yyy..', '..yyy..', '.yyyyy.', '.yyyyy.',
  '.ddddd.', '..www..', '.wwwww.'];

const TREE = ['..elLle..', '.eLllLLe.', 'eLlllLlLe', 'eLLlllLle', '.eLlLLle.',
  '..elLle..', '....t....', '....t....', '....t....'];
const TREE_PAL = { l: C.leaf2, L: C.leaf1, e: C.leaf1, t: C.trunk };
const FRUIT_PAL = (fruit) => ({ l: C.leaf2, L: C.leaf1, e: C.leaf1, t: C.trunk, o: fruit });

const PINE = ['...p...', '..ppp..', '..ppp..', '.ppppp.', '.ppppp.', 'ppppppp', '...t...', '...t...'];
const PINE_PAL = { p: C.leaf1, t: C.trunk };

const PALM = ['.ll.l.ll.', 'lllllllll', 'l.llTll.l', '...oTo...', '....T....',
  '....T....', '...T.....', '..T......'];
const PALM_PAL = { l: C.leaf2, T: C.trunkL, o: C.trunk };

const MANGROVE = ['..lllllll..', '.lllllllll.', 'l.lllllll.l', '.....t.....',
  '.....t.....', '....t.t....', '...t...t...', '..t.....t..'];
const MANGROVE_PAL = { l: C.leaf2, t: C.trunkL };

const SALA = ['.....gg.....', '....rrrr....', '..rrrrrrrr..', '.rrrrrrrrrr.',
  'rrrrrrrrrrrr', '..c......c..', '..c......c..', '..c......c..', '.tttttttttt.'];
const SALA_PAL = { g: C.gold, r: C.roof, c: C.trunkL, t: C.trunk };

const HOUSE = ['....rrrrr....', '...rrrrrrr...', '..rrrrrrrrr..', '.rrrrrrrrrrr.',
  '.wwwwwwwwwww.', '.ww.wwww.ww..', '.wwwwwwwwwww.', '..t..t...t...', '..t..t...t...'];
const HOUSE_PAL = { r: C.roof, w: C.trunkL, t: C.trunk };

const BOAT = ['...cccc...f.', 'b..........b', 'bbbbbbbbbbbb', '.bbbbbbbbbb.'];
const BOAT_PAL = { b: C.trunk, c: C.cream, f: C.roofL };

const MUSHROOM = ['.rrr.', 'rrrrr', '..c..', '..c..'];
const MUSHROOM_PAL = { r: C.roofL, c: C.cream };

// ---- the ten region scenes ------------------------------------------------------
// Each scene owns the top band (y 2..28), the bottom strip (y 152..178) and the
// side margins; the path rows and shrine zones stay clear. `f` is the frame
// counter for the little animations.
function sparkle(x, y, f) { if ((f + x) % 4 < 2) px(x, y, C.foam); }

function karst(x, y, h) {
  for (let j = 0; j < h; j++) {
    const w = 6 + Math.round(2 * Math.sin(j * 1.3 + x));
    rect(x - (w >> 1), y + j, w, 1, j < 2 ? C.leaf2 : C.stone);
    if (j >= 2) px(x - (w >> 1) + 1, y + j, '#b3aa96'); // lit western face
  }
  px(x - 1, y + 2, C.leaf1); px(x + 2, y + 3, C.leaf1);  // clinging shrubs
  rect(x - 3, y + h - 1, 7, 1, C.stoneD);
}

const SCENES = [
  { // 0 เกาะทะเลใต้ — sand, sea band, karsts, a long-tail boat, palms
    g: ['#ecdfae', '#e2d193', '#f4ecc4'],
    path: ['#d3c395', '#a8956a'],
    scene(f) {
      rect(0, 0, W, 24, C.water1);
      rect(0, 22, W, 2, C.water2);
      for (let x = 4; x < W; x += 9) { px(x, 3 + ((x * 7) % 17), C.foam); sparkle(x + 4, 8 + ((x * 3) % 11), f); }
      rect(0, 24, W, 3, '#f4ecc4');
      for (let x = 0; x < W; x += 5) px(x, 24, C.foam); // surf line
      karst(56, 4, 16); karst(212, 7, 13); karst(240, 10, 10);
      spr(130, 12, BOAT, BOAT_PAL);
      spr(12, 156, PALM, PALM_PAL); spr(290, 158, PALM, PALM_PAL); spr(150, 160, PALM, PALM_PAL);
      speckle(30, 165, 260, 10, '#fdf7e0', 14); // shells
    },
  },
  { // 1 ป่าชายเลน — mud, tidal channels, mangroves on stilt roots
    g: ['#c9cb96', '#bcbf87', '#d6d8a8'],
    path: ['#d0c294', '#a3915f'],
    scene(f) {
      rect(0, 2, W, 16, C.water2);
      for (let x = 6; x < W; x += 11) sparkle(x, 9, f);
      rect(0, 16, W, 2, '#8fa08a');
      spr(30, 4, MANGROVE, MANGROVE_PAL); spr(130, 6, MANGROVE, MANGROVE_PAL);
      spr(232, 3, MANGROVE, MANGROVE_PAL); spr(283, 7, MANGROVE, MANGROVE_PAL);
      rect(0, 160, W, 8, C.water2);
      for (let x = 10; x < W; x += 14) sparkle(x, 163, f + 2);
      spr(60, 152, MANGROVE, MANGROVE_PAL); spr(200, 153, MANGROVE, MANGROVE_PAL);
      px(105, 172, C.roofL); px(107, 172, C.roofL); px(106, 171, C.roofL); // a crab
    },
  },
  { // 2 ทุ่งนาเขียว — terraced paddies, seedlings, a sala
    g: ['#cde3a8', '#bfda94', '#dbeebb'],
    path: ['#d8c79b', '#a8925f'],
    scene(f) {
      for (let b = 0; b < 3; b++) {
        rect(0, 2 + b * 8, W, 6, b % 2 ? '#a8d4b6' : '#b4dc9e');
        rect(0, 7 + b * 8, W, 1, '#86a06c');
        for (let x = 8 + b * 4; x < W; x += 12) {
          px(x, 4 + b * 8, C.leaf1); px(x - 1, 3 + b * 8, C.leaf2); px(x + 1, 3 + b * 8, C.leaf2);
        }
      }
      for (let x = 14; x < W; x += 23) sparkle(x, 5, f);
      spr(268, 6, SALA, SALA_PAL);
      rect(0, 162, W, 5, '#a8d4b6');
      for (let x = 10; x < W; x += 10) { px(x, 160, C.leaf1); px(x - 1, 159, C.leaf2); px(x + 1, 159, C.leaf2); }
    },
  },
  { // 3 ริมแม่น้ำ — the river, a stilt house, reeds
    g: ['#cfe3b0', '#c0d99c', '#deeec3'],
    path: ['#d8c79b', '#a8925f'],
    scene(f) {
      rect(0, 2, W, 18, C.water1);
      rect(0, 18, W, 2, C.water2);
      for (let x = 5; x < W; x += 8) sparkle(x, 6 + (x % 4) * 3, f);
      spr(120, 3, HOUSE, HOUSE_PAL);
      for (const rx of [20, 24, 60, 250, 256, 300]) {
        rect(rx, 12, 1, 9, C.leaf1); px(rx, 11, C.leaf2);
      }
      rect(0, 164, W, 6, C.water1);
      for (let x = 8; x < W; x += 12) sparkle(x, 166, f + 1);
      for (const rx of [40, 44, 160, 164, 280]) { rect(rx, 156, 1, 8, C.leaf1); px(rx, 155, C.leaf2); }
    },
  },
  { // 4 สวนผลไม้ — orchard rows heavy with fruit, a banana palm
    g: ['#d9e8ab', '#cce097', '#e6f2c0'],
    path: ['#d8c79b', '#a8925f'],
    scene() {
      const fruits = ['#e88f2a', '#e8c62a', '#d8542e', '#e88f2a'];
      [30, 105, 180, 255].forEach((x, i) => {
        const pal = FRUIT_PAL(fruits[i]);
        spr(x, 6, TREE, pal);
        px(x + 2, 8, fruits[i]); px(x + 6, 9, fruits[i]); px(x + 4, 11, fruits[i]); px(x + 7, 7, fruits[i]);
      });
      spr(60, 156, PALM, PALM_PAL); spr(220, 158, PALM, PALM_PAL);
      speckle(20, 166, 280, 8, '#e88f2a', 6); // windfall fruit
    },
  },
  { // 5 ป่าฝน — dense canopy, hanging vines, mushrooms
    g: ['#aacb90', '#9cbf80', '#bcd8a4'],
    path: ['#c8b78c', '#95835a'],
    scene() {
      rect(0, 0, W, 10, C.leaf1);
      for (let x = 0; x < W; x += 7) disc(x + 3, 9 + (x % 3), 4, x % 14 ? C.leaf2 : C.leaf1);
      for (const vx of [24, 88, 150, 210, 268]) {
        rect(vx, 12, 1, 10 + (vx % 7), C.leaf1); px(vx, 22 + (vx % 7), C.leaf3);
      }
      spr(6, 154, TREE, TREE_PAL); spr(296, 152, TREE, TREE_PAL); spr(160, 156, TREE, TREE_PAL);
      spr(90, 168, MUSHROOM, MUSHROOM_PAL); spr(240, 169, MUSHROOM, MUSHROOM_PAL);
    },
  },
  { // 6 น้ำตกในหุบเขา — cliff and falls on the left, the top right stays
    // clear for the stanza's first shrine (level 20 sits in the top row)
    g: ['#bcc8a6', '#aebc95', '#cbd6b8'],
    path: ['#c2b493', '#8f8261'],
    scene(f) {
      rect(0, 0, 130, 24, C.stone);
      rect(0, 22, 130, 2, C.stoneD);
      speckle(0, 0, 130, 22, C.stoneD, 30);
      for (const wx of [30, 74]) {
        rect(wx, 1, 8, 23, C.water1);
        rect(wx + 2, 1, 4, 23, '#dceef2');
        for (let y = 2; y < 24; y += 3) px(wx + 1 + ((y + f) % 6), y, C.foam);
        rect(wx - 2, 23, 12, 2, C.foam); // spray at the plunge
      }
      rect(20, 24, 70, 4, C.water1);
      for (let x = 24; x < 88; x += 5) sparkle(x, 25 + (x % 3), f);
      for (let x = 136; x < W; x++) { // far ridge across the valley
        const y = 12 + Math.round(3 * Math.sin(x / 11));
        rect(x, y, 1, 26 - y, '#a4b18e');
      }
      disc(40, 168, 3, C.stone); disc(200, 170, 2, C.stone); disc(280, 167, 3, C.stone);
    },
  },
  { // 7 ถ้ำหินปูน — a dark ceiling of stalactites, crystals in the gloom
    g: ['#a39a86', '#958c78', '#b1a894'],
    path: ['#8f8261', '#6e6248'],
    scene(f) {
      rect(0, 0, W, 5, '#4d463a');
      for (let x = 4; x < W; x += 13) {
        const len = 4 + ((x * 7) % 9);
        for (let j = 0; j < len; j++) rect(x - ((len - j) >> 2), 5 + j, 1 + ((len - j) >> 1), 1, '#5d5546');
      }
      for (const [cx2, cy] of [[50, 165], [180, 170], [265, 163]]) {
        px(cx2, cy, '#8fd8d2'); px(cx2 + 1, cy - 1, '#bdeee9'); px(cx2 - 1, cy - 1, '#8fd8d2'); px(cx2, cy - 2, '#bdeee9');
      }
      if (f % 4 < 2) { px(120, 168, '#c9e88a'); px(230, 172, '#c9e88a'); } // glow-worms
    },
  },
  { // 8 ดอยหมอก — ridge lines, lone pines, drifting mist
    g: ['#c6d2b8', '#b8c6a8', '#d4dfc8'],
    path: ['#c2b493', '#8f8261'],
    scene(f) {
      for (let x = 0; x < W; x++) {
        const y1 = 10 + Math.round(4 * Math.sin(x / 22));
        rect(x, y1, 1, 26 - y1, '#96a888');
        const y2 = 18 + Math.round(3 * Math.sin(x / 14 + 2));
        rect(x, y2, 1, 26 - y2, '#7e937a');
      }
      spr(40, 8, PINE, PINE_PAL); spr(150, 12, PINE, PINE_PAL); spr(262, 9, PINE, PINE_PAL);
      cx.globalAlpha = 0.3;
      rect(-((f * 2) % 40), 46, W + 40, 4, C.cream);
      rect(((f * 2) % 40) - 40, 102, W + 40, 3, C.cream);
      cx.globalAlpha = 1;
      spr(90, 154, PINE, PINE_PAL); spr(230, 156, PINE, PINE_PAL);
    },
  },
  { // 9 ยอดดอยอินทนนท์ — above the clouds; the twin chedis wait at the top
    g: ['#ccd2be', '#bfc6ae', '#d9dece'],
    path: ['#c8bb98', '#948767'],
    scene(f) {
      rect(0, 0, W, 26, '#cfdce4');
      disc(36, 8, 5, C.goldHi);
      cx.globalAlpha = 0.75;
      for (const [mx, my, mr] of [[90, 22, 6], [130, 24, 8], [210, 21, 7], [270, 24, 6], [170, 25, 5]]) {
        disc(mx, my, mr, '#f2f0e6'); disc(mx + mr, my + 1, mr - 2, '#f2f0e6');
      }
      cx.globalAlpha = 1;
      spr(146, 4, CHEDI, CHEDI_PAL);
      spr(166, 11, CHEDI_SMALL, CHEDI_PAL);
      if (f % 4 < 2) px(152, 3, C.goldHi);
      spr(20, 156, PINE, PINE_PAL); spr(290, 154, PINE, PINE_PAL);
      speckle(40, 160, 240, 12, '#e6b8c8', 10); // summit rhododendrons
    },
  },
];

// ---- layout ---------------------------------------------------------------------
function layoutNodes(region) {
  const pts = [];
  for (let i = 0; i < REGION_SIZE; i++) {
    const row = Math.floor(i / COLS);
    let col = i % COLS;
    if (row % 2) col = COLS - 1 - col;
    pts.push({
      x: Math.round(25 + col * (270 / 19)),
      y: 34 + row * 28 + Math.round(2 * Math.sin(i * 0.9 + region * 3)),
    });
  }
  return pts;
}

function layoutShrines(region, maxDone) {
  const out = [];
  for (const [level, b] of BY_LEVEL) {
    if (b.region !== region) continue;
    const p = nodesPts[level - region * REGION_SIZE - 1];
    out.push({ x: p.x, y: p.y, b, open: level <= maxDone });
  }
  return out;
}

// ---- drawing ---------------------------------------------------------------------
function brushLine(x1, y1, x2, y2, r, c) {
  const steps = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
  for (let s = 0; s <= steps; s++) {
    disc(Math.round(x1 + ((x2 - x1) * s) / steps), Math.round(y1 + ((y2 - y1) * s) / steps), r, c);
  }
}

function draw() {
  if (!st) return;
  const region = st.region;
  const conf = SCENES[region];
  rng = mulberry32(region * 991 + 7);

  rect(0, 0, W, H, conf.g[0]);
  speckle(0, 28, W, H - 28, conf.g[1], 260);
  speckle(0, 28, W, H - 28, conf.g[2], 200);
  conf.scene(frame);

  // tufts of flora in the gaps between path rows, clear of the shrines
  for (let row = 0; row < ROWS - 1; row++) {
    for (let k = 0; k < 10; k++) {
      const x = 28 + rng() * 264, y = 44 + row * 28 + rng() * 6;
      if (shrinePts.some((s) => Math.abs(s.x - x) < 9 && Math.abs(s.y - 10 - y) < 14)) continue;
      px(x, y, C.leaf1); px(x - 1, y + 1, C.leaf2); px(x + 1, y + 1, C.leaf2);
    }
  }

  // the path, then its stepping stones
  for (let i = 0; i < nodesPts.length - 1; i++) {
    const a = nodesPts[i], b = nodesPts[i + 1];
    brushLine(a.x, a.y, b.x, b.y, 2, conf.path[1]);
  }
  for (let i = 0; i < nodesPts.length - 1; i++) {
    const a = nodesPts[i], b = nodesPts[i + 1];
    brushLine(a.x, a.y, b.x, b.y, 1, conf.path[0]);
  }

  for (let i = 0; i < nodesPts.length; i++) {
    const level = region * REGION_SIZE + i + 1;
    const p = nodesPts[i];
    const stars = st.starsByLevel.get(level) || 0;
    const bonus = level % 10 === 0;
    if (level === st.next) {
      disc(p.x, p.y, 4, C.goldD);
      disc(p.x, p.y, 3, frame % 4 < 2 ? C.goldHi : C.cream);
    } else if (stars) {
      // the stars are a visible ladder: ★ a mossy stone, ★★ the full green
      // with a cream fleck, ★★★ a gold star that twinkles on the stone
      if (stars === 1) {
        disc(p.x, p.y, bonus ? 4 : 3, bonus ? C.goldD : conf.path[1]);
        disc(p.x, p.y, bonus ? 3 : 2, bonus ? C.gold : C.leaf2);
      } else {
        disc(p.x, p.y, bonus ? 4 : 3, bonus ? C.goldD : C.leaf1);
        disc(p.x, p.y, bonus ? 3 : 2, bonus ? C.gold : C.leaf2);
        if (stars === 2) px(p.x, p.y, C.cream);
        else starSpark(p.x, p.y);
      }
    } else if (level < st.next) {
      disc(p.x, p.y, 3, conf.path[1]); disc(p.x, p.y, 2, C.cream);
    } else {
      disc(p.x, p.y, 2, conf.path[1]);
    }
  }

  // margin level-numbers, one per row
  for (let row = 0; row < ROWS; row++) {
    const lv = region * REGION_SIZE + row * COLS + 1;
    const x = row % 2 ? 300 : 4;
    num(x, 32 + row * 28, lv, 'rgba(58,53,44,.6)');
  }

  // shrines — the region's stanza of มงคล; the last one on level 1000 is the chedi
  for (const s of shrinePts) {
    const summit = s.b.n === 38;
    if (s.open) {
      cx.globalAlpha = 0.25;
      disc(s.x, s.y - 10, 8, C.goldHi);
      cx.globalAlpha = 1;
    }
    if (summit) spr(s.x - 6, s.y - 21, CHEDI, s.open ? CHEDI_PAL : CHEDI_SHUT);
    else spr(s.x - 4, s.y - 16, SHRINE, s.open ? SHRINE_OPEN : SHRINE_SHUT);
    if (s.open && frame % 4 < 2) px(s.x, s.y - (summit ? 21 : 16), C.goldHi);
  }

  // the traveler stands on the next level (nudged aside if a shrine shares it)
  if (st.next >= 1 && Math.floor((st.next - 1) / REGION_SIZE) === region) {
    const p = nodesPts[(st.next - 1) % REGION_SIZE];
    const dx = shrinePts.some((s) => s.x === p.x && s.y === p.y) ? 7 : 0;
    const bob = still ? 0 : frame % 2;
    cx.globalAlpha = 0.3;
    rect(p.x - 2 + dx, p.y + 3, 5, 1, C.ink);
    cx.globalAlpha = 1;
    spr(p.x - 3 + dx, p.y - 11 + bob, TRAVELER, TRAVELER_PAL);
  }

  // night falls with the dark theme: one dusk wash, then the shrines re-lit —
  // and the ★★★ stars, which keep their gold after dark like the flames do
  if (document.documentElement.dataset.theme === 'dark') {
    cx.globalCompositeOperation = 'multiply';
    rect(0, 0, W, H, '#9aa3cc');
    cx.globalCompositeOperation = 'source-over';
    for (const s of shrinePts) {
      if (!s.open) continue;
      cx.globalAlpha = 0.35;
      disc(s.x, s.y - 10, 7, '#ffdf8a');
      cx.globalAlpha = 1;
    }
    for (let i = 0; i < nodesPts.length; i++) {
      const level = region * REGION_SIZE + i + 1;
      if ((st.starsByLevel.get(level) || 0) === 3 && level !== st.next) {
        starSpark(nodesPts[i].x, nodesPts[i].y);
      }
    }
  }
}

// a four-point gold star, twinkling with the map's slow ticker
function starSpark(x, y) {
  px(x, y, C.goldHi);
  px(x - 1, y, C.gold); px(x + 1, y, C.gold);
  px(x, y - 1, C.gold); px(x, y + 1, C.gold);
  if (frame % 4 < 2) { px(x - 2, y, C.goldHi); px(x + 2, y, C.goldHi); }
  else { px(x, y - 2, C.goldHi); px(x, y + 2, C.goldHi); }
}

// ---- interaction -----------------------------------------------------------------
function logicalXY(e) {
  const r = cv.getBoundingClientRect();
  return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
}
function hitShrine(m) {
  return shrinePts.find((s) => Math.abs(m.x - s.x) < 6 && m.y > s.y - 22 && m.y < s.y - 4);
}
function hitNode(m) {
  for (let i = 0; i < nodesPts.length; i++) {
    const p = nodesPts[i];
    if ((m.x - p.x) ** 2 + (m.y - p.y) ** 2 < 36) return st.region * REGION_SIZE + i + 1;
  }
  return null;
}

function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = cv.getBoundingClientRect();
  const sx = r.width / W, sy = r.height / H;
  tip.style.left = `${Math.min(Math.max(x * sx, 40), r.width - 40)}px`;
  tip.style.top = `${y * sy - 34}px`;
}

function hover(e) {
  const m = logicalXY(e);
  const s = hitShrine(m);
  if (s) {
    cv.style.cursor = 'pointer';
    showTip(`☸ มงคลที่ ${thaiNum(s.b.n)} · ${s.open ? s.b.th : `ผ่านด่าน ${s.b.level} เพื่อเปิด`}`, s.x, s.y - 16);
    return;
  }
  const level = hitNode(m);
  if (level) {
    const stars = st.starsByLevel.get(level) || 0;
    const p = nodesPts[(level - 1) % REGION_SIZE];
    cv.style.cursor = level <= st.next ? 'pointer' : 'default';
    // finishing alone passes a level (stars are quality medals on top), so a
    // 0-star level below `next` still reads ผ่านแล้ว
    const state = level > st.next ? '🔒'
      : stars ? '★'.repeat(stars)
      : level < st.next ? 'ผ่านแล้ว' : 'ยังไม่ผ่าน';
    showTip(`ด่าน ${level}${level % 10 === 0 ? ' 🍃' : ''} · ${state}`, p.x, p.y);
    return;
  }
  cv.style.cursor = 'default';
  tip.hidden = true;
}

function click(e) {
  const m = logicalXY(e);
  const s = hitShrine(m);
  if (s) return showBlessing(s.b, s.open);
  const level = hitNode(m);
  if (level && level <= st.next) onPlay(level);
}

// ---- the blessing card and the collection --------------------------------------
export function showBlessing(b, open) {
  const card = modal(open ? `
    <div class="blessing-head">☸ มงคลชีวิตข้อที่ ${thaiNum(b.n)}</div>
    <h2 class="blessing-name">${b.th}</h2>
    <div class="blessing-pali">${b.pali}</div>
    <p class="blessing-mean">${b.mean}</p>
    <div class="play-actions"><button class="btn" data-close>สาธุ</button></div>`
    : `
    <div class="blessing-head">☸ มงคลชีวิตข้อที่ ${thaiNum(b.n)}</div>
    <h2 class="blessing-name">???</h2>
    <p class="blessing-mean">เดินทางถึงด่าน ${b.level} แล้วมงคลข้อนี้จะเปิดออก</p>
    <div class="play-actions"><button class="btn ghost" data-close>กลับ</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
}

export function showMongkhon(maxDone) {
  const u = unlockedCount(maxDone);
  const body = STANZAS.map((sz) => `
    <div class="mk-stanza">
      <h3>${sz.title}</h3>
      ${sz.items.map((b) => b.level <= maxDone
        ? `<div class="mk-item open"><b>${thaiNum(b.n)}. ${b.th}</b><small>${b.mean}</small></div>`
        : `<div class="mk-item"><b>${thaiNum(b.n)}. ???</b><small>ด่าน ${b.level}</small></div>`).join('')}
    </div>`).join('');
  const card = modal(`
    <h2>มงคลชีวิต ๓๘ ประการ</h2>
    <div class="modal-sub">เปิดแล้ว ${thaiNum(u)} จาก ๓๘ · มงคลสูตร</div>
    <div class="mk-list">${body}</div>
    <div class="play-actions"><button class="btn" data-close>กลับ</button></div>`);
  card.querySelector('[data-close]').onclick = closeModal;
}

// ---- public API ------------------------------------------------------------------
export function drawMap(state) {
  st = state;
  nodesPts = layoutNodes(st.region);
  shrinePts = layoutShrines(st.region, st.maxDone);
  draw();
}

export function redrawMap() { if (st) draw(); }

export function initMap(opts) {
  onPlay = opts.onPlay;
  cv = document.getElementById('pixelmap');
  ({ cx, px, rect, disc, spr } = makePainter(cv));
  tip = document.getElementById('map-tip');
  cv.addEventListener('pointermove', hover);
  cv.addEventListener('pointerleave', () => { tip.hidden = true; });
  cv.addEventListener('click', click);
  if (!still) {
    let last = 0;
    (function loop(t) {
      requestAnimationFrame(loop);
      if (document.hidden || !cv.offsetParent || !st || t - last < 260) return;
      last = t;
      frame++;
      draw();
    })(0);
  }
}
