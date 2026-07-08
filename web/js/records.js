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
      // finishing a level unlocks the next; stars are quality medals on top
      maxDone = Math.max(maxDone, r.level);
      if ((r.stars || 0) >= 1) {
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
