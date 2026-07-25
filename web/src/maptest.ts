// Entry point for web/maptest.html, the dev harness that renders just the pixel
// map. It lives here rather than as an inline <script type="module"> because the
// app is TypeScript now: a browser can't import src/map.ts directly, so the
// harness needs its own tiny bundle (deno.json's `build` task emits both).
import { initMap, drawMap, showMongkhon, showBlessing } from './map.ts';
import { BY_LEVEL } from './data/mongkhon.ts';

const q = new URLSearchParams(location.search);
if (q.has('dark')) document.documentElement.dataset.theme = 'dark';
const region = +(q.get('r') || 0);
const done = +(q.get('done') ?? region * 100 + 37);
const starsByLevel = new Map<number, number>();
for (let l = 1; l <= done; l++) starsByLevel.set(l, 1 + (l % 3));
initMap({ onPlay: () => {} });
drawMap({ region, next: done + 1, maxDone: done, starsByLevel });
if (q.get('modal') === 'mk') showMongkhon(done);
if (q.get('modal') === 'blessing') {
  const b = BY_LEVEL.get(region * 100 + 33) ?? BY_LEVEL.get(region * 100 + 25);
  if (b) showBlessing(b, true);
}
