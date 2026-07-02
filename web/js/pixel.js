// The shared pixel-drawing kit: a canvas is a grid of fat pixels, upscaled
// crisp by CSS (image-rendering: pixelated). Used by the journey map (map.js)
// and the hero landscape (hero.js) — both draw everything in code, no assets.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makePainter(canvas) {
  const cx = canvas.getContext('2d');
  const px = (x, y, c) => { cx.fillStyle = c; cx.fillRect(x | 0, y | 0, 1, 1); };
  const rect = (x, y, w, h, c) => { cx.fillStyle = c; cx.fillRect(x, y, w, h); };
  function disc(xc, yc, r, c) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++)
      if (x * x + y * y <= r * r + r * 0.6) px(xc + x, yc + y, c);
  }
  // string-art sprites: one letter per pixel, '.' transparent
  function spr(x, y, rows, pal) {
    for (let j = 0; j < rows.length; j++) for (let i = 0; i < rows[j].length; i++) {
      const c = pal[rows[j][i]];
      if (c) px(x + i, y + j, c);
    }
  }
  return { cx, px, rect, disc, spr };
}
