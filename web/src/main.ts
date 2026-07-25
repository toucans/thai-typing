// Bootstrap and the three "browse" views: journey (level map), texts, stats.
// The play views live in speed.ts / dictation.ts.
import { loadRuns, stats, pbHistory, currentUser, login, createUser, logout } from './records.ts';
import { startLevel, startText, initSpeed, levelSpaces } from './speed.ts';
import { initDictation, initDictationInput } from './dictation.ts';
import { initReader, startArticle } from './reader.ts';
import { renderChart } from './chart.ts';
import { sound } from './audio.ts';
import { music } from './music.ts';
import { fx } from './fx.ts';
import { $, show, modal, closeModal, on, setRegion, segmentThaiBreaks, REGIONS, REGION_SIZE, TOTAL_LEVELS } from './ui.ts';
import { initMap, drawMap, redrawMap, showMongkhon } from './map.ts';
import { redrawHero } from './hero.ts';
import { paintIcons } from './icons.ts';
import { thaiNum, unlockedCount } from './data/mongkhon.ts';
import type { Stats } from './records.ts';
import type { Article, NewsFeed, NewsItem, TextFile, TypingRun } from './types.ts';

let selRegion: number | null = null; // region the user is browsing (defaults to where they are)

// ---- journey ------------------------------------------------------------------
async function renderJourney(): Promise<void> {
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
    if (!locked) chip.onclick = () => { selRegion = i; void renderJourney(); };
    chips.appendChild(chip);
  });

  drawMap({ region: selRegion ?? 0, next, maxDone: st.maxDone, starsByLevel: st.starsByLevel });
  fx.mapIn($('#mapwrap'));
}

function countDone(st: Stats, region: number): number {
  // unlocking is sequential, so everything up to maxDone is passed — with or
  // without stars
  return Math.max(0, Math.min(REGION_SIZE, st.maxDone - region * REGION_SIZE));
}

// ---- stats ----------------------------------------------------------------------
async function renderStats(): Promise<void> {
  const runs = await loadRuns();
  const st = stats(runs);
  const hours = Math.floor(st.totalSecs / 3600);
  const mins = Math.round((st.totalSecs % 3600) / 60);
  const pbDate = st.pbAt
    ? new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short' }).format(new Date(st.pbAt)) : '';
  const cards: [string | number, string][] = [
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
    [st.dictOwed.size.toLocaleString('th-TH'), 'คำที่ยังสะกดไม่ได้ · ยกไปทบทวนรอบหน้า'],
  ];
  $('#stat-cards').innerHTML = cards.map(([num, label]) =>
    `<div class="stat"><div class="stat-num">${num}</div><div class="stat-label">${label}</div></div>`).join('');
  renderChart($('#chart'), runs);
  const pbs = pbHistory(runs);
  const btn = $<HTMLButtonElement>('#pb-list-btn');
  btn.disabled = !pbs.length;
  btn.onclick = () => showPbHistory(pbs);
}

// Every day the record moved, as a list you can actually read — the gold dots
// on the chart, spelled out: when, at which level, and by how much.
function showPbHistory(pbs: TypingRun[]): void {
  const dfmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
  const tfmt = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit' });
  const rows = pbs.map((r, i) => {
    const d = new Date(r.t);
    const prev = pbs[i - 1];
    const gain = prev ? `+${Math.round((r.cpm - prev.cpm) * 10) / 10}` : 'ครั้งแรก';
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
  on(card, '#m-close', closeModal);
}

// ---- how to practice ---------------------------------------------------------------
// The one thing that matters most, said briefly, in Thai and English with a
// language toggle: you improve fastest by typing where you don't make mistakes.
interface GuideText {
  lang: string;
  title: string;
  intro: string;
  points: [string, string][];
  close: string;
}

const GUIDE: Record<'th' | 'en', GuideText> = {
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

function showGuide(lang: 'th' | 'en' = 'th'): void {
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
  on(card, '#guide-lang', () => showGuide(lang === 'th' ? 'en' : 'th'));
  on(card, '#m-close', closeModal);
}

// ---- free texts --------------------------------------------------------------------
async function renderTexts(): Promise<void> {
  const list = $('#texts-list');
  let texts: TextFile[] = [];
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
let newsCache: NewsFeed | null = null;
let newsSource: string | null = null;
let newsPage: 'feed' | 'done' = 'feed';
async function renderNews(force = false): Promise<void> {
  const list = $('#news-list'), status = $('#news-status'), chips = $('#news-sources');
  const btn = $<HTMLButtonElement>('#news-refresh');
  if (!newsCache || force) {
    list.innerHTML = '<p class="hint">กำลังดึงข่าว…</p>';
    status.textContent = ''; chips.innerHTML = '';
    btn.disabled = true;
    try { newsCache = await (await fetch('api/news')).json(); } catch { newsCache = null; }
    newsSource = null; // re-pick the default source against the fresh pull
    btn.disabled = false;
  }
  // your own history feeds the stats: lifetime totals, per-source typed counts,
  // and which headlines you've already typed (kept in memory, cheap to re-derive)
  const runs = await loadRuns();
  const st = stats(runs);

  // the reading log is the view's second page: the same card grid, but showing
  // every article you've typed to the end. The ✓ button flips between the two.
  // Wired before the feed check — your history is yours even when feeds are down.
  const newsRuns = runs.filter((r): r is TypingRun =>
    r.game === 'text' && (r.name || '').startsWith('ข่าว: '));
  if (!newsRuns.length) newsPage = 'feed';
  const doneBtn = $<HTMLButtonElement>('#news-done-btn');
  doneBtn.disabled = !newsRuns.length;
  doneBtn.textContent = newsPage === 'done' ? '← ข่าวล่าสุด' : '✓ ข่าวที่พิมพ์จบ';
  doneBtn.onclick = () => { newsPage = newsPage === 'feed' ? 'done' : 'feed'; void renderNews(); };

  // lifetime news stats, in the same stat-card language as the สถิติ page —
  // shown on both pages (the feed and the reading log)
  const statStrip = $('#news-stats');
  if (st.newsRead) {
    const pages = Math.max(1, Math.round(st.newsChars / 1800));
    const cards: [string | number, string][] = [
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

  if (newsPage === 'done') return renderNewsDone(newsRuns, list, status, chips);

  const feed = newsCache;
  if (!feed || !feed.items || !feed.items.length) {
    chips.innerHTML = '';
    list.innerHTML = '<p class="hint">ดึงข่าวไม่สำเร็จ — ลองกด “ดึงข่าวล่าสุด” อีกครั้ง</p>';
    return;
  }

  const items = feed.items;
  const count = (s: string) => items.filter((i) => i.source === s).length;
  const sources = feed.sources?.length
    ? feed.sources : [...new Set(items.map((i) => i.source))];
  // default to the first source that actually returned stories
  if (!newsSource || !sources.includes(newsSource) || !count(newsSource)) {
    newsSource = sources.find(count) ?? sources[0] ?? null;
  }
  if (!newsSource) return;
  const source = newsSource;

  // source chips: one สำนักข่าว at a time; the small line shows how many stories
  // are available now and, once you've typed some, a ✓ tally from this source
  chips.innerHTML = '';
  for (const s of sources) {
    const n = count(s);
    const typed = st.newsBySource[s] || 0;
    const chip = document.createElement('button');
    chip.className = 'chip' + (s === source ? ' sel' : '') + (n ? '' : ' locked');
    chip.innerHTML = `${s} <small>${n}${typed ? ` · ✓${typed}` : ''}</small>`;
    if (n) chip.onclick = () => { newsSource = s; void renderNews(); };
    chips.appendChild(chip);
  }

  const when = feed.fetchedAt ? relTime(feed.fetchedAt) : '';
  status.innerHTML = `<span><b>${source}</b> · ${count(source)} เรื่อง</span>`
    + (when ? `<span>${feed.stale ? '⚠ ' : ''}อัปเดตเมื่อ ${when}</span>` : '');

  const tfmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  list.innerHTML = '';
  for (const a of items.filter((i) => i.source === source)) {
    const typed = st.newsTitles.has(a.title);
    const card = document.createElement('button');
    card.className = 'mediacard newscard' + (typed ? ' typed' : '');
    const meta = document.createElement('span');
    meta.className = 'news-src';
    meta.textContent = (typed ? '✓ ' : '') + a.source + (a.t ? ' · ' + tfmt.format(new Date(a.t)) : '');
    const h = document.createElement('b'); h.textContent = a.title;         // untrusted: textContent
    const lead = document.createElement('small'); lead.textContent = a.lead; // untrusted: textContent
    card.append(meta, h, lead);
    card.onclick = () => void openArticle(a, card, meta);
    list.appendChild(card);
  }
}

// The reading log page: the same card grid as the feed, one card per article
// typed to the end (deduped, newest first) — ✓ สำนักข่าว · date typed over the
// headline, your best pace below, ×n when retyped. A story still in today's
// feed stays clickable to type again; older ones are plain records. Titles are
// feed text, so everything is placed with textContent — never innerHTML.
interface DoneStory {
  title: string;
  src: string;
  t: string;
  cpm: number;
  n: number;
}

function renderNewsDone(newsRuns: TypingRun[], list: HTMLElement, status: HTMLElement,
  chips: HTMLElement): void {
  const byTitle = new Map<string, DoneStory>(); // runs are chronological: the last write wins on t
  for (const r of newsRuns) {
    const title = (r.name || '').replace(/^ข่าว: /, '');
    const prev = byTitle.get(title);
    byTitle.set(title, {
      title, src: r.src || '—', t: r.t,
      cpm: Math.max(r.cpm || 0, prev ? prev.cpm : 0), n: (prev ? prev.n : 0) + 1,
    });
  }
  const items = [...byTitle.values()].sort((a, b) => b.t.localeCompare(a.t));

  chips.innerHTML = '';
  status.innerHTML = `<span><b>ข่าวที่พิมพ์จบ</b> · ${items.length.toLocaleString('th-TH')} เรื่อง</span>`;

  const tfmt = new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  list.innerHTML = '';
  for (const a of items) {
    const live = newsCache?.items?.find((i) => i.title === a.title); // still in the feed → retypeable
    const card = document.createElement('button');
    card.className = 'mediacard newscard done';
    const meta = document.createElement('span');
    meta.className = 'news-src';
    meta.textContent = `✓ ${a.src} · ${tfmt.format(new Date(a.t))}`; // src is feed text: textContent
    const h = document.createElement('b'); h.textContent = a.title;   // untrusted: textContent
    const sub = document.createElement('small');
    sub.textContent = `เร็วสุด ${Math.round(a.cpm)} ตัวอักษร/นาที`
      + (a.n > 1 ? ` · พิมพ์ ${a.n} ครั้ง` : '')
      + (live ? ' · แตะเพื่อพิมพ์อีกครั้ง' : '');
    card.append(meta, h, sub);
    if (live) card.onclick = () => void openArticle(live, card, meta);
    else card.disabled = true;
    list.appendChild(card);
  }
}

// Opening a story fetches the full article (server-extracted and disk-cached)
// and reads it in the reader view. If the source can't give a real article
// right now — server down, extraction refused — fall back to the old path:
// the RSS lead through the wordstream. A story is never a dead card.
async function openArticle(a: NewsItem, card: HTMLButtonElement, meta: HTMLElement): Promise<void> {
  const was = meta.textContent;
  meta.textContent = 'กำลังเปิดข่าว…';
  card.disabled = true;
  let art: Article | null = null;
  try {
    const res = await fetch(`api/article?src=${encodeURIComponent(a.source)}&link=${encodeURIComponent(a.link)}`);
    art = await res.json();
  } catch { /* offline / server error: fall back below */ }
  meta.textContent = was;
  card.disabled = false;
  if (art?.ok && art.paragraphs?.length) {
    startArticle(art, a);
  } else {
    const body = a.lead && a.lead.length > a.title.length ? a.lead : a.title;
    const { words, breaks } = segmentThaiBreaks(body);
    startText('ข่าว: ' + a.title, `📰 ${a.title}`, words, breaks, { backView: 'news', run: { src: a.source } });
  }
}

function relTime(ms: number): string {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'สักครู่ที่ผ่านมา';
  const m = Math.round(s / 60); if (m < 60) return `${m} นาทีที่แล้ว`;
  const h = Math.round(m / 60); if (h < 24) return `${h} ชั่วโมงที่แล้ว`;
  return `${Math.round(h / 24)} วันที่แล้ว`;
}

// ---- boot ---------------------------------------------------------------------------
const renderers: Record<string, (() => Promise<void>) | undefined> = {
  journey: renderJourney, stats: renderStats, texts: renderTexts, news: renderNews,
};

for (const b of document.querySelectorAll<HTMLElement>('#nav button')) {
  b.addEventListener('click', () => {
    const view = b.dataset.view;
    if (!view) return;
    show(view);
    void renderers[view]?.();
    if (view === 'dictation') void initDictation();
  });
}

$('#guide-btn').addEventListener('click', () => showGuide());
$('#news-refresh').addEventListener('click', () => void renderNews(true));

// เส้นทาง levels run words together like real prose by default (matching
// เรื่องอ่าน); this toggle brings the spaces between words back
const spaceBtn = $('#space-toggle');
const paintSpaceBtn = (enabled: boolean) => { spaceBtn.textContent = `เว้นวรรค: ${enabled ? 'เปิด' : 'ปิด'}`; };
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
  void renderJourney();
  // a finished ข่าว run returns to this tab via the modal, which doesn't re-run
  // the renderer — refresh the (possibly hidden) news view so its stats are
  // current when revealed. No-op fetch: renderNews() without force reuses the
  // in-memory feed.
  if (newsCache) void renderNews();
});

// ---- login gate -----------------------------------------------------------------
// The server owns all save data; localStorage remembers only who you are. Runs
// are fetched once at boot and kept in memory (see records.ts), so switching
// tabs is instant and never re-fetches; reload to pull another device's newer
// progress.
function showLogin(): void {
  $('#login').hidden = false;
  $('#login-name').focus();
}

async function doAuth(fn: (name: string) => Promise<string>): Promise<void> {
  const name = $<HTMLInputElement>('#login-name').value.trim();
  if (!name) return;
  const err = $('#login-err');
  err.textContent = '';
  try {
    await fn(name);
    $('#login').hidden = true;
    startApp();
  } catch (e) {
    err.textContent = e instanceof Error ? e.message : 'เชื่อมต่อไม่ได้';
  }
}
$('#login-go').onclick = () => void doAuth(login);
$('#login-new').onclick = () => void doAuth(createUser);
$('#login-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') void doAuth(login); });

$('#user-btn').addEventListener('click', () => {
  if (!confirm(`ออกจากระบบ "${currentUser()}" ?`)) return;
  logout();
  location.reload(); // clean slate; boot() lands on the login gate
});

function startApp(): void {
  const ub = $('#user-btn');
  ub.textContent = `⛩ ${currentUser()}`;
  ub.hidden = false;
  void renderJourney();
  music.playHome(); // the front page's own theme; starts on the first gesture
}

async function boot(): Promise<void> {
  if (!currentUser()) return showLogin();
  try { // a remembered name the server no longer knows sends you back to the gate
    const res = await fetch(`api/runs?user=${encodeURIComponent(currentUser() ?? '')}`);
    if (res.status === 400 || res.status === 404) { logout(); return showLogin(); }
  } catch { /* offline: keep the session, views fall back to the last good copy */ }
  startApp();
}

initSpeed();
initReader();
initDictationInput();
initMap({ onPlay: startLevel });
paintIcons();
fx.init();
void boot();
