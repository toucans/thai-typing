// The shared pixel-drawing kit: a canvas is a grid of fat pixels, upscaled
// crisp by CSS (image-rendering: pixelated). Used by the journey map (map.ts)
// and the hero landscape (hero.ts) — both draw everything in code, no assets.

// One letter per pixel in a sprite's rows; a letter with no entry here is
// transparent, which is what '.' is everywhere in this codebase.
export type Palette = Record<string, string | undefined>;

export interface Painter {
  cx: CanvasRenderingContext2D;
  px: (x: number, y: number, c: string) => void;
  rect: (x: number, y: number, w: number, h: number, c: string) => void;
  disc: (xc: number, yc: number, r: number, c: string) => void;
  spr: (x: number, y: number, rows: readonly string[], pal: Palette) => void;
}

export function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makePainter(canvas: HTMLCanvasElement): Painter {
  const cx = canvas.getContext('2d');
  if (!cx) throw new Error('no 2d context');
  const px = (x: number, y: number, c: string) => { cx.fillStyle = c; cx.fillRect(x | 0, y | 0, 1, 1); };
  const rect = (x: number, y: number, w: number, h: number, c: string) => { cx.fillStyle = c; cx.fillRect(x, y, w, h); };
  function disc(xc: number, yc: number, r: number, c: string) {
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++)
      if (x * x + y * y <= r * r + r * 0.6) px(xc + x, yc + y, c);
  }
  // string-art sprites: one letter per pixel, '.' transparent
  function spr(x: number, y: number, rows: readonly string[], pal: Palette) {
    for (let j = 0; j < rows.length; j++) {
      const row = rows[j] ?? '';
      for (let i = 0; i < row.length; i++) {
        const c = pal[row[i] ?? ''];
        if (c) px(x + i, y + j, c);
      }
    }
  }
  return { cx, px, rect, disc, spr };
}
