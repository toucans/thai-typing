// Bootstrap and the three "browse" views: journey (level map), texts, stats.
// The play views live in speed.js / dictation.js.
import { loadRuns, stats, pbHistory, currentUser, login, createUser, logout } from './records.js';
import { startLevel, startText, initSpeed } from './speed.js';
import { initDictation, initDictationInput } from './dictation.js';
import { initGhosts, renderGhosts } from './ghosts.js';
import { renderChart } from './chart.js';
import { sound } from './audio.js';
import { music } from './music.js';
import { fx } from './fx.js';
import { $, show, modal, closeModal, setRegion, segmentThaiBreaks, REGIONS, REGION_SIZE, TOTAL_LEVELS } from './ui.js';
import { initMap, drawMap, redrawMap, showMongkhon } from './map.js';
import { redrawHero } from './hero.js';
import { paintIcons } from './icons.js';
import { thaiNum, unlockedCount } from './data/mongkhon.js';

let selRegion = null; // region the user is browsing (defaults to where they are)

// ---- journey ------------------------------------------------------------------
async function renderJourney() {
  const st = stats(await loadRuns());
  const next = Math.min(st.maxDone + 1, TOTAL_LEVELS);
  const curRegion = Math.floor((next - 1) / REGION_SIZE);
  if (selRegion === null) selRegion = curRegion;
  setRegion(selRegion);

  $('#journey-stats').innerHTML = `
    <span>🔥 <b>${st.streak}</b> วันติด</span>
    <span>🏆 สถิติ <b>${Math.round(st.pb)}</b> ตัวอักษร/นาที</span>
    <span>ผ่านแล้ว <b>${st.maxDone}</b>/${TOTAL_LEVELS} ด่าน</span>`;
  const mkBtn = $('#mongkhon-btn');
  mkBtn.textContent = `☸ มงคล ${thaiNum(unlockedCount(st.maxDone))}/๓๘`;
  mkBtn.onclick = () => showMongkhon(st.maxDone);
  const playBtn = $('#journey-play');
  playBtn.textContent = st.maxDone === 0 ? 'เริ่มเส้นทาง 🌱' : `เล่นด่าน ${next} →`;
  playBtn.onclick = () => startLevel(next);

  const chips = $('#region-chips');
  chips.innerHTML = '';
  REGIONS.forEach((r, i) => {
    const doneInRegion = countDone(st, i);
    const locked = i * REGION_SIZE >= next; // region opens when you reach it
    const chip = document.createElement('button');
    chip.className = 'chip' + (i === selRegion ? ' sel' : '') + (locked ? ' locked' : '');
    chip.innerHTML = `${r.th} <small>${doneInRegion}/${REGION_SIZE}</small>`;
    if (!locked) chip.onclick = () => { selRegion = i; renderJourney(); };
    chips.appendChild(chip);
  });

  drawMap({ region: selRegion, next, maxDone: st.maxDone, starsByLevel: st.starsByLevel });
  fx.mapIn($('#mapwrap'));
}

function countDone(st, region) {
  // unlocking is sequential, so everything up to maxDone is passed — with or
  // without stars
  return Math.max(0, Math.min(REGION_SIZE, st.maxDone - region * REGION_SIZE));
}

// ---- stats ----------------------------------------------------------------------
async function renderStats() {
  const runs = await loadRuns();
  const st = stats(runs);
  const hours = Math.floor(st.totalSecs / 3600);
  const mins = Math.round((st.totalSecs % 3600) / 60);
  const pbDate = st.pbAt
    ? new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' }).format(new Date(st.pbAt)) : '';
  const cards = [
    [Math.round(st.pb) || '–', `สถิติสูงสุด (ตัวอักษร/นาที)${pbDate ? ' · ' + pbDate : ''}`],
    [Math.round(st.avg30) || '–', 'เฉลี่ย 30 วันหลัง'],
    [`${st.maxDone}`, `จาก ${TOTAL_LEVELS} ด่าน`],
    [`🔥 ${st.streak}`, 'วันติดกัน'],
    [st.totalChars.toLocaleString('th-TH'), `ตัวอักษรที่พิมพ์ · ≈ ${Math.max(1, Math.round(st.totalChars / 1800))} หน้ากระดาษ`],
    [`${hours} ชม. ${mins} น.`, 'เวลาฝึกทั้งหมด'],
    [st.dictWords.toLocaleString('th-TH'), 'คำจากแบบฝึกฟัง–พิมพ์'],
    [st.ghostsBanished.toLocaleString('th-TH'),
      `ผีที่ไล่ไปแล้ว${st.ghostNight ? ` · ลึกสุดคืนที่ ${st.ghostNight}` : ''}`],
  ];
  $('#stat-cards').innerHTML = cards.map(([num, label]) =>
    `<div class="stat"><div class="stat-num">${num}</div><div class="stat-label">${label}</div></div>`).join('');
  renderChart($('#chart'), runs);
  const pbs = pbHistory(runs);
  const btn = $('#pb-list-btn');
  btn.disabled = !pbs.length;
  btn.onclick = () => showPbHistory(pbs);
}

// Every day the record moved, as a list you can actually read — the gold dots
// on the chart, spelled out: when, at which level, and by how much.
function showPbHistory(pbs) {
  const dfmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  const tfmt = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit' });
  const rows = pbs.map((r, i) => {
    const d = new Date(r.t);
    const gain = i ? `+${Math.round((r.cpm - pbs[i - 1].cpm) * 10) / 10}` : 'ครั้งแรก';
    const where = r.level ? `ด่าน ${r.level}` : (r.name || 'เรื่องอ่าน');
    return `<div class="pb-row">
      <span class="pb-date">${dfmt.format(d)} · ${tfmt.format(d)}</span>
      <span class="pb-where">${where}</span>
      <span class="pb-cpm"><b>${Math.round(r.cpm)}</b> <small class="pb-gain">${gain}</small></span>
    </div>`;
  }).reverse().join(''); // newest on top
  const card = modal(`
    <h2>🏆 วันทำลายสถิติ</h2>
    <div class="modal-sub">ทุกครั้งที่ความเร็วสูงสุด (แม่นยำ ≥95%) ขยับขึ้น · ตัวอักษร/นาที</div>
    <div class="pb-rows">${rows}</div>
    <div class="play-actions"><button class="btn" id="m-close">ปิด</button></div>`);
  card.querySelector('#m-close').onclick = closeModal;
}

// ---- free texts --------------------------------------------------------------------
async function renderTexts() {
  const list = $('#texts-list');
  let texts = [];
  try { texts = (await (await fetch('api/texts')).json()).texts; } catch { /* offline */ }
  if (!texts.length) {
    list.innerHTML = '<p class="hint">ยังไม่มีไฟล์ใน <code>texts/</code></p>';
    return;
  }
  list.innerHTML = '';
  for (const t of texts) {
    const card = document.createElement('button');
    card.className = 'mediacard';
    card.innerHTML = `<b>${t.title}</b><small>${t.name}</small>`;
    card.onclick = async () => {
      const raw = await (await fetch(t.path)).text();
      const body = raw.split('\n').slice(1).join(' ').trim(); // first line is the title
      const { words, breaks } = segmentThaiBreaks(body);
      startText(t.name, t.title, words, breaks);
    };
    list.appendChild(card);
  }
}

// ---- boot ---------------------------------------------------------------------------
const renderers = { journey: renderJourney, stats: renderStats, texts: renderTexts, ghosts: renderGhosts, dictation: null };

for (const b of document.querySelectorAll('#nav button')) {
  b.addEventListener('click', () => {
    show(b.dataset.view);
    const r = renderers[b.dataset.view];
    if (r) r();
    if (b.dataset.view === 'dictation') initDictation();
  });
}

const soundBtn = $('#sound-toggle');
soundBtn.classList.toggle('off', !sound.enabled);
soundBtn.addEventListener('click', () => soundBtn.classList.toggle('off', !sound.toggle()));

const musicBtn = $('#music-toggle');
musicBtn.classList.toggle('off', !music.enabled);
musicBtn.addEventListener('click', () => musicBtn.classList.toggle('off', !music.toggle()));

// theme was applied before first paint by the inline <head> script
$('#theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('tt.theme', next);
  paintIcons();  // the moon/sun swaps and the ink color changes
  redrawMap();   // day turns to dusk on the map…
  redrawHero();  // …and over the landscape
});

document.addEventListener('runs-changed', renderJourney);

// ---- login gate -----------------------------------------------------------------
// The server owns all save data; localStorage remembers only who you are. Runs
// are fetched once at boot and kept in memory (see records.js), so switching
// tabs is instant and never re-fetches; reload to pull another device's newer
// progress.
function showLogin() {
  $('#login').hidden = false;
  $('#login-name').focus();
}

async function doAuth(fn) {
  const name = $('#login-name').value.trim();
  if (!name) return;
  const err = $('#login-err');
  err.textContent = '';
  try {
    await fn(name);
    $('#login').hidden = true;
    startApp();
  } catch (e) {
    err.textContent = e.message;
  }
}
$('#login-go').onclick = () => doAuth(login);
$('#login-new').onclick = () => doAuth(createUser);
$('#login-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') doAuth(login); });

$('#user-btn').addEventListener('click', () => {
  if (!confirm(`ออกจากระบบ "${currentUser()}" ?`)) return;
  logout();
  location.reload(); // clean slate; boot() lands on the login gate
});

function startApp() {
  const ub = $('#user-btn');
  ub.textContent = `⛩ ${currentUser()}`;
  ub.hidden = false;
  renderJourney();
  music.playHome(); // the front page's own theme; starts on the first gesture
}

async function boot() {
  if (!currentUser()) return showLogin();
  try { // a remembered name the server no longer knows sends you back to the gate
    const res = await fetch(`api/runs?user=${encodeURIComponent(currentUser())}`);
    if (res.status === 400 || res.status === 404) { logout(); return showLogin(); }
  } catch { /* offline: keep the session, views fall back to the last good copy */ }
  startApp();
}

initSpeed();
initGhosts();
initDictationInput();
initMap({ onPlay: startLevel });
paintIcons();
fx.init();
boot();
