# Handoff: port the frontend to strict TypeScript

Decided 2026-07-25, not started. thai-typing is the plain-JS holdout among the
box's web projects; `~/fa`, `~/RAG` and `~/friends` are already strict TS and
this should match them exactly rather than invent a fourth arrangement.

## The target convention

Copy the shape of `~/fa/web/deno.json` verbatim:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "lib": ["dom", "dom.iterable", "es2022"]
  },
  "tasks": {
    "check": "deno check src/main.ts",
    "build": "deno bundle -q --platform browser -o app.js src/main.ts"
  }
}
```

- `web/src/*.ts` becomes the source of truth (22 modules, ~4,900 lines, currently
  `web/js/*.js` plus `web/js/data/`).
- `web/app.js` is a gitignored build artifact; `web/index.html` loads it instead
  of `js/main.js`.
- `install.sh` runs `deno task check` then `deno task build` before the Go build.

Use `git mv` so the history of each module survives.

## What makes this more than a rename

1. **There is no build step today.** The Go server serves `web/` straight from
   disk (`webDir` in `main.go`), which is why frontend edits currently go live
   with no rebuild. Adding a bundle changes that — after the port, editing a
   `.ts` does nothing until `deno task build` runs. Say so in the README.

2. **`docs/` is a separate standalone GitHub Pages build** and needs plain JS.
   `tools/build-pages.sh` copies 5 shared modules into `docs/lib/` with a
   "GENERATED COPY" banner: `levels`, `segment`, `data/words`, `data/sentences`.
   Once those originate as `.ts` the script must emit JS instead of `cat`-ing
   them. `docs/` also has its own *authored* standalone code (`docs/game.js`,
   `docs/kedmanee.js`, `docs/app.css`) which is out of scope — leave it JS.

3. **gsap is a global, not a module.** `web/index.html` loads
   `vendor/gsap.min.js` in a plain `<script>` tag and `src/fx.ts` reads
   `window.gsap`, guarding for its absence. That needs an ambient declaration.

4. **`noUncheckedIndexedAccess` is the expensive flag here.** The codebase
   indexes arrays constantly — `D.tokens[D.wordIdx]`, `cues[d.cue]`,
   `REGIONS[idx]`, `DRILL_GAPS[item.reps]`. Every one becomes `T | undefined`.
   This is the flag most likely to surface a real latent bug, so work through
   them rather than widening the type to silence it.

5. **The `records.js` run objects are heterogeneous by design.** One JSONL line
   per run, with fields varying by game (`speed` has `cpm`/`level`, `dictation`
   has `misses`/`mastered`/`ignored`, `text` has `src`). The Go server passes
   them through verbatim and never validates a schema — see `getRuns` in
   `main.go`. A discriminated union on `game` is the natural fit; do not make the
   server enforce it, the pass-through is deliberate.

## Verify with

`./web/tests/run.sh` — 39 checks across three simulations driving the real
dictation state machine against a stub DOM. **This is the regression suite for
the ฟัง–พิมพ์ rework and it must still pass after the port.** There is no
chromium on this box (it SIGTRAPs), so browser testing is not available; the
sims plus `deno task check` are the whole safety net.

After the port, `web/tests/run.sh` needs its `REAL=(...)` list and `SRC` path
pointed at `../src` and `.ts` extensions, and the stubs under `web/tests/stubs/`
renamed to match.

Note that `deno check` on the current `.js` files catches essentially nothing —
verified: a file with an undefined identifier, a wrong-arity call, a bad property
access and a type mismatch passes clean as `.js` and reports all four as `.ts`.
Any "typecheck passed" claim about the pre-port code is worthless.

## Recent context

The ฟัง–พิมพ์ spelling rework landed just before this (commits `729f322`,
`bb73c10`, `5fffc1a`, `5830753`); `README.md` explains the design. `dictation.js`
is the most intricate module and the one most worth typing carefully — it has a
`D` session object with a phase state machine (`guess` / `study` / `recall`) and
a drill queue whose items carry their own schedule.
