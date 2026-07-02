# thai-typing — พิมพ์ไทย

A self-hosted Thai typing trainer, inspired by 10fastfingers: one game for raw
speed, one for spelling by ear. Runs on the NUC, reached through the dashboard
front door at `http://10.7.0.1/thai-typing/`. Build conventions live in
`~/.claude/CLAUDE.md` (johan's global principles) — this repo just applies them.

## The games

**เส้นทาง (the journey)** — 1000 levels of word bursts, walking Thailand south to
north: ten regions of 100 levels, from the Southern Isles to the summit of Doi
Inthanon. Levels are *generated, not stored*: a seeded PRNG samples a
frequency-ordered pool of ~980 words (`web/js/data/words.js`), the window widening
as levels rise — so the data is one plain-text list, every level is deterministic
and replayable, and nothing needs authoring. Every 10th level is a bonus round of
proverbs (`sentences.js`).

The gamification is deliberately self-referential — you compete with yourself only:

- **1 star** = finish with ≥90% accuracy (this is also what unlocks the next level)
- **2 stars** = beat the median of your own last 10 runs
- **3 stars** = beat it by 8% at ≥97% accuracy — always challenging, never impossible
- **PB** = fastest run at ≥95% accuracy, ever; celebrated with a chime and falling
  leaves, and recorded permanently for the graph
- plus a daily streak, a page-count odometer, and short (~1 min) levels so there is
  always time for "just one more"

**ฟัง–พิมพ์ (dictation)** — drop a video/audio file plus a same-named `.srt` into
`media/` (gitignored). The app plays one subtitle cue, you type it from hearing;
each word is judged the instant it is complete — green or red, wrong words are
retyped (with the correct spelling shown after two misses), and missed cues come
back for a review round. Progress per file is resumable.

**เรื่องอ่าน (texts)** — drop any Thai `.txt` into `texts/` (first line = title)
and type through it. This is the "stories" path: source stories anywhere, in plain
text, and they become typing material with zero processing.

## Thai word segmentation

No preprocessing pipeline: browsers ship ICU dictionary-based Thai segmentation
via `Intl.Segmenter` (`web/js/ui.js`). Where the dictionary cuts wrong, put `|`
between words in that subtitle cue (or text) — explicit markers always win. The
dictation setup screen has a per-file "ดูตัวอย่างการตัดคำ" preview to vet cuts
before playing.

## Speed metric

CPM (characters per minute) of correctly typed words — Thai has no spaces, so WPM
is ill-defined. Roughly CPM ÷ 5 if you want a WPM-like number.

## Architecture

- `server.py` — Python stdlib only, one process on `127.0.0.1:8768`: serves the
  static app, lists `media/` + `texts/`, streams media with Range support, and
  appends finished runs to `data/runs.jsonl`.
- `web/` — vanilla HTML/CSS/JS ES modules. No framework, no build step, no npm.
  Key clicks and chimes are synthesized with WebAudio — no sound assets.
- **Design** — Thai and nature throughout, hand-made rather than themed:
  - Type is **Srisakdi** (traditional Thai manuscript style) for display and
    **Sarabun** for text — self-hosted woff2 in `web/assets/fonts/` (SIL OFL,
    from Google Fonts), so nothing is fetched from third parties at runtime.
  - The hero is one layered SVG landscape recolored per region, and each of the
    ten regions gets its own hand-drawn foreground scene — karsts and a
    long-tail boat in the south, mangrove roots, rice terraces with a sala, a
    stilt house, orchards, rainforest vines, a waterfall, cave stalactites,
    misty ridges, and the twin chedis at the summit. Clouds drift, stars
    twinkle at night, petals fall by day and fireflies wander after dark.
  - Ornament is drawn in code: dok-phikun star-flower dividers, a
    lai-kruay-chœng petal band along the water, kranok flame flourishes on the
    results card.
  - Motion (parallax, staggered entrances, modal pops) is choreographed with
    **GSAP**, the one third-party library — a single vendored file
    (`web/vendor/gsap.min.js`, pinned 3.13.0, GreenSock standard license), no
    package manager. Without it, or under `prefers-reduced-motion`, the page
    is simply still; nothing breaks.
- Background music (`music.js` + `instruments.js`): a sampled
  **ensemble playing heterophonically** — the defining texture of Thai music,
  where every instrument performs the same melody at a different density at
  once. Every voice is a **short struck or plucked sound, nothing sustained
  and nothing synthesized**; the space between notes belongs to the nature
  bed. Each of the ten regions has a **hand-composed skeletal melody** (its
  theme, `THEMES` in `music.js`); the khong (marimba) states it plainly, the
  ranat lead (xylophone or balafon, its top kept dark — nothing piercing)
  weaves a division around it that always arrives on the structural notes,
  the kanun plucks patterns — and every third decade *carries the melody
  itself* while the mallets answer — and the soft thon-rammana drums join
  in later decades. One track per 10
  levels: the ten decades of a region are ten realizations of that region's
  theme — tempo, density and instrumentation grow as you walk — so all
  hundred tracks are authored melodies, not dice. No free Thai-instrument
  recordings exist (checked 2026-07), so every voice is a real recording
  (mostly VCSL, CC0; `web/assets/ranat/`, rebuilt by `tools/build-assets.py`)
  cast *by role*, and made Thai by performance: near-7-TET tuning with a
  per-track ±8¢ bar-tuning table, octave doubling with mallet flams, kro
  tremolo rolls at cadences, ching-chap timekeeping and a soft gong at
  sections. Toggle 🎵. The front page has the one piece whose *lead line* is
  written out by hand (`HOME_BARS`), starting on the first click or keypress
  (browsers require a gesture before audio).
  - **The nature collection**: every region's bed is a real field recording,
    cut to a seamless loop by `build-assets.py` (tail crossfaded into head)
    and credited in the manifest — a rippling brook, a waterfall, two
    different dawn choruses, morning birds and breeze over open country,
    mountain wind in the Pyrenees, cave drips, and rain on leaves. Layered
    where the landscape asks (the mangroves get water *and* birds), and
    mixed forward: the bed carries the track, the instruments sit inside it.
  - **Local voice overlay** (`web/assets/lexar/`, gitignored — not
    redistributable): `tools/build-lexar.py` builds the kanun (khim role)
    from the sample library on the Lexar drive, loaded as an optional overlay
    on the committed VCSL set — a fresh clone still sounds complete on the
    dan tranh; this box just sounds better.
- Dark mode ("forest at night") follows the system preference, toggleable with
  🌙/☀️, persisted in localStorage.
- `data/runs.jsonl` — append-only, one JSON object per finished run. **The single
  source of truth**: unlocked levels, stars, PBs, streaks and the graph are all
  derived from it. Gitignored (machine data), but it is your entire history —
  include it in backups. localStorage only caches it and queues offline writes.

## Install / deploy

```sh
./install.sh        # systemd unit + start; idempotent, re-run after changes
```

Registered in the dashboard's `~/dashboard/projects.json` (its nginx proxies
`/thai-typing/` → `127.0.0.1:8768`, prefix stripped — hence relative URLs only in
the app).
