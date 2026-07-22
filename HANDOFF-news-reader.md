# Handoff — ข่าว as a full-article reader you type

**For:** Claude Fable, building autonomously.
**Goal, in one line:** turn ข่าว from "type an RSS headline + lead in the plain box"
into "read the **whole real news article** — its actual full text, its date, its
photo — laid out beautifully like the newspaper it came from, and type it start to
finish *inside that layout* instead of in the standard typing box."

This is an **extension** of a working feature, not a rewrite. Read the "What exists
today" section first and reuse it. When you finish, the definition of done and the
verify steps are at the bottom — work all the way through them.

Build conventions are johan's global `~/.claude/CLAUDE.md` (monk-like: few moving
parts, boring proven tech, tiny long-lived dependency surface, one source of truth
in plain text). This repo already lives by them. The hard constraints those imply
are collected in the checklist near the end — treat it as non-negotiable.

---

## 1. What johan asked for

> "download the actual text layout of the actual news articles on the news sites
> with the date and picture too and show it beautifully on thai-typing where
> instead of typing in the standard box, you see the news article with the proper
> text layout and design and you type the whole news article start to finish."

Break that into the parts you must deliver:

1. **Actual full article text** — not the RSS lead (one clamped paragraph), but the
   real body of the article, all of it.
2. **The date and the picture** — the article's publish date and its hero image.
3. **Beautiful, faithful layout** — it should read like a real news article / front
   page: strong headline, a source·date byline, the photo, then the body in proper
   reading typography. Not a wall of monospace, not the plain wordstream box.
4. **Type the whole thing, in place** — the typing happens *over the article layout*.
   You read the real article and type it through, start to finish. The plain
   `#typebox` / two-line `#wordstream` is replaced, for this mode, by typing that
   flows through the laid-out paragraphs.

---

## 2. What exists today (reuse this — don't rebuild it)

The current ข่าว mode is a live RSS feed of headlines + short leads. The whole path:

- **Server** (`main.go`):
  - `newsFeeds` (main.go:63) — the four sources and their RSS URLs:
    ไทยรัฐ, ข่าวสด, ประชาไท, มติชน.
  - `getNews()` / `fetchFeed()` (main.go:308, 362) — fetch every feed concurrently,
    parse RSS with `encoding/xml`, clean the HTML out of title/description
    (`cleanText`, main.go:409), keep only Thai items, cap 20/source, merge
    newest-first, **cache the last good pull to disk** under
    `data/news/cache.json` and fall back to it when every feed is down (marked
    `stale`). This last-good-to-disk pattern is the model to copy for articles.
  - `GET /api/news` (main.go:121) returns `{ items:[{source,title,lead,link,t}], sources, fetchedAt, stale }`.
- **Client** (`web/js/main.js`):
  - `renderNews()` (main.js:196) — fetches `/api/news` once (cached in memory like
    runs), renders per-source chips (one สำนักข่าว at a time, never a mixed feed),
    lifetime news stat cards, and a card per story.
  - Clicking a card (main.js:269) segments `lead || title` and calls
    `startText('ข่าว: ' + title, '📰 '+title, words, breaks, { backView:'news', run:{ src: source } })`.
- **Typing engine** (`web/js/speed.js`): `startText()` (speed.js:40) → `begin()` →
  the `#wordstream` two-line scrolling box → `commitWord()` → `finish()`
  (speed.js:108) which scores the run and writes it.
- **Stats contract** (`web/js/records.js:172`): a news run is identified purely by
  its `name` starting with `"ข่าว: "` and carrying `src`. From that,
  `newsRead / newsPb / newsChars / newsBySource / newsTitles` are derived
  (records.js:177). **This contract is load-bearing — see the checklist.**
- **Markup** (`web/index.html`): the `#view-news` section (index.html:120) and the
  shared `#view-play` (index.html:71). Segmentation is `segmentThaiBreaks()` in
  `web/js/segment.js` (Intl.Segmenter, dependency-free) — reuse it for the body.

So: the **list** view, the **source chips**, the **RSS fetch+cache**, the
**scoring/finish/stats** are all done and good. What's missing is (a) the *full
article* fetch, (b) the *image + date*, (c) a *reader layout*, (d) *typing over that
layout*. Build those four; leave the rest alone.

---

## 3. Architecture — server side (Go, stdlib only)

### 3.1 The new endpoint

Add one lazy, per-click endpoint. The list stays cheap (RSS); the full article is
only fetched when the user opens a story.

```
GET /api/article?src=<source>&link=<article-url>
 → 200 { ok:true, source, headline, dateISO, image, paragraphs:[".."], partial:false, link }
 → 200 { ok:false, error:"..." }        // never leak; degrade gracefully client-side
```

- `image` is a **same-origin** path we serve (see 3.4), or `null`.
- `paragraphs` is the real body, split into paragraphs (array of plain strings).
- `partial:true` means full-text extraction failed and we fell back to the RSS lead
  (so the client can label it honestly rather than pretend it's the whole article).

### 3.2 SSRF guard — the one thing you must not get wrong

The client passes a `link`. **Never fetch an arbitrary URL.** Before fetching,
parse the URL and require its host to be one of the known feed hosts, derived from
`newsFeeds` (e.g. build a `map[string]bool` of the registrable hosts:
`www.thairath.co.th`, `www.khaosod.co.th`, `prachatai.com`, `www.matichon.co.th`).
Reject anything else with `ok:false`. This is a hard requirement — the server makes
outbound requests, so an unguarded fetch endpoint is an SSRF hole into johan's LAN.

Also: `https`-only, a `http.Client` with a 12s timeout (mirror `fetchFeed`), a
`User-Agent` of `Mozilla/5.0 (thai-typing)`, and `io.LimitReader` the body
(articles can be ~2 MB — cap at ~4 MiB like the feed reader).

### 3.3 The extraction cascade (standard-first, boring, durable)

Sources differ. **This has been verified against the live sites — the results are
below; re-verify (3.6) before you rely on them, sites change.** Extract with a
layered cascade, most-standard first:

1. **JSON-LD** — the durable, standard path johan's ethos prefers (a documented
   schema.org contract, not scraped divs). Find `<script type="application/ld+json">`
   blocks, `json.Unmarshal` each, and look for an object whose `@type` is
   `NewsArticle` / `Article` / `BlogPosting`. Take `articleBody` (the full text),
   `headline`, `datePublished`, and `image` (string, `{url}`, or array).
   Split `articleBody` into paragraphs on newlines / `</p>`.
   - **Verified: ไทยรัฐ (Thairath) gives a clean full `articleBody` + `image` +
     `datePublished` this way.** This is the reference-quality case.

2. **Meta + container fallback** — if there's no usable `articleBody`: read
   `og:image` / `og:title` / `article:published_time` from `<meta>` for the image,
   title and date, and pull body text from the article's main content container's
   `<p>` runs. This is inherently per-source and brittle; only keep it for a source
   where it demonstrably yields the real body.

3. **Graceful degradation** — if neither yields a real full-text body, return the
   **RSS lead** you already fetch (pass it through, or re-fetch the feed item) with
   `partial:true`. Never return an error the user sees as a dead card; a partial
   article is still typeable.
   - **Verified: มติชน (Matichon) renders its body client-side and its WP REST API
     is Cloudflare-walled — full text is *not* cleanly extractable server-side.**
     Matichon should degrade to `partial` (lead), or be quietly excluded from the
     reader, unless you find a working path (its AMP endpoint, if any). Don't sink
     the project trying to crack it — johan values the two or three sources that
     work cleanly over a fragile scraper for all four.

**On HTML parsing:** try to stay **zero-dependency** — JSON-LD is `encoding/json`,
and the meta/`<p>` fallback can be done with `regexp`/`strings`/`html.UnescapeString`
(the repo already does exactly this in `cleanText`). If, and only if, robust body
extraction genuinely needs a real HTML tree, `golang.org/x/net/html` is the *single*
tolerable dependency — it's Go-team-owned, stdlib-adjacent, and durable. Per johan's
rule, **if you reach for it, say so and say why** (a one-line note in the commit and
the README), because it widens the dependency surface. Prefer not to.

### 3.4 Image handling — proxy and cache to disk

Do **not** hotlink the source's image into the page. Instead, server-side:

- Download the hero image (same allowlist host rule as 3.2 — image host must be an
  allowed news/CDN host; note Thairath images live on `static.thairath.co.th`, so
  the image allowlist is slightly broader than the article allowlist — enumerate the
  CDN hosts you actually see).
- Cache it to disk under `data/news/img/<hash>.<ext>` (hash the URL), and serve it
  same-origin, e.g. `GET /api/news-image?u=<hash>`.

Why: offline/again-durable (matches the `cache.json` philosophy), no external
requests from the browser (no mixed-content, no CSP surprise behind the VPN proxy,
no leak of what johan reads), and it just keeps working if the source later deletes
the image. Keep it lean — cap image size, ignore failures (a missing image → `null`,
the layout handles it).

### 3.5 Cache the extraction too

Cache each successful article extraction to disk keyed by the link hash (JSON under
`data/news/articles/<hash>.json`), with a mod(e.g. day) TTL. Re-opening a story, or
re-typing it, should not re-hit the source. Same last-good spirit as `cache.json`.

### 3.6 Verify each source empirically (do this before trusting 3.3)

These are the exact probes used to establish the findings above — run them against a
*fresh* link from each feed (get one from `/api/news` or the raw RSS):

```sh
ART="<a real article url from the feed>"
H=$(curl -s -m 15 -A "Mozilla/5.0 (thai-typing)" "$ART")
echo "$H" | grep -oE '"@type":"?[A-Za-z]+"?' | sort | uniq -c   # what JSON-LD types?
echo "$H" | grep -oE '"articleBody":"[^"]{0,200}'               # full body present?
echo "$H" | grep -oE '<meta property="og:image"[^>]*>'          # image
echo "$H" | grep -oE 'article:published_time"[^>]*content="[^"]*"'  # date
```

Decide per source: full-text (ideal), meta+container (if it really works), or
partial. Wire the cascade to match reality, and note in the README which source is in
which tier.

---

## 4. Architecture — client side (vanilla JS, no build step)

### 4.1 A new "reader" typing view

Today a news card calls `startText(...)` into `#view-play`'s wordstream. Change the
card click (main.js:269) so that instead it:

1. `fetch('api/article?src=…&link=…')` (show a "กำลังเปิดข่าว…" placeholder).
2. Renders the **article layout** into a new view (add `#view-reader` to
   `index.html`, or a dedicated container inside a reworked play view — your call,
   but keep the wordstream path intact for เส้นทาง / เรื่องอ่าน which still use it).
3. Starts **typing over that layout** (4.3).

The reader layout, top to bottom:

- **byline** — `source · <date, formatted th-TH>`, small, gold, letter-spaced
  (reuse `.news-src` styling / `--gold`). Use `Intl.DateTimeFormat('th-TH', …)`
  as `renderNews` already does (main.js:257).
- **headline** — the article headline in the **Srisakdi display font**
  (`--display`, already loaded), large, `--green-900`. This is the front-page moment.
- a thin **gold rule** under the byline/headline — the app already has this motif
  (`.wordstream-frame::before`, and the `hr` gold-gradient at style.css:134). Reuse it.
- **hero image** — the cached same-origin image, full measure width, rounded
  corners, soft shadow (`box-shadow` like `.mediacard:hover`), lazy. Omit cleanly if
  `null`.
- **body** — the real paragraphs, in **Sarabun** (looped — johan reads looped Thai
  only; Sarabun already is), comfortable measure (~32–36em), line-height ~1.9,
  paragraph spacing. This is what you read *and* type.

### 4.2 Make it genuinely beautiful

The app has a strong existing identity — warm paper (`--paper`), gold rules, green
accents, Srisakdi display headings, a manuscript feel. **Extend that faithfully;
don't invent a new theme.** Pull every color from the existing tokens (style.css:73
`:root`, and the dark overrides at :94) so light/dark both work for free. Look at
`.newscard`, `.wordstream`, `.stat`, and the `hr`/frame gold rules and match their
language. The frontend-design skill is available if you want a sanity check on
typographic scale and rhythm, but the north star is "this looks like the same app's
front page," not novelty. Aim for something johan would call beautiful: restrained,
legible, a real newspaper page rendered in this app's paper-and-gold world.

### 4.3 Typing over the layout

Reuse the **scoring model** from `speed.js` exactly — don't reinvent scoring:

- Segment each paragraph with `segmentThaiBreaks()` (segment.js). Lay the words out
  as `<span>`s **inside their paragraph elements**, preserving paragraph structure
  (a paragraph end is a hard boundary). Keep the same class vocabulary the wordstream
  uses so the CSS and the muscle memory carry over: `cur` (current word, gold
  highlight), `bad` (current word typed wrong so far, red), `ok` (done correctly,
  `--green-500`), `err` (committed wrong, red wavy underline). See style.css:340–343.
- An **off-screen hidden input** captures keystrokes (like `#typebox`), so mobile
  keyboards and IME work. Reuse the input handling from `initSpeed()` (speed.js:182):
  per-keystroke `sound.click` / `sound.thud`, `S.keys` / `S.wrong` / `S.correctChars`,
  no-space auto-advance when the typed word matches, space to cross a real word-gap
  (`breaks[i]`). Across a **paragraph boundary**, auto-advance (or accept Enter) so
  the flow never stalls — decide and keep it obvious.
- **Reading vs. dimming:** the wordstream dims everything but the current line
  because it's a drill. The reader is different — you're reading a real article, so
  **keep upcoming text fully legible** (normal ink), with only the current word
  highlighted and completed words greened. Auto-scroll to keep the current line
  comfortably in view (roughly centered), so the page scrolls as you type — like
  reading down the column. This "read the real thing while typing it" feel is the
  whole point of the mode.
- **Progress**: reuse `#play-progress` bar semantics (fraction of words done), maybe
  a subtle "ย่อหน้า 3/8" or words-left. Keep it quiet.

### 4.4 Finish — preserve the stats contract precisely

When the last word commits, reuse the **exact** `finish()` logic (speed.js:108): same
cpm/acc/stars math, same results modal, and write the run with:

```js
{ game:'text', name:'ข่าว: '+title, src:source, cpm, acc, chars, errors, secs, stars }
```

i.e. **keep `mode:'text'`, the `"ข่าว: "` name prefix, and `src`** — that is the
contract `records.js` reads to build every news stat (records.js:172–185). If you
change it, `newsRead / newsPb / newsChars / newsBySource / newsTitles` and the whole
สถิติ + ข่าว stat strip silently break. The modal's "กลับ" should return to
`backView:'news'`, and the news view should refresh its stats on return (main.js
already does this, main.js:328).

### 4.5 Safety

Every field from `/api/article` is **untrusted external text** — place it with
`textContent`, never `innerHTML` (the existing news code is careful about this,
main.js:194/266). The only exception is the image `src`, which is the same-origin
cached path you control.

---

## 5. Hard constraints (johan's principles — non-negotiable)

- [ ] **Go stdlib only.** `golang.org/x/net/html` is the *only* permissible addition,
      and only if body extraction truly needs a tree — if you use it, say so in the
      commit + README and justify it. Prefer zero-dep (JSON-LD + regex, like `cleanText`).
- [ ] **No frontend build step.** Vanilla HTML/CSS/JS, self-hosted fonts, relative URLs
      (the app is proxied under `/thai-typing/`).
- [ ] **SSRF allowlist** on every outbound fetch (article + image). Host must be a
      known news/CDN host derived from `newsFeeds`.
- [ ] **Untrusted text via `textContent`.** No `innerHTML` for fetched fields.
- [ ] **Preserve the run/stats contract**: `mode:'text'`, `name:'ข่าว: '+title`, `src`.
- [ ] **Cache to disk** (articles + images), offline-durable, mirroring `cache.json`.
      Durable user/machine data stays out of git (`.gitignore` already excludes `/data/`).
- [ ] **Looped Thai fonts** only (Sarabun for body, Srisakdi for display — both loaded).
- [ ] **Don't break** เส้นทาง / เรื่องอ่าน / ฟัง–พิมพ์ / ไล่ผี — the wordstream path stays.
- [ ] **No chromium on this box** (it SIGTRAPs). Verify UI with `deno` stub-DOM + `curl`,
      never browser screenshots.
- [ ] **One source of truth**: when done, update the README's ข่าว / Architecture
      sections to describe the reader, and don't restate global principles — point to them.

---

## 6. Suggested build order (so it lands complete, not half-done)

1. **Server extractor + endpoint.** `/api/article` with the SSRF guard, the JSON-LD
   path, disk cache. Verify per source with the curl probes (3.6). Decide each
   source's tier. — *Done when `curl 'localhost:8768/api/article?src=ไทยรัฐ&link=…'`
   returns real full-text paragraphs + date + image URL for Thairath, and degrades
   cleanly (`partial:true`) for Matichon.*
2. **Image proxy + cache.** `/api/news-image`, disk-cached, same-origin. — *Done when
   the returned `image` path serves the photo bytes locally.*
3. **Reader layout, no typing yet.** Render byline + Srisakdi headline + gold rule +
   hero image + body paragraphs, beautifully, light+dark. — *Done when it looks like
   a front page and reads well (verify via deno stub-DOM render + eyeball the HTML/CSS).*
4. **Typing over the layout.** Span-per-word inside paragraphs, hidden input, reused
   scoring, auto-scroll, progress, `finish()` with the exact run contract. — *Done
   when typing a real article end-to-end writes a correct `ข่าว: …` run line and the
   news stats update.*
5. **Polish + ship.** Partial-source labeling, paragraph-boundary flow, dark mode,
   empty/edge states (no image, source down). Update README. `go build`, restart the
   service, confirm at `/thai-typing/`. Commit and push (johan's standing rule: when a
   change is done **and verified**, push without asking).

---

## 7. Verify (do all of it before calling it done)

- **Extractor**: curl each source's `/api/article`; confirm Thairath yields full body
  + date + image, and every source either yields full text or degrades to `partial`
  without an error card.
- **Image**: fetch the returned image path locally; confirm bytes, and confirm it's
  cached (second fetch doesn't hit the source).
- **UI**: render the reader with `deno` (stub-DOM, per the box convention — no
  browser) and inspect the produced structure/classes; eyeball the CSS against the
  tokens for light and dark.
- **End-to-end type-through**: drive a full article to completion (script the input
  handler under deno, or reason it through against `initSpeed`), confirm a run line
  `{game:'text', name:'ข่าว: …', src:…, cpm, acc, chars, …}` is appended and that
  `stats(runs)` moves `newsRead / newsPb / newsChars / newsBySource / newsTitles`.
- **Regression**: เส้นทาง and เรื่องอ่าน still start and score through the wordstream.
- **Then** update the README and push.

If a source simply can't be cracked cleanly, that's an acceptable outcome — say so in
the README and ship the sources that work. Two beautiful, real, full-text sources beat
four fragile ones. Lean and bulletproof over clever.
