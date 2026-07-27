#!/usr/bin/env python3
"""Segment a .srt into typing words, writing a copy with '|' between them.

Why this exists
---------------
ฟัง–พิมพ์ used to segment in the browser with Intl.Segmenter (ICU). ICU's Thai
dictionary is small and frozen, so anything not in it gets chopped: มิหนำซ้ำ came
out มิ + หนำซ้ำ, and every character name in an episode broke apart the same way.
There is no way to extend that dictionary from a browser, so segmentation moved
here — run once per episode, cached, served as the '|' markers the client already
understands (segment.ts: a cue containing '|' skips the automatic segmenter).

Two passes, because neither tool alone is right for a typing trainer:

  1. deepcut (char-level CNN, ~96 F1) gets the words no dictionary has — names,
     transliterations, particles — which is exactly where ICU failed.

  2. It is trained on BEST, which segments to the smallest meaningful unit, so it
     hands back โรง|เรียน and นัก|เรียน. Being asked to type โรง and then เรียน is
     worse than the bug we came to fix, so a second pass rejoins runs of adjacent
     tokens that form a single dictionary word (thai-words.txt).

Measured on media/'Classroom of the Elite S1 EP01.srt' (387 cues): pass 1 alone
disagrees with ICU on 65% of cues; pass 2 rejoins ~23 โรงเรียน, ~17 นักเรียน and
~200 others, keeping deepcut's wins on โฮริคิตะ, พอยต์, เหรอ, มิหนำซ้ำ.

Cues already containing '|' are passed through untouched: a hand-corrected cue
outranks both passes, and that stays the escape hatch for what they get wrong.

Usage: segment-srt.py <in.srt> <out.srt>
"""
import os
import re
import sys

os.environ.setdefault("TF_CPP_MIN_LOG_LEVEL", "3")  # tensorflow's boot banner
os.environ.setdefault("CUDA_VISIBLE_DEVICES", "-1")  # CPU: the box has no GPU

HERE = os.path.dirname(os.path.abspath(__file__))
WORDS = os.path.join(HERE, "thai-words.txt")

THAI = re.compile(r"[฀-๿]")
# Repeat/abbreviation marks ride with the word before them, matching what the
# browser segmenter did (segment.ts) — ๆ is never a word you type on its own.
TRAILING = "ๆฯ"
MAX_JOIN = 4  # longest run of deepcut tokens the merge pass will fuse


def load_words(path):
    with open(path, encoding="utf-8") as f:
        return {
            w for w in (line.strip() for line in f)
            if w and not w.startswith("#")
        }


def merge(tokens, words):
    """Rejoin adjacent tokens that spell one dictionary word.

    Greedy left-to-right merging picks the wrong grouping when two candidates
    overlap (มี|ผล|ประโยชน์ becomes มีผล|ประโยชน์ rather than มี|ผลประโยชน์), so this
    is a DP over the whole cue: fewest groups wins, and ties go to the grouping
    whose dictionary words are longest (sum of squares) — which is what breaks
    that example the right way.
    """
    n = len(tokens)
    # cost[i] = (groups, -score) for the best segmentation of tokens[i:]
    best = [None] * (n + 1)
    best[n] = (0, 0)
    pick = [1] * (n + 1)
    for i in range(n - 1, -1, -1):
        for k in range(1, min(MAX_JOIN, n - i) + 1):
            joined = "".join(tokens[i:i + k])
            if k > 1 and joined not in words:
                continue
            groups, score = best[i + k]
            cand = (groups + 1, score - (len(joined) ** 2 if k > 1 else 0))
            if best[i] is None or cand < best[i]:
                best[i], pick[i] = cand, k
    out, i = [], 0
    while i < n:
        out.append("".join(tokens[i:i + pick[i]]))
        i += pick[i]
    return out


def attach_marks(tokens):
    """ๆ and ฯ join the token before them (deepcut emits them separately)."""
    out = []
    for t in tokens:
        if out and t and all(c in TRAILING for c in t):
            out[-1] += t
        else:
            out.append(t)
    return out


def segment_line(text, words, tokenize):
    """One cue's text → the same text with '|' between typing words.

    deepcut sees the whole line at once (it emits spaces as their own tokens),
    so real spaces survive as spaces — the client reads those as phrase breaks,
    and only the runs between them get '|'.
    """
    if "|" in text or "​" in text:
        return text  # hand-corrected: leave it exactly as written
    chunks, current = [], []
    for tok in tokenize(text):
        if tok.strip() == "":
            if current:
                chunks.append(current)
                current = []
            chunks.append(tok)  # the whitespace itself, preserved verbatim
        else:
            current.append(tok)
    if current:
        chunks.append(current)
    out = []
    for chunk in chunks:
        if isinstance(chunk, str):
            out.append(chunk)
        elif any(THAI.search(t) for t in chunk):
            out.append("|".join(merge(attach_marks(chunk), words)))
        else:
            out.append("".join(chunk))  # no Thai: nothing here gets typed
    return "".join(out)


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__.strip().splitlines()[-1])
    src, dest = sys.argv[1], sys.argv[2]
    words = load_words(WORDS)
    import deepcut  # after the arg check: importing tensorflow costs ~8s

    with open(src, encoding="utf-8-sig") as f:
        lines = f.read().split("\n")

    # An .srt block is index / timing / text…; only the text lines are touched,
    # and everything else (including the exact blank-line layout) is copied
    # through, so the cached file stays a valid .srt the client parses as usual.
    out, in_text = [], False
    for line in lines:
        stripped = line.strip()
        if stripped == "":
            in_text = False
            out.append(line)
        elif "-->" in line:
            in_text = True
            out.append(line)
        elif in_text and THAI.search(line):
            out.append(segment_line(line, words, deepcut.tokenize))
        else:
            out.append(line)

    with open(dest, "w", encoding="utf-8") as f:
        f.write("\n".join(out))


if __name__ == "__main__":
    main()
