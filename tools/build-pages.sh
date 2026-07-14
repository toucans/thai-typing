#!/usr/bin/env bash
# Assemble the standalone GitHub Pages build under docs/ from the app's canonical
# sources. docs/ is the Pages site root (Settings -> Pages -> Deploy from a
# branch -> main / docs); it needs to be self-contained because Pages serves only
# that folder. The authored standalone code (index.html, app.css, game.js,
# kedmanee.js) lives in docs/ directly; this script copies the shared word pools
# and fonts in so the single source of truth stays under web/ -- rerun it
# whenever the word/sentence lists or fonts change, then commit docs/.
set -euo pipefail
cd "$(dirname "$0")/.."

hdr='// GENERATED COPY -- do not edit. Source of truth: %s\n// Regenerate with tools/build-pages.sh.\n'

copy_mod() { # src -> dest, prepend a "generated" banner
  mkdir -p "$(dirname "$2")"
  { printf "$hdr" "$1"; cat "$1"; } > "$2"
}

copy_mod web/js/levels.js        docs/lib/levels.js
copy_mod web/js/segment.js       docs/lib/segment.js
copy_mod web/js/data/words.js    docs/lib/data/words.js
copy_mod web/js/data/sentences.js docs/lib/data/sentences.js

mkdir -p docs/fonts
cp web/assets/fonts/sarabun-400-thai.woff2  docs/fonts/
cp web/assets/fonts/sarabun-400-latin.woff2 docs/fonts/
cp web/assets/fonts/sarabun-600-thai.woff2  docs/fonts/
cp web/assets/fonts/sarabun-600-latin.woff2 docs/fonts/
cp web/assets/fonts/srisakdi-700-thai.woff2  docs/fonts/
cp web/assets/fonts/srisakdi-700-latin.woff2 docs/fonts/

echo "docs/ rebuilt. Commit it; GitHub Pages serves main:/docs."
