// Bootstrap and the three "browse" views: journey (level map), texts, stats.
// The play views live in speed.js / dictation.js.
import { loadRuns, stats } from './records.js';
import { startLevel, startText, initSpeed } from './speed.js';
import { initDictation, initDictationInput } from './dictation.js';
import { renderChart } from './chart.js';
import { sound } from './audio.js';
import { music } from './music.js';
import { fx } from './fx.js';
import { $, show, setRegion, segmentThai, REGIONS, REGION_SIZE, TOTAL_LEVELS } from './ui.js';

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

  const grid = $('#level-grid');
  grid.innerHTML = '';
  for (let i = 1; i <= REGION_SIZE; i++) {
    const level = selRegion * REGION_SIZE + i;
    const starCount = st.starsByLevel.get(level) || 0;
    const cell = document.createElement('div');
    cell.className = 'lvl'
      + (level % 10 === 0 ? ' bonus' : '')
      + (starCount ? ' done' : level === next ? ' cur' : level > next ? ' locked' : '');
    cell.innerHTML = `<div>${level}</div>` +
      (starCount ? `<div class="stars">${'★'.repeat(starCount)}</div>` : '');
    if (level <= next) cell.onclick = () => startLevel(level);
    grid.appendChild(cell);
  }
  fx.gridIn(grid);
}

function countDone(st, region) {
  let n = 0;
  for (let i = 1; i <= REGION_SIZE; i++) {
    if (st.starsByLevel.has(region * REGION_SIZE + i)) n++;
  }
  return n;
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
  ];
  $('#stat-cards').innerHTML = cards.map(([num, label]) =>
    `<div class="stat"><div class="stat-num">${num}</div><div class="stat-label">${label}</div></div>`).join('');
  renderChart($('#chart'), runs);
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
      startText(t.name, t.title, segmentThai(body));
    };
    list.appendChild(card);
  }
}

// ---- boot ---------------------------------------------------------------------------
const renderers = { journey: renderJourney, stats: renderStats, texts: renderTexts, dictation: null };

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
const themeBtn = $('#theme-toggle');
function themeIcon() { themeBtn.textContent = document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙'; }
themeIcon();
themeBtn.addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem('tt.theme', next);
  themeIcon();
});

document.addEventListener('runs-changed', () => { loadRuns(); renderJourney(); });

initSpeed();
initDictationInput();
fx.init();
renderJourney();
music.playHome(); // the front page's own theme; starts on the first gesture
