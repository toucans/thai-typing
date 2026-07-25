// Run records. The server's data/users/<name>.jsonl is the single source of
// truth; everything shown anywhere (unlocked levels, stars, PBs, streaks, the
// graph) is derived from it. We fetch it once per session and keep it in memory
// — switching between views (journey/stats/…) reuses that copy instead of
// re-fetching everything; saving a run keeps the copy current. localStorage
// holds only the username (plus device prefs like theme) — never save data
// that could conflict.

const USER_KEY = 'tt.user';
// pre-account versions cached runs here; stale copies must not linger
localStorage.removeItem('tt.cache');
localStorage.removeItem('tt.pending');
let user = localStorage.getItem(USER_KEY);
let cache = [];      // the session's copy of this user's runs (also the offline fallback)
let loaded = false;  // has cache been filled from the server yet this session?
let pending = [];    // runs whose POST failed; retried before the next load/save

export function currentUser() { return user; }

export function logout() {
  user = null;
  cache = [];
  loaded = false;
  pending = [];
  localStorage.removeItem(USER_KEY);
}

async function auth(endpoint, name) {
  const res = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ user: name }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(res.status === 409 ? 'ชื่อนี้ถูกใช้แล้ว'
      : res.status === 404 ? 'ไม่พบชื่อนี้ — สร้างผู้ใช้ใหม่ก่อน'
      : res.status === 400 ? 'ใช้ได้เฉพาะ a-z 0-9 . _ - (1–32 ตัว)'
      : 'เชื่อมต่อไม่ได้');
  }
  user = body.user; // server-normalized (lowercase)
  localStorage.setItem(USER_KEY, user);
  return user;
}

export const login = (name) => auth('api/login', name);
export const createUser = (name) => auth('api/user', name);

async function flushPending() {
  const still = [];
  for (const run of pending) {
    try {
      const res = await fetch('api/runs', {
        method: 'POST', body: JSON.stringify({ ...run, user }),
      });
      if (!res.ok) still.push(run);
    } catch { still.push(run); }
  }
  pending = still;
}

// Returns this session's runs, fetching from the server only the first time (or
// when force=true). Cheap to call on every view render — it won't hit the
// network just because you switched tabs.
export async function loadRuns(force = false) {
  if (pending.length) await flushPending();
  if (loaded && !force) return cache.concat(pending);
  try {
    const res = await fetch(`api/runs?user=${encodeURIComponent(user)}`);
    if (res.ok) { cache = (await res.json()).runs; loaded = true; }
  } catch { /* offline: fall through to the last good copy */ }
  return cache.concat(pending);
}

export async function saveRun(run) {
  run.t = new Date().toISOString();
  try {
    const res = await fetch('api/runs', {
      method: 'POST', body: JSON.stringify({ ...run, user }),
    });
    if (!res.ok) throw new Error();
    cache = cache.concat([run]);
  } catch {
    pending.push(run); // retried on the next load/save; lost if the tab closes
  }
  document.dispatchEvent(new CustomEvent('runs-changed'));
}

// Star rules, calibrated on real play data. Accuracy here is per keystroke —
// every wrong key counts even if corrected, and Thai's stacked vowels and tone
// marks make that unforgiving: a typical solid run sits near 85%, and 90%+ is
// already a clean one. Each tier is roughly three times rarer than the one
// below it (recalibrated 2026-07-13: the old ★★ speed check at 85% of baseline
// passed almost every run, so ★★ was pure accuracy and speed counted for
// nothing — now both upper tiers demand real speed):
//  ★    a careful finish — accuracy >= 80%
//  ★★   clean at full speed — accuracy >= 88% at or above your median cpm
//  ★★★  excellence — accuracy >= 93%, 5% above your median cpm
// The speed checks compare against your own last 10 runs (baseline below), so
// every tier stays reachable — and none turns trivial — from level 1 to 1000.
export function starsFor(acc, cpm, baseline) {
  let stars = 0;
  if (acc >= 0.80) stars = 1;
  if (stars && acc >= 0.88 && (baseline === 0 || cpm >= baseline)) stars = 2;
  if (stars === 2 && acc >= 0.93 && (baseline === 0 || cpm >= baseline * 1.05)) stars = 3;
  return stars;
}

// The runs that raised the personal best (>=90% accuracy, same rule as
// stats().pb), oldest first. Feeds the chart's step line and the record-days
// list on the stats page. 90% is this game's "clean run" line (per-keystroke
// accuracy runs ~10pts harsher than the typing-pedagogy figure; on real play
// data 90%+ is the top ~fifth of runs), so it keeps a sloppy sprint — median
// play sits near 85% — from setting the bar without demanding near-perfection.
export function pbHistory(runs) {
  const speed = runs.filter((r) => r.game === 'speed' && r.cpm > 0)
    .sort((a, b) => a.t.localeCompare(b.t));
  const out = [];
  let pb = 0;
  for (const r of speed) {
    if (r.acc >= 0.90 && r.cpm > pb) { pb = r.cpm; out.push(r); }
  }
  return out;
}

// Derived progress. Speed PBs only count with >=90% accuracy (this game's clean
// line) so a sloppy sprint can't set the bar. accPb is the mirror reward for the
// leading indicator: your best accuracy ever — a clean run is a record in its own
// right, celebrated the same way as a speed PB, so the game rewards slowing down
// as well as speeding up. Stars are re-derived here from each run's raw numbers
// (acc, cpm, and the baseline as it stood at the time) rather than read from the
// stored `stars` field — so refining starsFor() regrades the whole journey
// consistently instead of freezing old rules into the map.
export function stats(runs) {
  const speed = runs.filter((r) => r.game === 'speed');
  const starsByLevel = new Map();
  let maxDone = 0;
  let pb = 0;
  let pbAt = null;
  let accPb = 0;
  const cpms = []; // rolling window source for each run's baseline
  for (const r of speed) {
    const win = cpms.slice(-10).sort((a, b) => a - b);
    const base = win.length >= 3 ? win[Math.floor(win.length / 2)] : 0;
    if (r.level) {
      // finishing a level unlocks the next; stars are quality medals on top
      maxDone = Math.max(maxDone, r.level);
      const stars = starsFor(r.acc || 0, r.cpm, base);
      if (stars) starsByLevel.set(r.level, Math.max(starsByLevel.get(r.level) || 0, stars));
    }
    if (r.acc >= 0.90 && r.cpm > pb) { pb = r.cpm; pbAt = r.t; }
    if ((r.acc || 0) > accPb) accPb = r.acc;
    cpms.push(r.cpm);
  }
  const last = cpms.slice(-10).sort((a, b) => a - b);
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
  const dictRuns = runs.filter((r) => r.game === 'dictation');
  const dictWords = dictRuns.reduce((s, r) => s + (r.words || 0), 0);
  // Words ฟัง–พิมพ์ still owes you: missed at some point and not yet drilled back
  // to a clean unaided recall. Replaying each run's misses and masteries in
  // order gives the current state — the same walk dictation.js does at session
  // start to decide what opens the next round.
  const dictOwed = new Set();
  for (const r of dictRuns.slice().sort((a, b) => (a.t || '').localeCompare(b.t || ''))) {
    for (const m of r.misses || []) dictOwed.add(m.w);
    for (const w of r.mastered || []) dictOwed.delete(w);
  }
  // เรื่องอ่าน and ข่าว share the text engine (game === 'text'), but they are
  // counted apart: news runs carry a 'ข่าว: ' name prefix and a `src` (สำนักข่าว).
  // Reading runs never touch the speed PB or graph, so surface their own effort
  // (stories finished) and best pace here; news gets the same, plus a per-source
  // tally and the set of headlines already typed (to mark them in the list).
  const isNews = (r) => (r.name || '').startsWith('ข่าว: ');
  const textRuns = runs.filter((r) => r.game === 'text' && !isNews(r));
  const newsRuns = runs.filter((r) => r.game === 'text' && isNews(r));
  const textsRead = textRuns.length;
  const textPb = textRuns.reduce((m, r) => (r.cpm > m ? r.cpm : m), 0);
  const newsRead = newsRuns.length;
  const newsPb = newsRuns.reduce((m, r) => (r.cpm > m ? r.cpm : m), 0);
  const newsChars = newsRuns.reduce((s, r) => s + (r.chars || 0), 0);
  const newsBySource = {};
  const newsTitles = new Set();
  for (const r of newsRuns) {
    const s = r.src || '—';
    newsBySource[s] = (newsBySource[s] || 0) + 1;
    newsTitles.add((r.name || '').replace(/^ข่าว: /, ''));
  }
  const ghostRuns = runs.filter((r) => r.game === 'ghosts');
  const ghostsBanished = ghostRuns.reduce((s, r) => s + (r.ghosts || 0), 0);
  const ghostNight = ghostRuns.reduce((m, r) => (r.cleared && r.night > m ? r.night : m), 0);

  return { starsByLevel, maxDone, pb, pbAt, accPb, baseline, streak, totalChars, totalSecs, avg30, dictWords, dictOwed, textsRead, textPb, newsRead, newsPb, newsChars, newsBySource, newsTitles, ghostsBanished, ghostNight };
}
