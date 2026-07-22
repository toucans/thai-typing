// Bootstrap and the three "browse" views: journey (level map), texts, stats.
// The play views live in speed.js / dictation.js.
import { loadRuns, stats, pbHistory, currentUser, login, createUser, logout } from './records.js';
import { startLevel, startText, initSpeed, levelSpaces } from './speed.js';
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
    [st.textsRead.toLocaleString('th-TH'),
      `เรื่องอ่านที่พิมพ์จบ${st.textPb ? ` · เร็วสุด ${Math.round(st.textPb)} ตัวอักษร/นาที` : ''}`],
    [st.newsRead.toLocaleString('th-TH'),
      `ข่าวที่พิมพ์จบ${st.newsPb ? ` · เร็วสุด ${Math.round(st.newsPb)} ตัวอักษร/นาที` : ''}`],
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
    <div class="modal-sub">ทุกครั้งที่ความเร็วสูงสุด (แม่นยำ ≥90%) ขยับขึ้น · ตัวอักษร/นาที</div>
    <div class="pb-rows">${rows}</div>
    <div class="play-actions"><button class="btn" id="m-close">ปิด</button></div>`);
  card.querySelector('#m-close').onclick = closeModal;
}

// ---- how to practice ---------------------------------------------------------------
// The one thing that matters most, said briefly, in Thai and English with a
// language toggle: you improve fastest by typing where you don't make mistakes.
const GUIDE = {
  th: {
    lang: 'EN',
    title: '💡 วิธีฝึกให้เก่งเร็วที่สุด',
    intro: 'เร็วเป็นผลพลอยได้จากความแม่น — พิมพ์ที่ความเร็วที่ “ไม่ผิด” ไว้ก่อน แล้วความเร็วจะตามมาเอง',
    points: [
      ['🧠 สมองจำสิ่งที่นิ้วทำจริง ๆ',
        'พิมพ์ถูกคือการสร้างทางเดินสะอาดจากความคิดไปถึงนิ้ว เร่งจนพิมพ์ผิดแล้วกด Backspace = ฝึกให้พิมพ์ผิดซ้ำ ฝังนิสัยเสียลงในกล้ามเนื้อ'],
      ['🎯 รักษาความแม่นให้อยู่ในช่วง 90 กว่า ๆ',
        'ไม่ต้องเป๊ะ 100% จนเกร็ง ที่นี่นับทุกครั้งที่กดผิด (แม้ลบแล้วพิมพ์ใหม่) แม่น 90% ขึ้นไปก็ถือว่าพิมพ์สะอาดแล้ว ถ้าหล่นไปแถว 80 ต้น ๆ แปลว่าเร็วเกินกว่าที่สมองจะจดจำการเคลื่อนไหวทัน ให้ผ่อนความเร็วลงจนหยุดผิด'],
      ['🌊 นิ่ง ๆ นั่นแหละเร็ว',
        'คนพิมพ์เร็วที่สุดดูผ่อนคลาย จังหวะสม่ำเสมอเหมือนเมโทรนอม เมื่อนิ้วรู้ตำแหน่งอักษรเอง มือจะเร่งเร็วขึ้นเอง ปล่อยให้ความแม่นสร้างความเร็วให้'],
    ],
    close: 'เข้าใจแล้ว',
  },
  en: {
    lang: 'ไทย',
    title: '💡 How to practice — the fastest way to improve',
    intro: 'Speed is a by-product of accuracy. Type at a pace where you don’t make mistakes, and speed follows on its own.',
    points: [
      ['🧠 Your brain remembers what your fingers actually do',
        'Typing accurately burns a clean path from thought to finger. Racing, mistyping, then hitting backspace trains your hands to make that same typo again — cementing bad habits into muscle memory.'],
      ['🎯 Keep your accuracy in the 90s',
        'You don’t need tense, 100% perfection. This trainer counts every stray keystroke — even ones you delete and retype — so 90%+ already means a clean, well-grooved run. Slip into the low 80s and you’re moving too fast for your brain to lay down the movement — ease off until the mistakes stop.'],
      ['🌊 Smooth is fast',
        'The fastest typists look relaxed, keeping a steady, metronome-like rhythm. Once your fingers know where the Thai letters are, your hands accelerate on their own. Let accuracy build the speed.'],
    ],
    close: 'Got it',
  },
};

function showGuide(lang = 'th') {
  const g = GUIDE[lang];
  const pts = g.points.map(([h, b]) =>
    `<div class="guide-pt"><b>${h}</b><p>${b}</p></div>`).join('');
  const card = modal(`
    <div class="guide-head">
      <h2>${g.title}</h2>
      <button class="btn ghost sm" id="guide-lang">${g.lang}</button>
    </div>
    <p class="guide-intro">${g.intro}</p>
    ${pts}
    <div class="play-actions"><button class="btn gold" id="m-close">${g.close}</button></div>`);
  card.querySelector('#guide-lang').onclick = () => showGuide(lang === 'th' ? 'en' : 'th');
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

// ---- news ----------------------------------------------------------------------------
// เรื่องอ่าน's live source: real Thai headlines+leads the Go server pulls as RSS.
// Kept in memory once fetched (like runs) so tab-switching is instant; the refresh
// button forces a re-fetch. Sources are kept apart — chips pick one สำนักข่าว and
// the list shows only its stories, never a mixed feed. External feed text is
// untrusted, so it is placed with textContent, never innerHTML.
let newsCache = null, newsSource = null;
async function renderNews(force) {
  const list = $('#news-list'), status = $('#news-status'), btn = $('#news-refresh'), chips = $('#news-sources');
  if (!newsCache || force) {
    list.innerHTML = '<p class="hint">กำลังดึงข่าว…</p>';
    status.textContent = ''; chips.innerHTML = '';
    btn.disabled = true;
    try { newsCache = await (await fetch('api/news')).json(); } catch { newsCache = null; }
    newsSource = null; // re-pick the default source against the fresh pull
    btn.disabled = false;
  }
  if (!newsCache || !newsCache.items || !newsCache.items.length) {
    chips.innerHTML = '';
    list.innerHTML = '<p class="hint">ดึงข่าวไม่สำเร็จ — ลองกด “ดึงข่าวล่าสุด” อีกครั้ง</p>';
    return;
  }

  // your own history feeds the stats: lifetime totals, per-source typed counts,
  // and which headlines you've already typed (kept in memory, cheap to re-derive)
  const st = stats(await loadRuns());

  const count = (s) => newsCache.items.filter((i) => i.source === s).length;
  const sources = newsCache.sources?.length
    ? newsCache.sources : [...new Set(newsCache.items.map((i) => i.source))];
  // default to the first source that actually returned stories
  if (!newsSource || !sources.includes(newsSource) || !count(newsSource)) {
    newsSource = sources.find(count) || sources[0];
  }

  // lifetime news stats, in the same stat-card language as the สถิติ page
  const statStrip = $('#news-stats');
  if (st.newsRead) {
    const pages = Math.max(1, Math.round(st.newsChars / 1800));
    const cards = [
      [st.newsRead.toLocaleString('th-TH'), 'ข่าวที่พิมพ์แล้ว'],
      [st.newsPb ? Math.round(st.newsPb) : '–', 'เร็วสุด (ตัวอักษร/นาที)'],
      [st.newsChars.toLocaleString('th-TH'), `ตัวอักษรจากข่าว · ≈ ${pages} หน้า`],
    ];
    statStrip.innerHTML = cards.map(([num, label]) =>
      `<div class="stat"><div class="stat-num">${num}</div><div class="stat-label">${label}</div></div>`).join('');
    statStrip.hidden = false;
  } else {
    statStrip.hidden = true; // nothing typed yet — no empty strip
  }

  // source chips: one สำนักข่าว at a time; the small line shows how many stories
  // are available now and, once you've typed some, a ✓ tally from this source
  chips.innerHTML = '';
  for (const s of sources) {
    const n = count(s);
    const typed = st.newsBySource[s] || 0;
    const chip = document.createElement('button');
    chip.className = 'chip' + (s === newsSource ? ' sel' : '') + (n ? '' : ' locked');
    chip.innerHTML = `${s} <small>${n}${typed ? ` · ✓${typed}` : ''}</small>`;
    if (n) chip.onclick = () => { newsSource = s; renderNews(); };
    chips.appendChild(chip);
  }

  const when = newsCache.fetchedAt ? relTime(newsCache.fetchedAt) : '';
  status.innerHTML = `<span><b>${newsSource}</b> · ${count(newsSource)} เรื่อง</span>`
    + (when ? `<span>${newsCache.stale ? '⚠ ' : ''}อัปเดตเมื่อ ${when}</span>` : '');

  const tfmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  list.innerHTML = '';
  for (const a of newsCache.items.filter((i) => i.source === newsSource)) {
    const typed = st.newsTitles.has(a.title);
    const card = document.createElement('button');
    card.className = 'mediacard newscard' + (typed ? ' typed' : '');
    const meta = document.createElement('span');
    meta.className = 'news-src';
    meta.textContent = (typed ? '✓ ' : '') + a.source + (a.t ? ' · ' + tfmt.format(new Date(a.t)) : '');
    const h = document.createElement('b'); h.textContent = a.title;         // untrusted: textContent
    const lead = document.createElement('small'); lead.textContent = a.lead; // untrusted: textContent
    card.append(meta, h, lead);
    card.onclick = () => {
      const body = a.lead && a.lead.length > a.title.length ? a.lead : a.title;
      const { words, breaks } = segmentThaiBreaks(body);
      startText('ข่าว: ' + a.title, `📰 ${a.title}`, words, breaks, { backView: 'news', run: { src: a.source } });
    };
    list.appendChild(card);
  }
}

function relTime(ms) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'สักครู่ที่ผ่านมา';
  const m = Math.round(s / 60); if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.round(m / 60); if (h < 24) return `${h} ชั่วโมงที่แล้ว`;
  return `${Math.round(h / 24)} วันที่แล้ว`;
}

// ---- boot ---------------------------------------------------------------------------
const renderers = { journey: renderJourney, stats: renderStats, texts: renderTexts, news: renderNews, ghosts: renderGhosts, dictation: null };

for (const b of document.querySelectorAll('#nav button')) {
  b.addEventListener('click', () => {
    show(b.dataset.view);
    const r = renderers[b.dataset.view];
    if (r) r();
    if (b.dataset.view === 'dictation') initDictation();
  });
}

$('#guide-btn').addEventListener('click', () => showGuide());
$('#news-refresh').addEventListener('click', () => renderNews(true));

// เส้นทาง levels run words together like real prose by default (matching
// เรื่องอ่าน); this toggle brings the spaces between words back
const spaceBtn = $('#space-toggle');
const paintSpaceBtn = (on) => { spaceBtn.textContent = `เว้นวรรค: ${on ? 'เปิด' : 'ปิด'}`; };
paintSpaceBtn(levelSpaces.enabled);
spaceBtn.addEventListener('click', () => paintSpaceBtn(levelSpaces.toggle()));

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

document.addEventListener('runs-changed', () => {
  renderJourney();
  // a finished ข่าว run returns to this tab via the modal, which doesn't re-run
  // the renderer — refresh the (possibly hidden) news view so its stats are
  // current when revealed. No-op fetch: renderNews() without force reuses the
  // in-memory feed.
  if (newsCache) renderNews();
});

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
