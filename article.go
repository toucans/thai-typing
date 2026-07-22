// The ข่าว reader's server side: fetch one full news article on demand, extract
// its real body + date + hero image, and cache both to disk. The list stays RSS
// (cheap, durable); this runs only when a story is opened.
//
// Extraction is a standard-first cascade, per source reality (verified 2026-07):
//   - metadata (headline, date, image) comes from JSON-LD (schema.org
//     NewsArticle/BlogPosting — a documented contract), falling back to
//     og:/article: <meta> tags, falling back to the cached RSS item;
//   - the body comes from each site's article container (one marker string per
//     host), split on block boundaries and junk-filtered — ไทยรัฐ's JSON-LD
//     articleBody is kept as a body fallback (full text, but unparagraphed);
//   - if no real body survives, the RSS lead is returned with partial:true —
//     still typeable, honestly labeled, never a dead card.
//
// Every outbound fetch is allowlisted: article URLs must resolve to a feed's
// own host (SSRF guard — the server sits on johan's LAN), image URLs to a feed
// host or an enumerated CDN host, https only, on every redirect hop.
package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

// articleHosts: the only hosts /api/article may fetch — the feeds' own.
var articleHosts = map[string]bool{
	"www.thairath.co.th":  true,
	"www.khaosod.co.th":   true,
	"prachatai.com":       true,
	"www.matichon.co.th":  true,
}

// imageHosts: articleHosts plus the CDN hosts the sites actually serve photos
// from (only ไทยรัฐ uses a separate static host today).
var imageHosts = map[string]bool{
	"static.thairath.co.th": true,
}

// bodyMarker: where each site's article body starts in its HTML — one marker
// string per host, the entire per-source knowledge this feature carries.
var bodyMarker = map[string]string{
	"www.thairath.co.th": `article-content`,
	"www.khaosod.co.th":  `itemprop="articleBody"`,
	"www.matichon.co.th": `td-post-content`,
	"prachatai.com":      `<article`, // Drupal: the one <article> node wraps the story
}

// After the body: related-story rails, tag lists, footers. Seeing one of these
// in a block means the article is over — drop it and everything after.
var stopPhrases = []string{
	"ข่าวที่เกี่ยวข้อง", "เรื่องที่เกี่ยวข้อง", "อ่านข่าวที่เกี่ยวข้อง",
	"แท็กที่เกี่ยวข้อง", "Copyright ©", "ข่าวแนะนำ", "ข่าวเด่นประจำวัน",
	"อัลบั้มภาพ", "ร่วมบริจาคเงิน", "ติดตามประชาไท",
}

// Boilerplate that rides inside the body: share prompts, source credits,
// breadcrumbs, leaked CSS. Blocks containing these are dropped, the rest kept.
var junkPhrases = []string{
	"ติดตามข่าว", "อ่านข่าวต้นฉบับ", "อ่านเพิ่มเติม", "ที่มา :", "ที่มา:",
	"ประชาไท / ", "เผยแพร่เมื่อ", "อ่านออกเสียง", "Web Speech API",
	"อัพเดทล่าสุด", ".css-", "{",
}

type article struct {
	Ok         bool     `json:"ok"`
	Source     string   `json:"source,omitempty"`
	Headline   string   `json:"headline,omitempty"`
	DateISO    string   `json:"dateISO,omitempty"`
	Image      string   `json:"image,omitempty"` // same-origin path (api/news-image?h=…) or ""
	Paragraphs []string `json:"paragraphs,omitempty"`
	Partial    bool     `json:"partial"`
	Link       string   `json:"link,omitempty"`
	Error      string   `json:"error,omitempty"`
}

func articlesDir() string { return filepath.Join(newsDir, "articles") }
func imgDir() string      { return filepath.Join(newsDir, "img") }

func hashKey(s string) string {
	h := sha256.Sum256([]byte(s))
	return hex.EncodeToString(h[:12])
}

// ---- GET /api/article ------------------------------------------------------

func getArticle(w http.ResponseWriter, r *http.Request) {
	src := r.URL.Query().Get("src")
	link := strings.TrimSpace(r.URL.Query().Get("link"))
	if err := checkArticleURL(link); err != nil {
		sendJSON(w, 200, article{Ok: false, Error: err.Error()})
		return
	}

	// disk cache: a full extraction is immutable — serve it forever. A partial
	// one gets another chance at the real body on each open.
	cachePath := filepath.Join(articlesDir(), hashKey(link)+".json")
	var cached *article
	if data, err := os.ReadFile(cachePath); err == nil {
		var a article
		if json.Unmarshal(data, &a) == nil && a.Ok {
			if !a.Partial {
				sendJSON(w, 200, a)
				return
			}
			cached = &a
		}
	}

	a := extractArticle(src, link)
	if !a.Ok && cached != nil {
		sendJSON(w, 200, *cached) // source down now; the last good partial still types
		return
	}
	if a.Ok {
		os.MkdirAll(articlesDir(), 0o755)
		if buf, err := json.Marshal(a); err == nil {
			os.WriteFile(cachePath, buf, 0o644)
		}
	}
	sendJSON(w, 200, a)
}

// checkArticleURL is the SSRF guard: the client names the URL, so nothing may
// be fetched unless it is https on a known feed host. Enforced again on every
// redirect hop by newsHTTPClient.
func checkArticleURL(link string) error {
	u, err := url.Parse(link)
	if err != nil || u.Scheme != "https" || !articleHosts[u.Hostname()] ||
		(u.Port() != "" && u.Port() != "443") {
		return errors.New("bad link")
	}
	return nil
}

func newsHTTPClient(allowed map[string]bool) *http.Client {
	return &http.Client{
		Timeout: 12 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 5 {
				return errors.New("too many redirects")
			}
			if req.URL.Scheme != "https" || !allowed[req.URL.Hostname()] {
				return errors.New("redirect off allowlist")
			}
			return nil
		},
	}
}

func fetchURL(rawurl string, allowed map[string]bool, cap int64) ([]byte, string, error) {
	req, err := http.NewRequest(http.MethodGet, rawurl, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (thai-typing)")
	resp, err := newsHTTPClient(allowed).Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, "", fmt.Errorf("status %d", resp.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, cap))
	if err != nil {
		return nil, "", err
	}
	return data, resp.Header.Get("Content-Type"), nil
}

// ---- extraction cascade ------------------------------------------------------

func extractArticle(src, link string) article {
	page, _, err := fetchURL(link, articleHosts, 4<<20)
	if err != nil {
		return article{Ok: false, Error: "fetch failed"}
	}
	host := mustHost(link)
	doc := string(page)

	headline, dateISO, imageURL, ldBody := extractJSONLD(doc)
	if dateISO == "" {
		dateISO = metaContent(doc, "article:published_time")
	}
	if imageURL == "" {
		imageURL = metaContent(doc, "og:image")
	}

	// the cached RSS pull fills whatever the page didn't say — and is the
	// honest fallback body when full-text extraction comes up empty. The feed
	// title beats og:title (which drags a " | site" suffix along).
	feedTitle, feedLead, feedT := feedItem(link)
	if headline == "" {
		headline = feedTitle
	}
	if headline == "" {
		headline = metaContent(doc, "og:title")
	}
	if dateISO == "" && feedT > 0 {
		dateISO = time.UnixMilli(feedT).Format(time.RFC3339)
	}

	paras := bodyBlocks(doc, host, headline)
	partial := false
	if thaiLen(paras) < 300 {
		// no real body from the container; ไทยรัฐ-style JSON-LD articleBody is
		// still the full text (one flat paragraph beats a two-line lead)
		if lb := cleanBlocks(strings.Split(ldBody, "\n"), headline); thaiLen(lb) >= 300 {
			paras = lb
		} else if feedLead != "" {
			paras, partial = []string{feedLead}, true
		} else {
			return article{Ok: false, Error: "no text"}
		}
	}

	return article{
		Ok: true, Source: src, Headline: strings.TrimSpace(headline),
		DateISO: dateISO, Image: cacheImage(imageURL),
		Paragraphs: paras, Partial: partial, Link: link,
	}
}

func mustHost(link string) string {
	u, _ := url.Parse(link)
	return u.Hostname()
}

var ldScriptRe = regexp.MustCompile(`(?is)<script[^>]*application/ld\+json[^>]*>(.*?)</script>`)

// extractJSONLD walks every ld+json block for the article node and returns its
// headline, datePublished, image URL and articleBody (each "" if absent).
func extractJSONLD(doc string) (headline, date, image, body string) {
	for _, m := range ldScriptRe.FindAllStringSubmatch(doc, -1) {
		var v any
		if json.Unmarshal([]byte(m[1]), &v) != nil {
			continue
		}
		if n := findArticleNode(v); n != nil {
			headline = str(n["headline"])
			date = str(n["datePublished"])
			image = ldImage(n["image"])
			body = str(n["articleBody"])
			return
		}
	}
	return
}

func findArticleNode(v any) map[string]any {
	switch t := v.(type) {
	case []any:
		for _, e := range t {
			if n := findArticleNode(e); n != nil {
				return n
			}
		}
	case map[string]any:
		switch str(t["@type"]) {
		case "NewsArticle", "Article", "BlogPosting":
			return t
		}
		if g, ok := t["@graph"]; ok {
			return findArticleNode(g)
		}
	}
	return nil
}

// ldImage: schema.org image is a string, an ImageObject {url}, or a list of either.
func ldImage(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case map[string]any:
		return str(t["url"])
	case []any:
		if len(t) > 0 {
			return ldImage(t[0])
		}
	}
	return ""
}

func metaContent(doc, prop string) string {
	re := regexp.MustCompile(`<meta[^>]*(?:property|name)="` + regexp.QuoteMeta(prop) + `"[^>]*content="([^"]*)"`)
	if m := re.FindStringSubmatch(doc); m != nil {
		return strings.TrimSpace(html.UnescapeString(m[1]))
	}
	return ""
}

// feedItem finds the RSS item for a link in the on-disk news cache: its title,
// lead and publish time backfill whatever the article page didn't provide.
func feedItem(link string) (title, lead string, t int64) {
	cached := loadNewsCache()
	if cached == nil {
		return
	}
	items, _ := cached["items"].([]any)
	for _, it := range items {
		m, ok := it.(map[string]any)
		if !ok || str(m["link"]) != link {
			continue
		}
		title, lead = str(m["title"]), str(m["lead"])
		if f, ok := m["t"].(float64); ok {
			t = int64(f)
		}
		return
	}
	return
}

// ---- body blocks --------------------------------------------------------------

var (
	scriptStyleRe = regexp.MustCompile(`(?is)<(script|style)[^>]*>.*?</(script|style)>`)
	blockEndRe    = regexp.MustCompile(`(?i)</(p|div|h[1-6]|li|blockquote|figcaption)>|<br\s*/?>`)
)

// bodyBlocks slices the page at the host's body marker and splits the fragment
// into paragraph blocks: block-level closers become newlines, tags drop away,
// entities decode — same regex school as cleanText, no HTML tree needed.
func bodyBlocks(doc, host, headline string) []string {
	marker := bodyMarker[host]
	if marker == "" {
		return nil
	}
	i := strings.Index(doc, marker)
	if i < 0 {
		return nil
	}
	seg := doc[i:]
	if len(seg) > 500_000 {
		seg = seg[:500_000]
	}
	if j := strings.Index(seg, ">"); j >= 0 { // skip the rest of the marker's own tag
		seg = seg[j+1:]
	}
	seg = scriptStyleRe.ReplaceAllString(seg, " ")
	seg = blockEndRe.ReplaceAllString(seg, "\n")
	seg = tagRe.ReplaceAllString(seg, " ")
	seg = html.UnescapeString(seg)
	return cleanBlocks(strings.Split(seg, "\n"), headline)
}

// cleanBlocks keeps only real prose: Thai text that isn't the headline again,
// isn't boilerplate, and comes before the related-stories rail.
func cleanBlocks(blocks []string, headline string) []string {
	headline = strings.TrimSpace(headline)
	var out []string
	for _, b := range blocks {
		b = strings.TrimSpace(wsRe.ReplaceAllString(b, " "))
		if stop := func() bool {
			for _, s := range stopPhrases {
				if strings.Contains(b, s) {
					return true
				}
			}
			return false
		}(); stop {
			break
		}
		// prose only: nav/tag links and captions' stubs are short, real news
		// paragraphs aren't — and the headline shows up again as the page <h1>
		if b == "" || !hasThai(b) || b == headline || len([]rune(b)) < 25 {
			continue
		}
		if junk := func() bool {
			for _, s := range junkPhrases {
				if strings.Contains(b, s) {
					return true
				}
			}
			return false
		}(); junk {
			continue
		}
		out = append(out, b)
	}
	return out
}

func thaiLen(blocks []string) int {
	n := 0
	for _, b := range blocks {
		for _, r := range b {
			if r >= 0x0E00 && r <= 0x0E7F {
				n++
			}
		}
	}
	return n
}

// ---- hero image: download once, serve same-origin ------------------------------

var extByType = map[string]string{
	"image/jpeg": ".jpg", "image/jpg": ".jpg", "image/png": ".png",
	"image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif",
}

// cacheImage downloads an allowed hero image to disk (once) and returns the
// same-origin path the client should use — "" for anything absent, off-list or
// broken; the layout simply omits the photo.
func cacheImage(rawurl string) string {
	rawurl = sanitizeImageURL(rawurl)
	if rawurl == "" {
		return ""
	}
	u, err := url.Parse(rawurl)
	if err != nil || u.Scheme != "https" ||
		(!articleHosts[u.Hostname()] && !imageHosts[u.Hostname()]) {
		return ""
	}
	key := hashKey(rawurl)
	if p := findImage(key); p != "" {
		return "api/news-image?h=" + key
	}
	allowed := map[string]bool{}
	for h := range articleHosts {
		allowed[h] = true
	}
	for h := range imageHosts {
		allowed[h] = true
	}
	data, ctype, err := fetchURL(rawurl, allowed, 8<<20)
	if err != nil || len(data) == 0 {
		return ""
	}
	ext := extByType[strings.TrimSpace(strings.SplitN(ctype, ";", 2)[0])]
	if ext == "" {
		return ""
	}
	os.MkdirAll(imgDir(), 0o755)
	if os.WriteFile(filepath.Join(imgDir(), key+ext), data, 0o644) != nil {
		return ""
	}
	return "api/news-image?h=" + key
}

// Prachatai's og:image glues two URLs into one attribute; keep only the first.
func sanitizeImageURL(rawurl string) string {
	rawurl = strings.TrimSpace(rawurl)
	if rawurl == "" {
		return ""
	}
	if i := strings.Index(rawurl[1:], "https://"); i >= 0 {
		rawurl = rawurl[:i+1]
	}
	return rawurl
}

var imgKeyRe = regexp.MustCompile(`^[0-9a-f]{24}$`)

func findImage(key string) string {
	if !imgKeyRe.MatchString(key) {
		return ""
	}
	for _, ext := range extByType {
		p := filepath.Join(imgDir(), key+ext)
		if fileExists(p) {
			return p
		}
	}
	return ""
}

// GET /api/news-image?h=<hash> — the cached hero image, same-origin. Immutable
// content (the key is the source URL's hash), so let the browser cache it.
func getNewsImage(w http.ResponseWriter, r *http.Request) {
	p := findImage(r.URL.Query().Get("h"))
	if p == "" {
		sendJSON(w, 404, map[string]any{"error": "not found"})
		return
	}
	serveFile(w, r, p, true)
}
