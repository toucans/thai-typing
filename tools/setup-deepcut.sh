#!/usr/bin/env bash
# One-time setup for the ฟัง–พิมพ์ word splitter (tools/segment-srt.py).
#
# Deliberately NOT part of install.sh. deepcut pulls TensorFlow, and the venv it
# lands in is ~2.4 GB — far and away the biggest thing this project would own,
# on a box kept lean on purpose. So it is opt-in, it lives outside the repo, and
# nothing needs it at runtime: the server shells out to it once per episode to
# build a cached copy of the subtitles, and if the venv is not here it simply
# serves the raw .srt and the browser segments as it always did.
#
# Delete .venv-deepcut whenever the disk is wanted back; already-segmented
# episodes keep working, only new ones fall back.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$HERE/.venv-deepcut"

python3 -m venv "$VENV"
"$VENV/bin/pip" install --quiet --upgrade pip
"$VENV/bin/pip" install --quiet deepcut

echo "checking..."
"$VENV/bin/python" - <<'PY'
import os
os.environ["TF_CPP_MIN_LOG_LEVEL"] = "3"
os.environ["CUDA_VISIBLE_DEVICES"] = "-1"
import deepcut
got = deepcut.tokenize("มิหนำซ้ำเขาก็ยังมาสาย")
assert got[0] == "มิหนำซ้ำ", got
print("deepcut ok:", " | ".join(got))
PY

echo
echo "venv: $VENV ($(du -sh "$VENV" | cut -f1))"
echo "restart the service to segment any episodes already in media/:"
echo "  sudo systemctl restart thai-typing"
