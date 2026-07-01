#!/usr/bin/env python3
"""thai-typing server: static app + append-only run log + media listing.

Python stdlib only -- no pip, nothing to rot. One process serves everything:

    web/    the app (vanilla HTML/CSS/JS, no build step)
    media/  audio/video + .srt pairs for the dictation game (gitignored, drop files in)
    texts/  plain-text Thai stories for free-text typing (first line = title)
    data/runs.jsonl  append-only log of every finished run -- the single source of
                     truth for all progress (PBs, stars, streaks are derived from it)

Binds to localhost; the dashboard's nginx front door proxies /thai-typing/ here,
stripping the prefix -- which is why the app only ever uses relative URLs.
"""
import json
import mimetypes
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote, urlparse

HOST, PORT = "127.0.0.1", 8768
ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
MEDIA = os.path.join(ROOT, "media")
TEXTS = os.path.join(ROOT, "texts")
RUNS = os.path.join(ROOT, "data", "runs.jsonl")

MEDIA_EXTS = (".mp4", ".webm", ".mkv", ".m4a", ".mp3", ".ogg", ".opus", ".wav")
MAX_RUN_BYTES = 4096  # a run record is a small JSON object; anything bigger is a bug

_runs_lock = threading.Lock()


def safe_join(base, rel):
    """Resolve rel under base, refusing path traversal. Returns None if outside."""
    path = os.path.realpath(os.path.join(base, rel))
    return path if path.startswith(os.path.realpath(base) + os.sep) else None


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # journald gets enough from systemd; stay quiet
        pass

    # -- helpers ------------------------------------------------------------
    def send_json(self, obj, status=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path, ranged=False):
        if not (path and os.path.isfile(path)):
            return self.send_json({"error": "not found"}, 404)
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json"):
            ctype += "; charset=utf-8"
        size = os.path.getsize(path)
        start, end = 0, size - 1
        status = 200
        # Byte ranges so <video>/<audio> can seek; browsers require this for mp4.
        rng = self.headers.get("Range") if ranged else None
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)$", rng)
            if m and (m.group(1) or m.group(2)):
                if m.group(1):
                    start = int(m.group(1))
                    if m.group(2):
                        end = min(int(m.group(2)), size - 1)
                else:  # suffix range: last N bytes
                    start = max(0, size - int(m.group(2)))
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                status = 206
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        length = end - start + 1
        self.send_header("Content-Length", str(length))
        self.end_headers()
        with open(path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                chunk = f.read(min(65536, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)

    # -- routes -------------------------------------------------------------
    def do_GET(self):
        path = unquote(urlparse(self.path).path)

        if path == "/health":
            return self.send_json({"ok": True})

        if path == "/api/runs":
            runs = []
            if os.path.exists(RUNS):
                with open(RUNS, encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if line:
                            runs.append(json.loads(line))
            return self.send_json({"runs": runs})

        if path == "/api/media":
            pairs = []
            if os.path.isdir(MEDIA):
                files = sorted(os.listdir(MEDIA))
                for fn in files:
                    stem, ext = os.path.splitext(fn)
                    if ext.lower() != ".srt":
                        continue
                    for cand in files:
                        cstem, cext = os.path.splitext(cand)
                        if cstem == stem and cext.lower() in MEDIA_EXTS:
                            pairs.append({"name": stem, "media": f"media/{cand}",
                                          "subs": f"media/{fn}"})
                            break
            return self.send_json({"pairs": pairs})

        if path == "/api/texts":
            texts = []
            if os.path.isdir(TEXTS):
                for fn in sorted(os.listdir(TEXTS)):
                    if fn.endswith(".txt"):
                        # first line of the file is its display title
                        with open(os.path.join(TEXTS, fn), encoding="utf-8") as f:
                            title = f.readline().strip() or fn
                        texts.append({"name": fn, "title": title, "path": f"texts/{fn}"})
            return self.send_json({"texts": texts})

        if path.startswith("/media/"):
            return self.send_file(safe_join(MEDIA, path[len("/media/"):]), ranged=True)
        if path.startswith("/texts/"):
            return self.send_file(safe_join(TEXTS, path[len("/texts/"):]))

        rel = path.lstrip("/") or "index.html"
        return self.send_file(safe_join(WEB, rel))

    def do_POST(self):
        path = unquote(urlparse(self.path).path)
        if path != "/api/runs":
            return self.send_json({"error": "not found"}, 404)
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= MAX_RUN_BYTES:
            return self.send_json({"error": "bad length"}, 400)
        try:
            run = json.loads(self.rfile.read(length).decode("utf-8"))
            assert isinstance(run, dict) and run.get("t") and run.get("game")
        except Exception:
            return self.send_json({"error": "bad run"}, 400)
        line = json.dumps(run, ensure_ascii=False, separators=(",", ":"))
        with _runs_lock:
            os.makedirs(os.path.dirname(RUNS), exist_ok=True)
            with open(RUNS, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        return self.send_json({"ok": True})


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
