// Shared types. The centre of gravity is the run record: one JSONL line per
// finished session in ~/keep/thai-typing/users/<name>.jsonl, which is the
// single source of truth for everything the app shows.
//
// Runs are heterogeneous by design — a speed run carries cpm/level, a dictation
// run carries misses/mastered — so `game` is the discriminant and `Run` is the
// union. The Go server passes runs through
// verbatim and validates no schema (see getRuns in main.go); that is deliberate,
// and this union is the client-side reading of the same data, not a contract
// imposed on the file.

// เส้นทาง levels, เรื่องอ่าน stories and ข่าว articles: one engine (speed.ts),
// two tags. `level`/`pb` are speed only; `src` (สำนักข่าว) is stamped on ข่าว.
export interface TypingRun {
  game: 'speed' | 'text';
  t: string; // ISO timestamp, stamped by saveRun
  cpm: number;
  acc: number;
  chars: number;
  errors: number;
  secs: number;
  stars: number;
  level?: number;
  pb?: boolean;
  name?: string;
  src?: string;
}

// A word missed in ฟัง–พิมพ์, with the cue to replay it from — the whole of
// what carries an unmastered word into the next session.
export interface DictationMiss {
  w: string;
  cue: number;
}

export interface DictationRun {
  game: 'dictation';
  t: string;
  name: string; // the media pair's name
  cues: number;
  words: number;
  acc: number;
  secs: number;
  chars: number;
  read?: boolean; // ดูแล้วพิมพ์: copy-typing, so no spelling state is logged
  misses?: DictationMiss[];
  mastered?: string[];
  ignored?: string[]; // ไม่ต้องจำ: out of the loop for good
}

// พิมพ์ไล่ผี, the night hunt, was removed on 2026-07-25. Nothing writes this
// shape any more, but the run log is append-only and old ghost runs are still
// in it — they keep counting toward the lifetime totals, so the union still
// has to describe them.
export interface GhostRun {
  game: 'ghosts';
  t: string;
  night: number;
  cleared: boolean;
  cpm: number;
  acc: number;
  chars: number;
  errors: number;
  secs: number;
  ghosts: number;
}

export type Run = TypingRun | DictationRun | GhostRun;

// Distributive Omit: a plain Omit<Run, 't'> would collapse the union down to
// its shared keys, losing the per-game fields.
type DistOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

// What a game hands to saveRun; the timestamp is the server-side truth, added
// there.
export type NewRun = DistOmit<Run, 't'>;

// ---- server payloads -------------------------------------------------------
export interface MediaPair {
  name: string;
  media: string;
  subs: string;
}

export interface TextFile {
  name: string;
  title: string;
  path: string;
}

export interface NewsItem {
  source: string;
  title: string;
  lead: string;
  link: string;
  t?: string;
}

export interface NewsFeed {
  items?: NewsItem[];
  sources?: string[];
  fetchedAt?: number;
  stale?: boolean;
}

// /api/article: the full story, server-extracted and disk-cached. `ok` false or
// no paragraphs means the reader falls back to typing the RSS lead.
export interface Article {
  ok?: boolean;
  headline?: string;
  dateISO?: string;
  image?: string;
  partial?: boolean;
  paragraphs?: string[];
}
