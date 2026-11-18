# thai-typing — พิมพ์ไทย

A self-hosted Thai typing trainer, inspired by 10fastfingers: one game for raw
speed, one for spelling by ear. Runs on the NUC behind the dashboard front door at
`http://10.7.0.1/thai-typing/`. Build conventions: johan's global
`~/.claude/CLAUDE.md`.

## The games

**เส้นทาง (the journey)**: 1000 levels of word bursts, walking Thailand south to
north in ten regions of 100 levels. Levels are generated, not stored: a seeded PRNG
samples a frequency-ordered word pool (`web/src/data/words.ts`), so every level is
deterministic and nothing needs authoring. Every 10th level is proverbs. The map
(`web/src/map.ts`) is pixel art drawn in code, with shrines unlocking the Mangala
Sutta's 38 blessings (`data/mongkhon.ts`), one stanza per region, derived from the
run log.

You compete only with yourself:

- Finishing a level unlocks the next; stars are medals and never gate progress.
- Stars: ≥80% accuracy; ≥88% at your median speed of the last 10 runs; ≥93% at 5%
  above it. Accuracy is per keystroke, so Thai's stacked marks make ~85% a solid
  run. Stars are re-derived on read (`starsFor()` in `records.ts`), so changing the
  rules regrades the whole journey.
- Two PBs: speed (at ≥90% accuracy) and accuracy (≥85%). Rewarding accuracy too
  keeps the medals pulling the same way as the วิธีฝึก guide: type where you
  don't make mistakes, and speed follows.

**ฟัง–พิมพ์ (dictation)**: drop a video/audio file plus a same-named `.srt` into
`media/` (gitignored). ดูแล้วพิมพ์ shows the cue to copy-type; ฟังแล้วพิมพ์ hides
it and is the spelling trainer.

- **Cues play past their `end`**, because subtitle timings are display windows,
  not speech boundaries (43% of cues in the test episode run over). See
  `playWindows` in `dictation.ts`.
- **Resumable**, because an episode takes several evenings. The cursor is posted
  every ~20s and on `pagehide`, and mirrored in `localStorage`; resume takes the
  further of the two. It lives in `<data-dir>/users/<name>.resume.json`, not the
  run log, because it is mutable state, not an event.
- **Leaving ends a round.** There is no end button: switching view or closing the
  tab writes the run, so the next session's carry-over never depends on pressing
  something. A round counts if you *answered* anything, even with zero score
  (a ทบทวนคำเก่า-only sitting must still bank its recalls).

### Why ฟังแล้วพิมพ์ works the way it does

Thai is asymmetric: script→sound is nearly deterministic, sound→script is
many-to-one (/s/ is ซ ศ ษ ส). Reading builds recognition, not spelling. Spelling
needs sound→script practice with three properties, and four exceptions keep the
loop from punishing the wrong things:

1. **Always guess first.** `Esc` scores what's in the box instead of revealing
   the answer. `Enter` commits a guess shorter than the answer.
2. **Never copy the answer.** Copying barely touches memory. A miss goes
   study → cover → recall: an aligned diff, the answer alone, then retype from
   memory. The answer shows above the typing bar, never in it.
3. **Come back to it.** A miss returns at gaps of 5, 15, 40 words and retires
   after three clean recalls.
   - Gaps count new-material words only, or owed words would feed their own gaps.
   - Drills interrupt only between cues, at most three per boundary.
   - Owed words carry to the next session via the run log and open it as a
     ทบทวนคำเก่า round.
   - A stumble costs one step, not all three, and banked recalls persist
     (`progress`), or a hard word could never retire.
4. **Not on every word.** `Ctrl+Enter` (ไม่ต้องจำ) drops a word from the loop for
   good, for transliterated names that teach nothing. It is then skipped like
   punctuation; recorded as `ignored`.
5. **Not for a slipped finger.** `Shift+Enter` (พิมพ์ผิด) scores the word as right
   and strikes the miss, but doesn't ban it.
6. **But you can look at the line.** `Shift+Tab` (ดูทั้งท่อน) shows the whole cue
   once, because listening can't tell you where words end. Trusted, not priced.
7. **Nor for marks landing out of order.** ่ and า are adjacent keys and nothing
   enforces storage order, so `ต+า+่` renders as ต่าง but compares wrong, with
   nothing on screen to show why. `canonThai` (`src/spell.ts`) sorts marks into
   standard order first and names the right key order. A wrong tone mark is still
   wrong.

Accuracy counts first guesses only. สถิติ shows how many words are still owed.
The diff (`spell.ts`) aligns by grapheme cluster, so a missing tone mark doesn't
paint the whole tail red, and is shown on failed recalls too.

**เรื่องอ่าน (texts)**: drop any Thai `.txt` into `texts/` (first line = title).

**ข่าว (news)**: the app's one outside dependency, kept deliberately: news is real
and can't be generated. Four RSS feeds (`newsFeeds` in `main.go`), so one dying
isn't fatal, cached to `<data-dir>/news/cache.json` and served `stale` when
offline. Opening a story fetches the full article (`article.go`, reader in
`web/src/reader.ts`) and you type it in place.

- Extraction is stdlib only: JSON-LD first, then one body-container marker per
  host. All four sources yield full text (as of 2026-07). A failed body falls back
  to the RSS lead, marked `partial`.
- Images are downloaded once and served same-origin, never hotlinked.
- **Every outbound fetch is allowlisted to the feeds' hosts** (plus
  `static.thairath.co.th`), https-only, checked on every redirect: the client names
  the URL, so an open fetch would be an SSRF hole into the LAN. Article text goes in
  via `textContent`, never `innerHTML`.

## Thai word segmentation

The default is the browser's ICU `Intl.Segmenter` (`web/src/segment.ts`). Put `|`
between words in a cue or text to override it; explicit markers always win. The
dictation setup screen previews the cuts.

ฟัง–พิมพ์ episodes get **deepcut** server-side, because ICU's dictionary is small
and splits names and rare words. `tools/segment-srt.py` runs deepcut, then rejoins
tokens that form one word in `tools/thai-words.txt` (PyThaiNLP, CC0), because
deepcut is trained to split โรง|เรียน. `segment.go` serves the result from
`/api/subs`, segmenting in the background on first request (~25s, cached in
`<data>/seg/`). deepcut is opt-in because its venv is ~2.4 GB:

    tools/setup-deepcut.sh          # once; creates .venv-deepcut/
    sudo systemctl restart thai-typing

Without it, the browser splits cues itself.

**You type the Thai and read the rest.** A token with no Thai character (quotes,
numbers, `65%`, English) is dimmed, skipped and never scored, in every mode, so a
stray em dash can't block you. One predicate: `hasThai` in `segment.ts`.

## Speed metric

CPM of correctly typed words: Thai has no spaces, so WPM is ill-defined. CPM ÷ 5
is roughly WPM.

## Architecture

- `main.go` + `article.go` + `segment.go`: Go stdlib only, one binary on
  `127.0.0.1:8768`. Serves the app and the API.
- `web/`: strict TypeScript, no npm; deno is the toolchain (`web/deno.json`).
  **There is a build step**: `web/app.js` is a gitignored bundle, so editing a
  `.ts` does nothing until `deno task build` runs.
- GSAP is the one third-party library, vendored (`web/vendor/gsap.min.js`, pinned
  3.13.0). Without it the page is just still.
- Fonts: Srisakdi (display) and Sarabun (text), self-hosted in
  `web/assets/fonts/`. Art, icons and ornament are drawn in code.
- Music (`music.ts`, `instruments.ts`): a sampled Thai-style ensemble over a
  real field-recording nature bed, one hand-composed theme per region. Samples
  are mostly VCSL (CC0) in `web/assets/ranat/`, built by `tools/build-assets.py`.
  `tools/build-lexar.py` adds an optional, gitignored kanun overlay from the
  Lexar drive (not redistributable).
- **Sound rules (johan's, binding for any music work):**
  1. Samples only. Synthesis reads as synthetic, even at pad level.
  2. Short struck or plucked sounds only. Sustained voices annoy over a session;
     the nature bed owns the sustain.
  3. Nothing high or bright. The glockenspiel was rejected; the ranat's top folds
     below ~1.25 kHz. Brightness belongs to the birds.
  4. Nature forward. Reference feel: region 2 breeze, region 3 brook.
  5. Never the Manhã-fria sea-waves recording; no kanun in low registers.
- `<data-dir>/users/<name>.jsonl`: the append-only run log, **the single source
  of truth**. Unlocks, stars, PBs, streaks and the graph are all derived from it.
  It lives in `~/keep/thai-typing/` (set with `-data`) so it's backed up with
  `~/keep`.

## Accounts and backend

Accounts are a username only: no password, no sessions. The site is behind the
VPN and the users are johan on three devices, so auth would guard nothing.
`/api/login` answers only for the name asked; users are never listed.

The pattern: one stdlib process; an append-only `.jsonl` per user; store events,
derive state; the server is the only source of truth and clients re-fetch on
focus, so multi-device sync has nothing to conflict. The one mutable thing, the
dictation cursor, gets its own file. This breaks down with untrusted users or
concurrent mutable state; that needs real auth and a database, not more layers.

## Install / deploy

```sh
./install.sh        # type-check + bundle the UI, build the binary, systemd unit + start
```

Idempotent. For a frontend-only edit: `cd web && deno task check && deno task
build`, no restart needed. `./web/tests/run.sh` is the whole test suite and stands
in for a browser (there is no chromium on this box): a smoke test types a story
through end to end, and the `sim-*.js` files drive the real dictation state
machine.

Registered in `~/dashboard/projects.json`; the front door strips the `/thai-typing/`
prefix, so the app uses relative URLs only.

## Public standalone (GitHub Pages)

`docs/` is a backend-free word-stream drill on GitHub Pages (`main` branch,
`/docs`), for practice without the VPN. It exposes nothing: Pages has no path to
the box.

- `docs/game.js`: endless stream from the real level generator; best score in
  `localStorage`.
- `docs/kedmanee.js`: maps physical keys through Kedmanee, so any keyboard types
  Thai without a Thai layout installed.

`docs/lib/` and `docs/fonts/` are generated from `web/`. Rebuild and commit after
changing word lists or fonts:

```sh
./tools/build-pages.sh
```
