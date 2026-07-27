// Server-side word splitting for ฟัง–พิมพ์.
//
// The browser used to segment every cue itself with Intl.Segmenter. ICU's Thai
// dictionary is small and unextendable from a browser, so words it has never
// heard of — มิหนำซ้ำ, and every character name in an episode — came apart. The
// splitting moved to tools/segment-srt.py (deepcut + a dictionary rejoin pass);
// this file is the plumbing around it.
//
// The unit of work is a whole episode, cached to disk, because the alternative
// shapes are both worse: segmenting per request would put a ~25s model run in
// the way of pressing play, and keeping a Python worker resident would make a
// 2.4 GB TensorFlow install a permanent tenant of the box for something each
// episode needs exactly once.
//
// So: /api/subs serves the segmented copy if one is ready, the raw .srt if not,
// and kicks off the segmenting in the background either way. The fallback path
// is the old behaviour — the client segments with ICU when a cue has no '|' —
// which is also what happens for good if .venv-deepcut was never installed
// (tools/setup-deepcut.sh; it is opt-in on purpose).
package main

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"
)

const segTimeout = 10 * time.Minute // a long episode on a cold CPU, generously

var (
	segLock sync.Mutex
	segging = map[string]bool{} // episodes being segmented right now
)

func segCacheFile(stem string) string { return filepath.Join(segDir, stem+".srt") }

func segTool() (python, script string, ok bool) {
	python = filepath.Join(rootDir, ".venv-deepcut", "bin", "python")
	script = filepath.Join(rootDir, "tools", "segment-srt.py")
	return python, script, fileExists(python) && fileExists(script)
}

// segReady reports whether the cached copy exists and is newer than the .srt it
// came from — editing a subtitle file (adding a '|' by hand, fixing a typo) has
// to invalidate it, or the correction never shows up.
func segReady(stem, srtPath string) bool {
	cached, err := os.Stat(segCacheFile(stem))
	if err != nil {
		return false
	}
	src, err := os.Stat(srtPath)
	return err == nil && !cached.ModTime().Before(src.ModTime())
}

// segStatus is what the episode list shows: "ready" (cues carry deepcut's
// markers), "pending" (being built, refresh later), or "off" (no venv — the
// browser will segment it, same as before).
func segStatus(stem, srtPath string) string {
	if segReady(stem, srtPath) {
		return "ready"
	}
	if _, _, ok := segTool(); !ok {
		return "off"
	}
	return "pending"
}

// ensureSeg starts a segmentation run if one is warranted and not already
// going. It never blocks the caller: whoever asked gets the raw .srt this time
// and the segmented one next time.
func ensureSeg(stem, srtPath string) {
	python, script, ok := segTool()
	if !ok || segReady(stem, srtPath) {
		return
	}
	segLock.Lock()
	if segging[stem] {
		segLock.Unlock()
		return
	}
	segging[stem] = true
	segLock.Unlock()

	go func() {
		defer func() {
			segLock.Lock()
			delete(segging, stem)
			segLock.Unlock()
		}()
		if os.MkdirAll(segDir, 0o755) != nil {
			return
		}
		// write-and-rename: a half-written cache file would be served as a
		// truncated episode, which looks like the .srt itself lost its ending
		tmp := segCacheFile(stem) + ".tmp"
		cmd := exec.Command(python, script, srtPath, tmp)
		cmd.Dir = rootDir
		out, err := cmd.CombinedOutput()
		if err != nil {
			os.Remove(tmp)
			fmt.Fprintf(os.Stderr, "segment %q failed: %v\n%s\n", stem, err, out)
			return
		}
		if os.Rename(tmp, segCacheFile(stem)) != nil {
			os.Remove(tmp)
			return
		}
		fmt.Fprintf(os.Stderr, "segmented %q\n", stem)
	}()
}

// getSubs serves one episode's subtitles: the segmented copy when it is ready,
// the original otherwise. The name is matched against the episodes actually on
// disk rather than joined into a path, so nothing here can be walked out of
// media/.
func getSubs(w http.ResponseWriter, r *http.Request) {
	stem := r.URL.Query().Get("name")
	srtPath := ""
	for _, p := range mediaPairs() {
		if p.stem == stem {
			srtPath = p.srt
			break
		}
	}
	if srtPath == "" {
		sendJSON(w, 404, map[string]any{"error": "no such episode"})
		return
	}
	if segReady(stem, srtPath) {
		serveFile(w, r, segCacheFile(stem), false)
		return
	}
	ensureSeg(stem, srtPath)
	serveFile(w, r, srtPath, false)
}

// segmentAll warms the cache for everything in media/ at startup, so an episode
// dropped in while the service was down is ready before it is ever opened.
func segmentAll() {
	for _, p := range mediaPairs() {
		ensureSeg(p.stem, p.srt)
	}
}
