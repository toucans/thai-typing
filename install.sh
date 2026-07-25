#!/usr/bin/env bash
# Install/upgrade the thai-typing service. Idempotent -- re-run after pulling changes.
# The app itself is static files served straight from this checkout; only the tiny
# stdlib Go server runs as a service, so "deploy" is git pull + re-run this (it
# rebuilds the binary and the UI bundle).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

command -v deno >/dev/null || { echo "deno is required (in /usr/local/bin on the box)"; exit 1; }

# media/ + texts/ are in-repo content dirs (not in git). Durable user data lives OUTSIDE
# the repo under the box's ~/keep/<project> convention, so it's backed up via ~/keep and
# the app is pointed there (see the unit's -data flag). users/<name>.jsonl = all progress.
mkdir -p "$HERE/media" "$HERE/texts" "$HOME/keep/thai-typing/users"

# UI: strict TypeScript in web/src, type-checked and bundled by deno to
# web/app.js (a gitignored build artifact -- editing a .ts does nothing until
# this runs).
( cd "$HERE/web" && deno task check && deno task build )

( cd "$HERE" && "${GO:-/usr/local/go/bin/go}" build -o thai-typing-go . )

sudo install -m 0644 "$HERE/thai-typing.service" /etc/systemd/system/thai-typing.service
sudo systemctl daemon-reload
sudo systemctl enable --now thai-typing
sudo systemctl restart thai-typing

sleep 1
curl -fsS http://127.0.0.1:8768/health >/dev/null && echo "thai-typing up on 127.0.0.1:8768"
echo "reach it via the dashboard front door: http://10.7.0.1/thai-typing/"
echo "(registered in ~/dashboard/projects.json; re-run ~/dashboard/install.sh if missing)"
