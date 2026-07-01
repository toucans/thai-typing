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
  Key clicks and chimes are synthesized with WebAudio — no sound assets. So is the
  background music (`music.js`): one generative ambient soundscape per 10 levels,
  seeded by the decade — pentatonic plucks and pads over a nature layer that
  follows the region (waves, rain, stream, wind, cave drips). 100 deterministic
  "tracks", zero audio files. Toggle with 🎵.
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
