// thai-typing server: static app + append-only per-user run log + media listing.
// Go port of the stdlib-Python server -- one owned binary, standard library
// only. One process serves everything:
//
//	web/    the app (vanilla HTML/CSS/JS, no build step)
//	media/  audio/video + .srt pairs for the dictation game (gitignored)
//	texts/  plain-text Thai stories for free-text typing (first line = title)
//	data/users/<name>.jsonl  one append-only run log per user -- the single
//	                         source of truth for that user's progress
//
// Accounts are a username and nothing else (personal site behind the VPN -- no
// passwords, no sessions). The user list is just the files in data/users/ and
// is never exposed: /api/login answers only for the one name asked about.
//
// Binds to localhost; the dashboard front door proxies /thai-typing/ here,
// stripping the prefix -- which is why the app only ever uses relative URLs.
package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"encoding/xml"
	"flag"
	"fmt"
	"html"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	host        = "127.0.0.1"
	port        = "8768"
	maxRunBytes = 4096 // a run record is a small JSON object; bigger is a bug
)

var mediaExts = map[string]bool{
	".mp4": true, ".webm": true, ".mkv": true, ".m4a": true,
	".mp3": true, ".ogg": true, ".opus": true, ".wav": true,
}

// usual username shape: letters/digits/._- , 1-32 chars, starts and ends
// alphanumeric; matched lowercase so names are case-insensitive.
var userRe = regexp.MustCompile(`^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$`)

var (
	webDir, mediaDir, textsDir, usersDir, newsDir string
	runsLock                                      sync.Mutex
)

// The one outbound dependency in the app: real Thai news, fetched as RSS (the
// most durable, boring option — no scraping), so เรื่องอ่าน has a live source
// with real provenance instead of only authored texts. A dead or moved feed is
// a one-line edit here; the last good fetch is cached to disk so an offline box
// or a down feed still gives you something to type.
var newsFeeds = []struct{ name, url string }{
	{"ไทยรัฐ", "https://www.thairath.co.th/rss/news"},
	{"ข่าวสด", "https://www.khaosod.co.th/feed"},
	{"ประชาไท", "https://prachatai.com/rss.xml"},
	{"มติชน", "https://www.matichon.co.th/feed"},
}

func main() {
	addr := flag.String("addr", host+":"+port, "listen address")
	// Durable user data lives outside the repo, under the box's ~/keep/<project>
	// convention (backed up as part of ~/keep); the service passes it explicitly.
	// Defaults to <exe dir>/data so a bare local run still works.
	dataDir := flag.String("data", "", "durable user-data dir (holds users/*.jsonl); default <exe dir>/data")
	flag.Parse()

	exe, _ := os.Executable()
	root := filepath.Dir(exe)
	webDir = filepath.Join(root, "web")
	mediaDir = filepath.Join(root, "media")
	textsDir = filepath.Join(root, "texts")
	dd := *dataDir
	if dd == "" {
		dd = filepath.Join(root, "data")
	}
	usersDir = filepath.Join(dd, "users")
	newsDir = filepath.Join(dd, "news") // last-good news fetch, cached to disk

	mux := http.NewServeMux()
	mux.HandleFunc("/", handle)
	srv := &http.Server{Addr: *addr, Handler: mux, ReadHeaderTimeout: 15 * time.Second}
	if err := srv.ListenAndServe(); err != nil {
		fmt.Fprintln(os.Stderr, "FATAL:", err)
		os.Exit(1)
	}
}

func handle(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		doGET(w, r)
	case http.MethodPost:
		doPOST(w, r)
	default:
		sendJSON(w, 405, map[string]any{"error": "method not allowed"})
	}
}

func doGET(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path // net/http has already percent-decoded this
	switch {
	case path == "/health":
		sendJSON(w, 200, map[string]any{"ok": true})
	case path == "/api/runs":
		getRuns(w, r)
	case path == "/api/media":
		sendJSON(w, 200, scanMedia())
	case path == "/api/texts":
		sendJSON(w, 200, scanTexts())
	case path == "/api/news":
		sendJSON(w, 200, getNews())
	case strings.HasPrefix(path, "/media/"):
		// ranged serving (206) lets <video>/<audio> seek -- ServeContent does it.
		serveFile(w, r, safeJoin(mediaDir, path[len("/media/"):]), false)
	case strings.HasPrefix(path, "/texts/"):
		serveFile(w, r, safeJoin(textsDir, path[len("/texts/"):]), false)
	default:
		rel := strings.TrimPrefix(path, "/")
		if rel == "" {
			rel = "index.html"
		}
		// instrument samples et al under assets/ vendor/ are sizable and
		// effectively immutable -- let the browser cache them.
		cache := strings.HasPrefix(rel, "assets/") || strings.HasPrefix(rel, "vendor/")
		serveFile(w, r, safeJoin(webDir, rel), cache)
	}
}

func getRuns(w http.ResponseWriter, r *http.Request) {
	uf := userFile(r.URL.Query().Get("user"))
	if uf == "" {
		sendJSON(w, 400, map[string]any{"error": "bad user"})
		return
	}
	if !fileExists(uf) {
		sendJSON(w, 404, map[string]any{"error": "no such user"})
		return
	}
	data, err := os.ReadFile(uf)
	if err != nil {
		sendJSON(w, 500, map[string]any{"error": "read failed"})
		return
	}
	// Each non-empty line is one run object; pass it through verbatim (it was
	// written as valid compact JSON), skipping any corrupt line.
	runs := []json.RawMessage{}
	for _, line := range strings.Split(string(data), "\n") {
		if line = strings.TrimSpace(line); line != "" && json.Valid([]byte(line)) {
			runs = append(runs, json.RawMessage(line))
		}
	}
	sendJSON(w, 200, map[string]any{"runs": runs})
}

func doPOST(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	body := readBody(r)
	if body == nil {
		sendJSON(w, 400, map[string]any{"error": "bad request"})
		return
	}

	if path == "/api/login" || path == "/api/user" {
		uf := userFile(str(body["user"]))
		if uf == "" {
			sendJSON(w, 400, map[string]any{"error": "bad user"})
			return
		}
		name := strings.TrimSuffix(filepath.Base(uf), ".jsonl")
		var code int
		var resp map[string]any
		runsLock.Lock()
		if path == "/api/user" { // create: the name must be free
			if fileExists(uf) {
				code, resp = 409, map[string]any{"error": "taken"}
			} else {
				os.MkdirAll(usersDir, 0o755)
				if f, err := os.OpenFile(uf, os.O_CREATE|os.O_WRONLY, 0o644); err == nil {
					f.Close()
				}
				code, resp = 200, map[string]any{"ok": true, "user": name}
			}
		} else if !fileExists(uf) { // login: the name must exist
			code, resp = 404, map[string]any{"error": "no such user"}
		} else {
			code, resp = 200, map[string]any{"ok": true, "user": name}
		}
		runsLock.Unlock()
		sendJSON(w, code, resp)
		return
	}

	if path != "/api/runs" {
		sendJSON(w, 404, map[string]any{"error": "not found"})
		return
	}
	uf := userFile(str(body["user"]))
	delete(body, "user")
	if uf == "" || !fileExists(uf) {
		sendJSON(w, 400, map[string]any{"error": "bad user"})
		return
	}
	if !truthy(body["t"]) || !truthy(body["game"]) {
		sendJSON(w, 400, map[string]any{"error": "bad run"})
		return
	}
	var line bytes.Buffer
	enc := json.NewEncoder(&line)
	enc.SetEscapeHTML(false) // keep Thai/text names literal, like Python's ensure_ascii=False
	if enc.Encode(body) != nil {
		sendJSON(w, 400, map[string]any{"error": "bad run"})
		return
	}
	runsLock.Lock()
	if f, err := os.OpenFile(uf, os.O_APPEND|os.O_WRONLY, 0o644); err == nil {
		f.Write(line.Bytes()) // Encode already appended the newline
		f.Close()
	}
	runsLock.Unlock()
	sendJSON(w, 200, map[string]any{"ok": true})
}

// --- media / texts listing -------------------------------------------------

func scanMedia() map[string]any {
	pairs := []map[string]any{}
	entries, err := os.ReadDir(mediaDir) // ReadDir returns entries sorted by name
	if err == nil {
		var files []string
		for _, e := range entries {
			files = append(files, e.Name())
		}
		for _, fn := range files {
			if strings.ToLower(filepath.Ext(fn)) != ".srt" {
				continue
			}
			stem := strings.TrimSuffix(fn, filepath.Ext(fn))
			for _, cand := range files {
				if strings.TrimSuffix(cand, filepath.Ext(cand)) == stem &&
					mediaExts[strings.ToLower(filepath.Ext(cand))] {
					pairs = append(pairs, map[string]any{
						"name": stem, "media": "media/" + cand, "subs": "media/" + fn,
					})
					break
				}
			}
		}
	}
	return map[string]any{"pairs": pairs}
}

func scanTexts() map[string]any {
	texts := []map[string]any{}
	entries, _ := os.ReadDir(textsDir)
	for _, e := range entries {
		fn := e.Name()
		if !strings.HasSuffix(fn, ".txt") {
			continue
		}
		title := fn // first line of the file is its display title
		if f, err := os.Open(filepath.Join(textsDir, fn)); err == nil {
			sc := bufio.NewScanner(f)
			if sc.Scan() {
				if t := strings.TrimSpace(sc.Text()); t != "" {
					title = t
				}
			}
			f.Close()
		}
		texts = append(texts, map[string]any{"name": fn, "title": title, "path": "texts/" + fn})
	}
	return map[string]any{"texts": texts}
}

// --- news (the one outbound fetch) -----------------------------------------

type rssFeed struct {
	Items []struct {
		Title       string `xml:"title"`
		Link        string `xml:"link"`
		Description string `xml:"description"`
		PubDate     string `xml:"pubDate"`
	} `xml:"channel>item"`
}

type newsItem struct {
	Source string `json:"source"`
	Title  string `json:"title"`
	Lead   string `json:"lead"`
	Link   string `json:"link"`
	T      int64  `json:"t"` // publish time, epoch ms (0 if unparseable)
}

// getNews fetches every feed concurrently and merges the items newest-first.
// Any items at all → fresh (and cached to disk). Only if every feed is
// unreachable do we fall back to the on-disk cache, flagged stale.
func getNews() map[string]any {
	results := make([][]newsItem, len(newsFeeds))
	var wg sync.WaitGroup
	for i, f := range newsFeeds {
		wg.Add(1)
		go func(i int, name, url string) {
			defer wg.Done()
			results[i] = fetchFeed(name, url)
		}(i, f.name, f.url)
	}
	wg.Wait()

	seen := map[string]bool{}
	var items []newsItem
	for _, rs := range results {
		for _, it := range rs {
			key := it.Link
			if key == "" {
				key = it.Source + "|" + it.Title
			}
			if seen[key] {
				continue
			}
			seen[key] = true
			items = append(items, it)
		}
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].T > items[j].T })
	if len(items) > 48 {
		items = items[:48]
	}

	if len(items) > 0 {
		payload := map[string]any{"items": items, "fetchedAt": time.Now().UnixMilli(), "stale": false}
		saveNewsCache(payload)
		return payload
	}
	if cached := loadNewsCache(); cached != nil {
		cached["stale"] = true // reachable feeds gave nothing; this is the last good copy
		return cached
	}
	return map[string]any{"items": []any{}, "stale": true, "error": "no feeds reachable"}
}

func fetchFeed(name, url string) []newsItem {
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (thai-typing)")
	client := &http.Client{Timeout: 12 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20)) // 4 MiB is plenty for a feed
	if err != nil {
		return nil
	}
	var feed rssFeed
	if xml.Unmarshal(data, &feed) != nil {
		return nil
	}
	var out []newsItem
	for _, it := range feed.Items {
		title := cleanText(it.Title)
		lead := cleanText(it.Description)
		if lead == "" {
			lead = title
		}
		if title == "" || !hasThai(lead) { // skip empties and non-Thai (e.g. sponsor rows)
			continue
		}
		out = append(out, newsItem{
			Source: name, Title: title, Lead: clampLead(lead),
			Link: strings.TrimSpace(it.Link), T: parseRSSDate(it.PubDate),
		})
	}
	return out
}

var tagRe = regexp.MustCompile(`<[^>]*>`)
var wsRe = regexp.MustCompile(`\s+`)

// cleanText strips the HTML feeds embed in titles/descriptions down to the plain
// Thai prose you actually type: tags out, entities decoded, WordPress boilerplate
// ("The post … appeared first on", "[…]", "อ่านต่อ") trimmed, whitespace collapsed.
func cleanText(s string) string {
	s = tagRe.ReplaceAllString(s, " ")
	s = html.UnescapeString(s)
	if i := strings.Index(s, "The post "); i >= 0 {
		s = s[:i]
	}
	s = strings.NewReplacer("[…]", " ", "[...]", " ", "อ่านต่อ", " ", "Read More", " ").Replace(s)
	return strings.TrimSpace(wsRe.ReplaceAllString(s, " "))
}

// clampLead keeps a lead to ~one comfortable typing minute; Thai has no spaces,
// so an over-length excerpt is just cut on a rune boundary with an ellipsis.
func clampLead(s string) string {
	r := []rune(s)
	if len(r) <= 500 {
		return s
	}
	return strings.TrimSpace(string(r[:500])) + "…"
}

func hasThai(s string) bool {
	for _, r := range s {
		if r >= 0x0E00 && r <= 0x0E7F {
			return true
		}
	}
	return false
}

func parseRSSDate(s string) int64 {
	s = strings.TrimSpace(s)
	for _, layout := range []string{time.RFC1123Z, time.RFC1123,
		"Mon, 2 Jan 2006 15:04:05 -0700", time.RFC3339} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UnixMilli()
		}
	}
	return 0
}

func saveNewsCache(payload map[string]any) {
	os.MkdirAll(newsDir, 0o755)
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if enc.Encode(payload) == nil {
		os.WriteFile(filepath.Join(newsDir, "cache.json"), buf.Bytes(), 0o644)
	}
}

func loadNewsCache() map[string]any {
	data, err := os.ReadFile(filepath.Join(newsDir, "cache.json"))
	if err != nil {
		return nil
	}
	var m map[string]any
	if json.Unmarshal(data, &m) != nil {
		return nil
	}
	return m
}

// --- helpers ---------------------------------------------------------------

// userFile is the runs file for a valid username, else "". The regex is the
// traversal guard: it admits no '/', so the name can only be a file in USERS.
func userFile(name string) string {
	name = strings.ToLower(strings.TrimSpace(name))
	if userRe.MatchString(name) {
		return filepath.Join(usersDir, name+".jsonl")
	}
	return ""
}

// safeJoin resolves rel under base, refusing path traversal. filepath.Join
// cleans ".." lexically; the prefix check then rejects anything that escaped.
func safeJoin(base, rel string) string {
	base = filepath.Clean(base)
	p := filepath.Join(base, rel)
	if p == base || strings.HasPrefix(p, base+string(os.PathSeparator)) {
		return p
	}
	return ""
}

func serveFile(w http.ResponseWriter, r *http.Request, path string, cache bool) {
	if path == "" {
		sendJSON(w, 404, map[string]any{"error": "not found"})
		return
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		sendJSON(w, 404, map[string]any{"error": "not found"})
		return
	}
	f, err := os.Open(path)
	if err != nil {
		sendJSON(w, 404, map[string]any{"error": "not found"})
		return
	}
	defer f.Close()
	if cache {
		w.Header().Set("Cache-Control", "max-age=86400")
	} else {
		// no build step means no cache-busting hashes: force revalidation so a
		// deployed change is never masked by heuristic caching (LAN 304s are cheap)
		w.Header().Set("Cache-Control", "no-cache")
	}
	// ServeContent sets Content-Type by extension and handles Range/206/416,
	// Accept-Ranges, and conditional requests.
	http.ServeContent(w, r, filepath.Base(path), info.ModTime(), f)
}

func readBody(r *http.Request) map[string]any {
	n := r.ContentLength
	if n <= 0 || n > maxRunBytes {
		return nil
	}
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxRunBytes+1))
	if err != nil {
		return nil
	}
	var v any
	if json.Unmarshal(raw, &v) != nil {
		return nil
	}
	m, ok := v.(map[string]any) // must be a JSON object
	if !ok {
		return nil
	}
	return m
}

func sendJSON(w http.ResponseWriter, code int, obj any) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false) // ensure_ascii=False parity: literal UTF-8, no <
	enc.Encode(obj)
	body := bytes.TrimRight(buf.Bytes(), "\n")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	w.Write(body)
}

// str/truthy mirror how the Python read JSON values: a missing/None field is
// empty, and t/game are required to be truthy (a non-empty string).
func str(v any) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

func truthy(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case bool:
		return t
	case string:
		return t != ""
	case float64:
		return t != 0
	default:
		return true
	}
}

func fileExists(p string) bool {
	_, err := os.Stat(p)
	return err == nil
}
