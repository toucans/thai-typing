#!/usr/bin/env bash
# Install/upgrade the thai-typing service. Idempotent -- re-run after pulling changes.
# The app itself is static files served straight from this checkout; only the tiny
# stdlib server runs as a service, so "deploy" is just git pull (+ re-run this if
# server.py or the unit changed).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

# Runtime dirs: media/ and data/ are deliberately not in git (binaries / machine data).
# data/runs.jsonl is the one file worth backing up -- it is all your progress.
mkdir -p "$HERE/media" "$HERE/data" "$HERE/texts"

python3 -m py_compile "$HERE/server.py"

sudo install -m 0644 "$HERE/thai-typing.service" /etc/systemd/system/thai-typing.service
sudo systemctl daemon-reload
sudo systemctl enable --now thai-typing
sudo systemctl restart thai-typing

sleep 1
curl -fsS http://127.0.0.1:8768/health >/dev/null && echo "thai-typing up on 127.0.0.1:8768"
echo "reach it via the dashboard front door: http://10.7.0.1/thai-typing/"
echo "(registered in ~/dashboard/projects.json; re-run ~/dashboard/install.sh if missing)"
