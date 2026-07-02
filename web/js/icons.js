// Pixel icons for the header toggles, painted with the shared kit on a finer
// 12x12 grid than the landscapes (shown at 24px, so 2px pixels). Drawn in the
// button's own ink color, so they follow the theme; repaint after toggling it.
import { makePainter } from './pixel.js';

const MUSIC = [ // a beamed pair of quavers
  '...#######..',
  '...#######..',
  '...#.....#..',
  '...#.....#..',
  '...#.....#..',
  '...#.....#..',
  '...#.....#..',
  '...#.....#..',
  '.###...###..',
  '.###...###..',
];

const SOUND = [ // a speaker with two pixel waves
  '....#.......',
  '...##....#..',
  '..###..#..#.',
  '#####..#..#.',
  '#####.#..#.#',
  '#####.#..#.#',
  '#####.#..#.#',
  '#####..#..#.',
  '..###..#..#.',
  '...##....#..',
  '....#.......',
];

const MOON = [ // shown in the light theme: switch to night
  '....####....',
  '...####.....',
  '..#####.....',
  '.#####......',
  '.#####......',
  '.#####......',
  '.#####......',
  '..#####.....',
  '...#####..#.',
  '....######..',
];

const SUN = [ // shown in the dark theme: switch to day
  '.....#......',
  '.#...#...#..',
  '..#.....#...',
  '....###.....',
  '...#####....',
  '#..#####..#.',
  '...#####....',
  '....###.....',
  '..#.....#...',
  '.#...#...#..',
  '.....#......',
];

function paint(id, art) {
  const btn = document.getElementById(id);
  const canvas = btn.querySelector('canvas');
  const { cx, spr } = makePainter(canvas);
  cx.clearRect(0, 0, canvas.width, canvas.height);
  spr(0, 1, art, { '#': getComputedStyle(btn).color });
}

export function paintIcons() {
  paint('music-toggle', MUSIC);
  paint('sound-toggle', SOUND);
  paint('theme-toggle', document.documentElement.dataset.theme === 'dark' ? SUN : MOON);
}
