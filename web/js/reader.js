// The ข่าว reader: a full news article laid out like the front page it came
// from — byline, Srisakdi headline, gold rule, hero photo, body paragraphs —
// typed through in place, start to finish. The typing model and scoring are
// speed.js's exactly (same keystroke accounting, same finishSession, same run
// record), only the surface differs: words are spans inside real paragraphs,
// upcoming text stays fully readable (you're reading an article, not drilling),
// and the page scrolls down the column as you type.
//
// Every article field is untrusted external text: placed with textContent
// only. The one exception is the image src, which is the same-origin cached
// path the server controls (api/news-image?h=…).
import { sound } from './audio.js';
import { music } from './music.js';
import { $, show } from './ui.js';
import { segmentThaiBreaks } from './segment.js';
import { finishSession } from './speed.js';

let R = null; // current reader session (speed.js-shaped, plus spans/paraEnd)

// startArticle(art, item): art is the /api/article payload, item the RSS card
// it was opened from. The run is named after the RSS title — that exact string
// is what records.js matches against the list to mark stories typed.
export function startArticle(art, item) {
  const name = 'ข่าว: ' + item.title;
  R = {
    mode: 'text', name, title: '📰 ' + (art.headline || item.title),
    backView: 'news', extra: { src: item.source },
    words: [], breaks: [], paraEnd: [], spans: [], skip: [],
    idx: 0, keys: 0, wrong: 0, correctChars: 0, t0: null, done: false,
    restart: () => startArticle(art, item),
  };

  // ---- the article page -------------------------------------------------
  const meta = $('#reader-byline');
  meta.textContent = item.source + (art.dateISO ? ' · ' + fmtDate(art.dateISO) : '');
  $('#reader-headline').textContent = art.headline || item.title;

  const img = $('#reader-hero-img');
  if (art.image) { img.src = art.image; img.hidden = false; } else { img.hidden = true; img.removeAttribute('src'); }

  $('#reader-partial').hidden = !art.partial;

  const body = $('#reader-body');
  body.innerHTML = ''; // then filled with created elements + textContent only
  for (const paraText of art.paragraphs) {
    const { words, breaks } = segmentThaiBreaks(paraText);
    if (!words.length) continue;
    const p = document.createElement('p');
    words.forEach((w, i) => {
      const sp = document.createElement('span');
      sp.textContent = w;
      if (breaks[i]) sp.classList.add('brk');
      p.appendChild(sp);
      R.words.push(w);
      R.breaks.push(breaks[i]);
      R.paraEnd.push(i === words.length - 1);
      R.spans.push(sp);
      // you type the Thai; tokens with none of it — English names, numbers,
      // percentages, dashes — are read, not typed: passed over automatically
      R.skip.push(!/[฀-๿]/.test(w));
    });
    body.appendChild(p);
  }
  if (!R.words.length || R.skip.every(Boolean)) { show('news'); return; } // nothing typeable

  passSkips();
  R.spans[R.idx].classList.add('cur');
  paintProgress();

  show('reader');
  music.playForName(name);
  const box = $('#reader-typebox');
  box.value = '';
  box.focus();
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return new Intl.DateTimeFormat('th-TH', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(d);
}

function paintProgress() {
  $('#reader-progress').style.width = `${(R.idx / R.words.length) * 100}%`;
  $('#reader-count').textContent = `${R.idx}/${R.words.length} คำ`;
}

// Keep the current word in the comfortable reading band (~40% down the
// viewport) — the page scrolls like reading down a newspaper column.
function scrollCurrent() {
  const sp = R.spans[R.idx];
  if (!sp) return;
  const top = sp.getBoundingClientRect().top;
  if (top > innerHeight * 0.55 || top < innerHeight * 0.18) {
    scrollBy({ top: top - innerHeight * 0.4, behavior: 'smooth' });
  }
}

// Step over skip words (no Thai to type): marked passed, never scored — they
// don't add to correctChars, so cpm stays a measure of what you actually typed.
function passSkips() {
  while (R.idx < R.words.length && R.skip[R.idx]) {
    R.spans[R.idx].classList.add('skip');
    R.idx++;
  }
}

function commitWord(typed) {
  const target = R.words[R.idx];
  const sp = R.spans[R.idx];
  sp.classList.remove('cur', 'bad');
  const ok = typed === target;
  sp.classList.add(ok ? 'ok' : 'err');
  if (ok) { R.correctChars += target.length; sound.word(); } else { sound.error(); }
  R.idx++;
  passSkips();
  paintProgress();
  if (R.idx >= R.words.length) { R.done = true; return finishSession(R); }
  R.spans[R.idx].classList.add('cur');
  scrollCurrent();
}

export function initReader() {
  const box = $('#reader-typebox');
  box.addEventListener('input', (e) => {
    if (!R || R.done) return;
    const v = box.value;
    if (!R.t0 && v.trim()) R.t0 = performance.now(); // clock starts on the first key
    if (v.endsWith(' ')) {
      const typed = v.trim().normalize('NFC');
      box.value = '';
      if (typed) commitWord(typed);
      return;
    }
    const target = R.words[R.idx];
    const nv = v.normalize('NFC');
    if (e.data) { // a real inserted character (not backspace)
      R.keys++;
      const pos = v.length - 1;
      if (nv[pos] === target[pos]) sound.click();
      else { R.wrong++; sound.thud(); }
    }
    R.spans[R.idx].classList.toggle('bad', !target.startsWith(nv));
    // Thai prose runs words together: a finished word advances on its own.
    // A space is only demanded at the source's real word-gaps — except at a
    // paragraph's end, which always auto-advances so the flow never stalls.
    if (nv === target && (!R.breaks[R.idx] || R.paraEnd[R.idx])) {
      box.value = '';
      commitWord(nv);
    }
  });
  // the input is visually hidden; touching the article brings the keyboard back
  $('#reader-page').addEventListener('click', () => { if (R && !R.done) box.focus(); });
  $('#reader-quit').addEventListener('click', () => {
    R = null;
    show('news');
  });
}
