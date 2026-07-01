// Run records. The server's data/runs.jsonl is the single source of truth;
// everything shown anywhere (unlocked levels, stars, PBs, streaks, the graph)
// is derived from it. localStorage only caches a copy and queues writes that
// failed while the server was unreachable.

const PENDING = 'tt.pending';
const CACHE = 'tt.cache';
let cache = null;

async function flushPending() {
  const pending = JSON.parse(localStorage.getItem(PENDING) || '[]');
  if (!pending.length) return;
  const still = [];
  for (const run of pending) {
    try {
      const res = await fetch('api/runs', { method: 'POST', body: JSON.stringify(run) });
      if (!res.ok) still.push(run);
    } catch { still.push(run); }
  }
  localStorage.setItem(PENDING, JSON.stringify(still));
}

export async function loadRuns(force = false) {
  if (cache && !force) return cache;
  await flushPending();
  try {
    const res = await fetch('api/runs');
    cache = (await res.json()).runs;
    localStorage.setItem(CACHE, JSON.stringify(cache));
  } catch {
    cache = JSON.parse(localStorage.getItem(CACHE) || '[]');
  }
  return cache;
}

export async function saveRun(run) {
  run.t = new Date().toISOString();
  cache = (cache || []).concat([run]);
  localStorage.setItem(CACHE, JSON.stringify(cache));
  try {
    const res = await fetch('api/runs', { method: 'POST', body: JSON.stringify(run) });
    if (!res.ok) throw new Error();
  } catch {
    const p = JSON.parse(localStorage.getItem(PENDING) || '[]');
    p.push(run);
    localStorage.setItem(PENDING, JSON.stringify(p));
  }
  document.dispatchEvent(new CustomEvent('runs-changed'));
}

// Derived progress. PBs only count with >=95% accuracy so a sloppy sprint can't
// set the bar; the star baseline is the median of your last 10 runs, so two and
// three stars always mean "better than your own recent self" — never impossible,
// never trivial.
export function stats(runs) {
  const speed = runs.filter((r) => r.game === 'speed');
  const starsByLevel = new Map();
  let maxDone = 0;
  let pb = 0;
  let pbAt = null;
  for (const r of speed) {
    if (r.level) {
      if ((r.stars || 0) >= 1) {
        maxDone = Math.max(maxDone, r.level);
        starsByLevel.set(r.level, Math.max(starsByLevel.get(r.level) || 0, r.stars));
      }
    }
    if (r.acc >= 0.95 && r.cpm > pb) { pb = r.cpm; pbAt = r.t; }
  }
  const last = speed.slice(-10).map((r) => r.cpm).sort((a, b) => a - b);
  const baseline = last.length >= 3 ? last[Math.floor(last.length / 2)] : 0;

  const days = new Set(runs.map((r) => r.t.slice(0, 10)));
  let streak = 0;
  const d = new Date();
  if (!days.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1); // today not played yet
  while (days.has(d.toISOString().slice(0, 10))) { streak++; d.setDate(d.getDate() - 1); }

  const totalChars = runs.reduce((s, r) => s + (r.chars || 0), 0);
  const totalSecs = runs.reduce((s, r) => s + (r.secs || 0), 0);
  const recent = speed.filter((r) => Date.now() - new Date(r.t) < 30 * 864e5);
  const avg30 = recent.length
    ? recent.reduce((s, r) => s + r.cpm, 0) / recent.length : 0;
  const dictWords = runs.filter((r) => r.game === 'dictation')
    .reduce((s, r) => s + (r.words || 0), 0);

  return { starsByLevel, maxDone, pb, pbAt, baseline, streak, totalChars, totalSecs, avg30, dictWords };
}
