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

The journey is walked on a **pixel-art overworld map** (`web/js/map.js`): one
320×180-pixel canvas scene per region, drawn entirely in code (string-art
sprites + seeded scatter, upscaled crisp by CSS — no image assets), with the
region's 100 levels as stepping stones on a winding path, a little traveler
standing on the next level, and **shrines that unlock the มงคลชีวิต ๓๘
ประการ** — the Mangala Sutta's 38 blessings (`web/js/data/mongkhon.js`). The
sutta's 10 stanzas map one-to-one onto the 10 regions; each shrine opens the
first time its level is passed (derived from `runs.jsonl`, nothing stored),
the results card presents the blessing, ☸ in the journey bar opens the
collection, and ข้อ ๓๘ จิตเกษม waits at level 1000 beside the summit chedi.
`web/maptest.html` is a dev harness for tuning the scenes
(`?r=6&done=655`, `&dark`, `&modal=mk`).

The gamification is deliberately self-referential — you compete with yourself only:

- **Finishing a level unlocks the next** — stars are quality medals on top, they never gate progress
- **1 star** = finish with ≥80% accuracy — accuracy is per keystroke, and Thai's
  stacked vowels/tone marks make that unforgiving (a typical solid run is ~85%)
- **2 stars** = ≥88% accuracy at no less than the median speed of your own last
  10 runs — clean *and* at full speed; each tier is roughly three times rarer
  than the one below
- **3 stars** = ≥93% accuracy, 5% above that median — always challenging,
  never impossible
- stars are re-derived from each run's raw numbers on read (rules in
  `records.js starsFor()`), so refining the rules regrades the whole journey
- **Speed PB** = fastest run at ≥90% accuracy, ever; celebrated with a chime and
  falling leaves, and recorded permanently for the graph
- **Accuracy PB** = your cleanest run ever (≥85%) — the mirror reward, celebrated
  the same way, so slowing down to type accurately is a record too, not just a
  concession. Rewarding the leading indicator (accuracy), not only the lagging
  one (speed), is what keeps the medals pulling the *same* way as the วิธีฝึก guide
- plus a daily streak, a page-count odometer, and short (~1 min) levels so there is
  always time for "just one more"
- **💡 วิธีฝึก** on the journey bar opens a short guide to the one thing that
  matters most — you improve fastest by typing where you *don't* make mistakes.
  Because accuracy here is per keystroke (~10 pts harsher than the usual 95–98%
  typing-pedagogy figure), the guide targets this game's own clean line, **the
  90s**; accuracy builds speed, not the other way round. Bilingual (ไทย/EN toggle).
  The level-end card echoes it: finish below ~85% (a solid run) and it tells you to
  slow down until the mistakes stop, and always offers a way back to
  the map

**ฟัง–พิมพ์ (dictation)** — drop a video/audio file plus a same-named `.srt` into
`media/` (gitignored). The app plays one subtitle cue, you type it from hearing;
each word is judged the instant it is complete — green or red, wrong words are
retyped (with the correct spelling shown after two misses), and missed cues come
back for a review round. Progress per file is resumable.

**เรื่องอ่าน (texts)** — drop any Thai `.txt` into `texts/` (first line = title)
and type through it. This is the "stories" path: source stories anywhere, in plain
text, and they become typing material with zero processing.

**พิมพ์ไล่ผี (the night hunt)** — Typing of the Dead, in Thai folklore terms
(`web/js/ghosts.js`). Ghosts of the Thai pantheon — ผีอำ, ผีปอบ, กระสือ,
นางตานี, กระหัง, drawn as string-art pixel sprites over a painted night
scene — drift out of the dark toward a lit spirit house, each carrying one
word from the same frequency-ordered pool; typing the word through is the
chant that banishes it. The first keystroke locks the nearest matching ghost
(spawns never share a first character), wrong keys are rejected and make the
locked ghost lurch closer, a ghost that reaches the shrine puts out one of
three candles, and after three waves a towering เปรต arrives carrying a whole
proverb, banished a segment at a time. Word length picks the ghost: short
words ride the small quick horrors, long words the big slow ones.

Where the journey trains careful accuracy at your own pace (the clock only
starts when you type), the night hunt trains the other half of fluency —
recall under time pressure, where a typo costs ground instead of a
percentage. Nights are generated like levels: seeded, deterministic,
endless, the word pool widening and the drift quickening as they deepen.
Thai script is unreadable at 320×180, so the words float above the canvas
as real DOM text; the pixels stay pixels. `web/ghosttest.html` is the dev
harness (`?n=5&bot=200&err=0.1` runs a night with a typing bot).

## Thai word segmentation

No preprocessing pipeline: browsers ship ICU dictionary-based Thai segmentation
via `Intl.Segmenter` (`web/js/segment.js`, dependency-free so other
frontends can import it — see below). Where the dictionary cuts wrong, put `|`
between words in that subtitle cue (or text) — explicit markers always win. The
dictation setup screen has a per-file "ดูตัวอย่างการตัดคำ" preview to vet cuts
before playing.

## The Kobo e-ink frontend

A second frontend — a Kobo Clara HD that boots straight into the trainer —
lives in its own repo: [toucans/kobo](https://github.com/toucans/kobo). It
talks to this project only through the server: its build step imports the
word pool and `segment.js` over HTTP, and its runs merge into the same
per-user JSONL via `POST /api/runs`. Nothing is copied between the repos.

## Speed metric

CPM (characters per minute) of correctly typed words — Thai has no spaces, so WPM
is ill-defined. Roughly CPM ÷ 5 if you want a WPM-like number.

## Architecture

- `main.go` — Go stdlib only, one binary on `127.0.0.1:8768`: serves the static
  app, lists `media/` + `texts/`, streams media with Range support, and appends
  finished runs to `<data-dir>/users/<name>.jsonl` (data dir set with `-data`;
  see below).
- `web/` — vanilla HTML/CSS/JS ES modules. No framework, no build step, no npm.
  Key clicks and chimes are synthesized with WebAudio — no sound assets.
- **Design** — Thai and nature throughout, hand-made rather than themed:
  - Type is **Srisakdi** (traditional Thai manuscript style) for display and
    **Sarabun** for text — self-hosted woff2 in `web/assets/fonts/` (SIL OFL,
    from Google Fonts), so nothing is fetched from third parties at runtime.
  - The hero is one pixel-art landscape painted in code (`web/js/hero.js`,
    sharing the map's drawing kit `web/js/pixel.js`): dithered sky, sun or
    moon, drifting clouds, two mountain ridges and water, recolored per
    region, with a hand-placed foreground silhouette for each of the ten
    regions — karsts and a long-tail boat in the south, mangroves on stilt
    roots, rice terraces with a sala, a stilt house, an orchard, rainforest
    canopy, a waterfall, cave stalactites, misty ridges, and the twin chedis
    at the summit (lit gold after dark). Petals fall by day and fireflies
    wander at night on the fx canvas above it.
  - Ornament is drawn in code: dok-phikun star-flower dividers, a
    lai-kruay-chœng petal band along the water, kranok flame flourishes on the
    results card — and the page background is a lai-prajam-yam lattice of the
    same dok-phikun flower with gold diamond dots, woven faint into the paper.
  - Motion (staggered entrances, modal pops) is choreographed with
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
  sections. Toggle with the pixel note button. The front page has the one piece whose *lead line* is
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
  - **Sound rules, learned by ear** (johan's feedback across four engine
    versions — binding for any future music work here):
    1. *Samples only.* Synthesized elements read as synthetic even at pad
       level (the "constant tone"), and synthesized nature reads as noise —
       weather has to be recorded. The only synthesis left is the offline
       fallback voice.
    2. *Short sounds only.* Sustained voices annoy over a typing session:
       recorder, kaval, duduk and bowed psaltery were all tried and retired.
       Struck and plucked only; the nature bed owns the sustain.
    3. *Nothing high-pitched or repetitive-bright.* The glockenspiel was
       rejected as "annoying high-pitched percussion"; the ranat's top now
       folds down below ~1.25 kHz. The soft ching is the one high voice that
       survived. Keep instruments dark; brightness belongs to the birds.
    4. *Nature forward.* The bed carries the track and the instruments sit
       inside it. Reference tracks for the target feel: region 2 breeze and
       region 3 brook ("super chill, nothing that sticks out").
    5. *Specific bans:* the Manhã-fria sea-waves recording ("awful, never
       use"); kanun in the low dark registers (pulled from the caves).
- Dark mode ("forest at night") follows the system preference, toggleable with
  the pixel moon/sun button, persisted in localStorage. The header toggles are
  pixel icons painted in code (`web/js/icons.js`), following the theme's ink.
- `<data-dir>/users/<name>.jsonl` — one append-only run log per user, one JSON
  object per finished run. **The single source of truth**: unlocked levels,
  stars, PBs, streaks and the graph are all derived from it, live from the server
  on every view. It is your entire history. Per the box's data convention it
  lives **outside the repo at `~/keep/thai-typing/`** (the server is pointed there
  with `-data`; defaults to `<repo>/data` for a bare local run) so it's backed up
  as part of `~/keep` — see debian-config → Backups.

## Accounts & the backend, the monk-like way

Accounts are a username and nothing else — no password, no sessions, no
tokens. The site lives behind the WireGuard VPN and the threat model is "me on
three devices", so authentication would be moving parts guarding nothing. The
user list is just the filenames in `data/users/` and is never listed by any
endpoint; `/api/login` answers only for the one name asked about.

The whole backend recipe, transferable to any small project:

1. **One stdlib-only process** serves static app + API. No framework, no pip,
   no database daemon — nothing to update, nothing to rot.
2. **Storage is an append-only `.jsonl` per user.** Appends are atomic enough
   under one process + a lock; no schema migrations, `cat`-able, greppable,
   backed up by copying a file.
3. **Store events, derive state.** Only finished runs are written; stars,
   unlocks, PBs, streaks are computed from the log on read. There is no second
   copy of state to drift out of sync.
4. **The server is the only source of truth.** Clients keep no persistent save
   data (localStorage holds just the username + device prefs like theme) and
   re-fetch on focus — that's the entire multi-device sync story: no cache
   invalidation, no conflict resolution, because nothing conflicts.

This holds as long as writes are append-only events from a handful of trusted
clients. The moment a project needs concurrent mutable state or untrusted
users (e.g. a future multiplayer backend), that's a different shape — real
auth and a real database — not more layers on this one.

Legacy note: pre-account history lived in `data/runs.jsonl`; it was copied
into `data/users/johan.jsonl` when accounts arrived (2026-07) and the old file
now just sits as an archive.

## Install / deploy

```sh
./install.sh        # systemd unit + start; idempotent, re-run after changes
```

Registered in the dashboard's `~/dashboard/projects.json` (its nginx proxies
`/thai-typing/` → `127.0.0.1:8768`, prefix stripped — hence relative URLs only in
the app).

## Public standalone (GitHub Pages)

`docs/` is a **backend-free** build of just the typing drill, published on
GitHub Pages so you can practise from any computer without the VPN. It is
served at `main:/docs` (Settings → Pages → *Deploy from a branch* → `main`,
`/docs`; no GitHub Actions needed). The full app — accounts, the 1000-level
journey, stats, dictation — stays behind the VPN on the NUC; none of its
`api/*` endpoints are reachable from Pages, and the box's server still binds to
`127.0.0.1` only. Pages hosts static files with no path to the box, so
publishing it exposes nothing.

Two things make it work standalone:

- **No login, no levels, no server.** `docs/game.js` is a small self-contained
  loop: an endless word stream sampled by the real generator (`levelWords`), no
  progress saved beyond a local best score in `localStorage`.
- **Any keyboard types Thai.** `docs/kedmanee.js` maps the *physical* key
  (`KeyboardEvent.code`, layout-independent) through the standard Kedmanee Thai
  layout, so a Danish keyboard with no Thai layout installed plays fine — and an
  on-screen keyboard lights the next key to press. Every character in the word
  pool is reachable (the two ANSI-only letters ฃ ฅ aren't in the pool).

`docs/` is a **generated artifact**: the authored files (`index.html`,
`app.css`, `game.js`, `kedmanee.js`) live there, but the shared word/sentence
pools, segmenter, and fonts are copied in from `web/` by the build script so the
source of truth stays single. Rebuild and commit after changing word lists or
fonts:

```sh
./tools/build-pages.sh   # refreshes docs/lib/ and docs/fonts/ from web/
```
