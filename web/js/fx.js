// Motion choreography (GSAP, vendored in vendor/) and the ambient hero
// particles — petals drifting by day, fireflies by night. All of it is
// decoration: with no gsap global or prefers-reduced-motion, every call
// degrades to a static page that works identically.

const g = window.gsap;
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

export const fx = {
  // staggered entrance for a view's direct children
  viewIn(section) {
    if (!g || still || !section) return;
    g.from(section.children, {
      opacity: 0, y: 14, duration: 0.4, stagger: 0.06,
      ease: 'power2.out', clearProps: 'all', overwrite: 'auto',
    });
  },

  // the pixel map rises into view when the region changes
  mapIn(wrap) {
    if (!g || still || !wrap) return;
    g.from(wrap, {
      opacity: 0, y: 10, scale: 0.98, duration: 0.35,
      ease: 'power2.out', clearProps: 'all', overwrite: 'auto',
    });
  },

  modalIn(card) {
    if (!g || still || !card) return;
    g.from(card, { scale: 0.85, opacity: 0, duration: 0.35, ease: 'back.out(1.6)', clearProps: 'all' });
  },

  // crossing into a new region: the landscape rises into view
  heroRegion() {
    if (!g || still) return;
    g.fromTo('#hero-art', { opacity: 0.35, y: 8 }, {
      opacity: 1, y: 0, duration: 0.9, ease: 'power2.out', clearProps: 'all', overwrite: 'auto',
    });
  },

  init() {
    if (still) return;
    initParticles();
  },
};

// ---- ambient particles ---------------------------------------------------------
const PETALS = ['#d4a72c', '#e9d8a6', '#95d5b2', '#f3e2b8'];

function initParticles() {
  const canvas = document.getElementById('hero-fx');
  const hero = document.getElementById('hero');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;

  function resize() {
    dpr = Math.min(devicePixelRatio || 1, 2);
    W = hero.clientWidth; H = hero.clientHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  addEventListener('resize', resize);

  const parts = Array.from({ length: 14 }, () => spawn(true));
  function spawn(anywhere) {
    return {
      x: Math.random() * 1200,             // in 0..1200 design units, scaled at draw
      y: anywhere ? Math.random() * 240 : -12,
      vy: 0.12 + Math.random() * 0.2,
      sway: 0.4 + Math.random() * 0.8,
      phase: Math.random() * Math.PI * 2,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.01,
      c: PETALS[Math.floor(Math.random() * PETALS.length)],
      tw: 1.5 + Math.random() * 2.5,       // firefly pulse rate
    };
  }

  // everything is drawn as fat pixels snapped to a grid, like the landscape
  const CELL = 3;
  const snap = (v) => Math.round(v / CELL) * CELL;

  (function frame(t) {
    requestAnimationFrame(frame);
    ctx.clearRect(0, 0, W, H);
    const dark = document.documentElement.dataset.theme === 'dark';
    const sx = W / 1200, sy = H / 240;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (dark) {
        // fireflies wander instead of falling, pulsing in steps
        p.x += Math.sin(t / 900 + p.phase) * 0.35;
        p.y += Math.cos(t / 1100 + p.phase * 1.7) * 0.25;
        if (p.y < 40) p.y = 40;
        if (p.y > 235) p.y = 235;
        const a = Math.round((0.25 + 0.75 * Math.abs(Math.sin(t / 1000 * p.tw + p.phase))) * 4) / 4;
        const x = snap(p.x * sx), y = snap(p.y * sy);
        ctx.fillStyle = `rgba(255,240,180,${a})`;
        ctx.fillRect(x, y, CELL, CELL);
        if (a > 0.5) { // a pixel halo when bright
          ctx.fillStyle = `rgba(255,229,138,${(a - 0.5) * 0.5})`;
          ctx.fillRect(x - CELL, y, CELL, CELL); ctx.fillRect(x + CELL, y, CELL, CELL);
          ctx.fillRect(x, y - CELL, CELL, CELL); ctx.fillRect(x, y + CELL, CELL, CELL);
        }
        if (p.x < -20 || p.x > 1220) parts[i] = spawn(true);
      } else {
        // petals: a two-pixel domino that tumbles by flipping its fold
        p.y += p.vy;
        p.x += Math.sin(t / 1400 + p.phase) * p.sway * 0.2;
        p.rot += p.vr;
        if (p.y > 250) parts[i] = spawn(false);
        const x = snap(p.x * sx), y = snap(p.y * sy);
        const flip = Math.sin(t / 500 + p.rot * 6) > 0 ? CELL : -CELL;
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = p.c;
        ctx.fillRect(x, y, CELL, CELL);
        ctx.fillRect(x + flip, y + CELL, CELL, CELL);
        ctx.globalAlpha = 1;
      }
    }
  })(0);
}
