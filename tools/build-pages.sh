#!/usr/bin/env bash
# Assemble the standalone GitHub Pages build under docs/ from the app's canonical
# sources. docs/ is the Pages site root (Settings -> Pages -> Deploy from a
# branch -> main / docs); it needs to be self-contained because Pages serves only
# that folder. The authored standalone code (index.html, app.css, game.js,
# kedmanee.js) lives in docs/ directly and stays plain JS; this script brings in
# the shared level generator and the fonts so the single source of truth stays
# under web/ -- rerun it whenever the word/sentence lists or fonts change, then
# commit docs/.
#
# The app's frontend is TypeScript (web/src), so the shared module can no longer
# just be copied: deno bundles web/src/levels.ts -- pulling in segment.ts and the
# word/sentence pools it imports -- into one plain-JS ES module. That is why
# docs/lib now holds a single file where it used to hold four.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v deno >/dev/null || { echo "deno is required (in /usr/local/bin on the box)"; exit 1; }

mkdir -p docs/lib
rm -rf docs/lib/data docs/lib/segment.js   # pre-bundle layout; nothing imports these now

deno bundle -q --platform browser -o docs/lib/levels.js web/src/levels.ts
{ printf '// GENERATED COPY -- do not edit. Source of truth: web/src/levels.ts (+ its imports).\n// Regenerate with tools/build-pages.sh.\n'
  cat docs/lib/levels.js; } > docs/lib/levels.js.tmp
mv docs/lib/levels.js.tmp docs/lib/levels.js

mkdir -p docs/fonts
cp web/assets/fonts/sarabun-400-thai.woff2  docs/fonts/
cp web/assets/fonts/sarabun-400-latin.woff2 docs/fonts/
cp web/assets/fonts/sarabun-600-thai.woff2  docs/fonts/
cp web/assets/fonts/sarabun-600-latin.woff2 docs/fonts/
cp web/assets/fonts/srisakdi-700-thai.woff2  docs/fonts/
cp web/assets/fonts/srisakdi-700-latin.woff2 docs/fonts/

echo "docs/ rebuilt. Commit it; GitHub Pages serves main:/docs."
