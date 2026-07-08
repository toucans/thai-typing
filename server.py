#!/usr/bin/env python3
"""thai-typing server: static app + append-only run log + media listing.

Python stdlib only -- no pip, nothing to rot. One process serves everything:

    web/    the app (vanilla HTML/CSS/JS, no build step)
    media/  audio/video + .srt pairs for the dictation game (gitignored, drop files in)
    texts/  plain-text Thai stories for free-text typing (first line = title)
    data/users/<name>.jsonl  one append-only run log per user -- the single source
                             of truth for that user's progress (PBs, stars, streaks
                             are all derived from it; nothing else is stored)

Accounts are a username and nothing else (personal site behind the VPN -- no
passwords, no sessions). The user list is just the files in data/users/ and is
never exposed: /api/login answers only for the one name asked about.

Binds to localhost; the dashboard's nginx front door proxies /thai-typing/ here,
stripping the prefix -- which is why the app only ever uses relative URLs.
"""
import json
import mimetypes
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

HOST, PORT = "127.0.0.1", 8768
ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
MEDIA = os.path.join(ROOT, "media")
TEXTS = os.path.join(ROOT, "texts")
USERS = os.path.join(ROOT, "data", "users")

MEDIA_EXTS = (".mp4", ".webm", ".mkv", ".m4a", ".mp3", ".ogg", ".opus", ".wav")
MAX_RUN_BYTES = 4096  # a run record is a small JSON object; anything bigger is a bug
# usual username shape: letters/digits/._- , 1-32 chars, starts and ends
# alphanumeric; matched lowercase so names are case-insensitive
USER_RE = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$")

_runs_lock = threading.Lock()


def safe_join(base, rel):
    """Resolve rel under base, refusing path traversal. Returns None if outside."""
    path = os.path.realpath(os.path.join(base, rel))
    return path if path.startswith(os.path.realpath(base) + os.sep) else None


def user_file(name):
    """runs file for a valid username, else None. The regex is the traversal
    guard: it admits no '/', so the name can only ever be a file in USERS."""
    name = (name or "").strip().lower()
    return os.path.join(USERS, name + ".jsonl") if USER_RE.match(name) else None


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

    def send_file(self, path, ranged=False, cache=False):
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
        if cache:  # instrument samples et al: sizable, effectively immutable
            self.send_header("Cache-Control", "max-age=86400")
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
        url = urlparse(self.path)
        path = unquote(url.path)

        if path == "/health":
            return self.send_json({"ok": True})

        if path == "/api/runs":
            uf = user_file(parse_qs(url.query).get("user", [""])[0])
            if not uf:
                return self.send_json({"error": "bad user"}, 400)
            if not os.path.exists(uf):
                return self.send_json({"error": "no such user"}, 404)
            runs = []
            with open(uf, encoding="utf-8") as f:
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
        return self.send_file(safe_join(WEB, rel),
                              cache=rel.startswith(("assets/", "vendor/")))

    def read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not 0 < length <= MAX_RUN_BYTES:
            return None
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
            return body if isinstance(body, dict) else None
        except Exception:
            return None

    def do_POST(self):
        path = unquote(urlparse(self.path).path)
        body = self.read_body()
        if body is None:
            return self.send_json({"error": "bad request"}, 400)

        if path in ("/api/login", "/api/user"):
            uf = user_file(body.get("user"))
            if not uf:
                return self.send_json({"error": "bad user"}, 400)
            name = os.path.basename(uf)[:-len(".jsonl")]
            with _runs_lock:
                if path == "/api/user":  # create: the name must be free
                    if os.path.exists(uf):
                        return self.send_json({"error": "taken"}, 409)
                    os.makedirs(USERS, exist_ok=True)
                    open(uf, "a", encoding="utf-8").close()
                elif not os.path.exists(uf):  # login: the name must exist
                    return self.send_json({"error": "no such user"}, 404)
            return self.send_json({"ok": True, "user": name})

        if path != "/api/runs":
            return self.send_json({"error": "not found"}, 404)
        uf = user_file(body.pop("user", None))
        run = body
        if not (uf and os.path.exists(uf)):
            return self.send_json({"error": "bad user"}, 400)
        if not (run.get("t") and run.get("game")):
            return self.send_json({"error": "bad run"}, 400)
        line = json.dumps(run, ensure_ascii=False, separators=(",", ":"))
        with _runs_lock:
            with open(uf, "a", encoding="utf-8") as f:
                f.write(line + "\n")
        return self.send_json({"ok": True})


if __name__ == "__main__":
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
