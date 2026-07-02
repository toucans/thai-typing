// Shared UI helpers: view switching, regions, modal, confetti — plus Thai word
// segmentation, which every mode needs.
import { music } from './music.js';
import { fx } from './fx.js';
import { setHeroRegion } from './hero.js';

export const $ = (sel) => document.querySelector(sel);

// The journey: 10 regions x 100 levels, a walk from the southern sea up to the
// summit of Doi Inthanon. Only the hue changes — one hero SVG, ten moods.
export const REGIONS = [
  { th: 'เกาะทะเลใต้', en: 'Southern Isles', hue: 172 },
  { th: 'ป่าชายเลน', en: 'Mangroves', hue: 152 },
  { th: 'ทุ่งนาเขียว', en: 'Rice Paddies', hue: 95 },
  { th: 'ริมแม่น้ำ', en: 'River Banks', hue: 200 },
  { th: 'สวนผลไม้', en: 'Orchards', hue: 70 },
  { th: 'ป่าฝน', en: 'Rainforest', hue: 135 },
  { th: 'น้ำตกในหุบเขา', en: 'Waterfalls', hue: 190 },
  { th: 'ถ้ำหินปูน', en: 'Limestone Caves', hue: 28 },
  { th: 'ดอยหมอก', en: 'Misty Highlands', hue: 255 },
  { th: 'ยอดดอยอินทนนท์', en: 'The Summit', hue: 45 },
];
export const REGION_SIZE = 100;
export const TOTAL_LEVELS = REGIONS.length * REGION_SIZE;

export function setRegion(idx) {
  idx = Math.max(0, Math.min(REGIONS.length - 1, idx));
  const r = REGIONS[idx];
  const hero = $('#hero');
  if (hero.dataset.region !== String(idx)) {
    hero.dataset.region = idx;
    setHeroRegion(idx, r.hue); // repaints the pixel landscape in the region's hue
    fx.heroRegion();
  }
  $('#region-name').textContent = r.th;
  $('#region-en').textContent = r.en;
}

export function show(view) {
  for (const s of document.querySelectorAll('.view')) s.hidden = true;
  const section = $(`#view-${view}`);
  section.hidden = false;
  fx.viewIn(section);
  for (const b of document.querySelectorAll('#nav button')) {
    b.classList.toggle('active', b.dataset.view === view);
  }
  // the front page has its own theme; levels bring their own; elsewhere, quiet
  if (view === 'journey') music.playHome();
  else if (view !== 'play') music.stop();
  window.scrollTo(0, 0);
}

// ---- Thai word segmentation -------------------------------------------------
// Browsers ship ICU dictionary-based Thai segmentation via Intl.Segmenter, so no
// preprocessing step is needed. Explicit '|' (or zero-width-space) markers in the
// source text always win — that is the escape hatch for the dictionary's mistakes.
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter
  ? new Intl.Segmenter('th', { granularity: 'word' }) : null;

export function segmentThai(text) {
  text = text.normalize('NFC');
  if (text.includes('|')) return text.split('|').map((s) => s.trim()).filter(Boolean);
  if (text.includes('\u200b')) return text.split('\u200b').map((s) => s.trim()).filter(Boolean);
  if (!segmenter) return text.split(/\s+/).filter(Boolean);
  const out = [];
  for (const s of segmenter.segment(text)) {
    const t = s.segment;
    if (/^\s+$/.test(t)) continue;
    // attach stray punctuation / repeat marks (ๆ ฯ …) to the preceding word
    if (!s.isWordLike && out.length) { out[out.length - 1] += t; continue; }
    out.push(t);
  }
  return out;
}

// ---- modal -------------------------------------------------------------------
export function modal(html) {
  $('#modal-card').innerHTML = html;
  $('#modal').hidden = false;
  fx.modalIn($('#modal-card'));
  return $('#modal-card');
}
export function closeModal() { $('#modal').hidden = true; }

// ---- confetti: falling pixel leaves and gold flecks for personal bests ---------
export function confetti() {
  const canvas = $('#confetti');
  const ctx = canvas.getContext('2d');
  canvas.width = innerWidth; canvas.height = innerHeight;
  const colors = ['#b8860b', '#e9d8a6', '#2d6a4f', '#40916c', '#95d5b2'];
  const CELL = 4;
  const snap = (v) => Math.round(v / CELL) * CELL;
  const parts = Array.from({ length: 130 }, () => ({
    x: Math.random() * canvas.width,
    y: -20 - Math.random() * canvas.height * 0.5,
    vx: (Math.random() - 0.5) * 1.6,
    vy: 1.5 + Math.random() * 2.5,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.2,
    big: Math.random() > 0.5, // leaves and smaller flecks
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  (function frame(t) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const p of parts) {
      p.x += p.vx + Math.sin(t / 300 + p.rot) * 0.6;
      p.y += p.vy; p.rot += p.vr;
      const x = snap(p.x), y = snap(p.y);
      const flip = Math.sin(t / 250 + p.rot * 4) > 0 ? CELL : -CELL;
      ctx.fillStyle = p.c;
      ctx.fillRect(x, y, CELL, CELL);
      if (p.big) { // a tumbling three-pixel leaf
        ctx.fillRect(x + flip, y + CELL, CELL, CELL);
        ctx.fillRect(x, y + CELL * 2, CELL, CELL);
      }
    }
    if (t - t0 < 3000) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  })(t0);
}
