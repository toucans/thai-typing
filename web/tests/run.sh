#!/usr/bin/env bash
# The whole safety net: a boot/typing smoke test against the built bundle, then
# the ฟัง–พิมพ์ dictation simulations. There is no chromium on this box (it
# SIGTRAPs), so this plus `deno task check` is all there is.
#
# These drive the *real* dictation module's state machine against a stub DOM —
# there is no chromium on this box (it SIGTRAPs), so a headless browser is not an
# option and this is how the game's logic gets verified. They cover the parts
# that are pure logic and easy to break silently: the guess → study → cover →
# recall loop, the expanding-interval drill schedule, cross-session carry-over,
# ไม่ต้องจำ words being stepped over rather than typed, and the window of audio a
# cue is played over (which runs past the subtitle's own timestamp).
#
# The sims must exercise the module that actually ships, so this script assembles
# a scratch directory from the real sources plus stubs for the leaves that need a
# browser (audio, and the ui helpers that pull in canvas/gsap). Copying is what
# lets a relative `import './audio.ts'` inside the real module resolve to a stub —
# an import map cannot remap a relative specifier.
#
# The sims themselves stay .js: they are drivers built out of deliberately
# partial stubs, not app code, and `deno run` does not type-check them. The
# modules under test are the .ts files `deno task check` covers.
set -euo pipefail
cd "$(dirname "$0")"

SRC=../src           # source of truth for the modules under test
REAL=(dictation.ts spell.ts segment.ts types.ts)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

for f in "${REAL[@]}"; do cp "$SRC/$f" "$TMP/"; done
cp stubs/*.ts "$TMP/"
cp sim-*.js "$TMP/"

fail=0

# smoke.js loads web/app.js the way index.html does, so it needs a current
# bundle; build one rather than testing a stale artifact.
echo "=== smoke.js (built bundle) ==="
(cd .. && deno task -q build)
if deno run --allow-read smoke.js; then :; else fail=1; fi
echo

for sim in sim-*.js; do
  echo "=== $sim ==="
  if deno run --allow-read "$TMP/$sim"; then :; else fail=1; fi
  echo
done

if [ "$fail" -ne 0 ]; then
  echo "SIMULATIONS FAILED"
  exit 1
fi
echo "all simulations passed"
