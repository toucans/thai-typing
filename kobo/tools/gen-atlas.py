#!/usr/bin/env python3
"""gen-atlas.py — build-time glyph atlas for the thai-kobo trainer.

Renders every shaped Thai cluster the app can ever display (Pillow+raqm+
Sarabun on the NUC) into one binary atlas; the device blits bitmaps and
carries zero font tech. Grown from render-thai.py, which it supersedes.

A "cluster" is a base character plus its combining marks (mai han akat,
sara am, above/below vowels, tone marks). The app composes words by
blitting clusters side by side; typed-so-far feedback ends mid-cluster,
so the atlas holds every codepoint *prefix* of every cluster.
This segmentation is mirrored in cmd/thai-kobo/atlas.go — keep in lockstep.

Size classes:
  L  the current word and the typed line
  S  the upcoming-words context line
  U  header / result-card labels (stored as whole shaped strings)

Atlas format (little-endian), mirrored by cmd/thai-kobo/atlas.go:
  "TKA1"  u16 nclasses  { u8 class  u16 ascent  u16 descent }...
  u32 nentries
  { u8 class  u16 keylen  key-utf8  i16 dx  i16 dy(from baseline)
    u16 w  u16 h  u16 advance  w*h gray bytes }...

Usage: gen-atlas.py data.json atlas.bin
"""
import json
import struct
import sys

from PIL import Image, ImageDraw, ImageFont, ImageOps, features

assert features.check("raqm"), "Pillow lacks raqm — Thai shaping would be wrong"

FONT = f"{sys.path[0]}/../assets/Sarabun-Regular.ttf"
SIZES = {"L": 140, "S": 54, "U": 44}

# Combining marks that attach to the preceding base character. The Go side
# (atlas.go isCombining) must agree exactly.
COMBINING = set(
    [0x0E31, 0x0E33] + list(range(0x0E34, 0x0E3B)) + list(range(0x0E47, 0x0E4F))
)

# Every character the Kedmanee layout can produce (cmd/thai-kobo/kedmanee.go):
# standalone entries so even wrong keystrokes render something sensible.
KEDMANEE = (
    "ๅ/-ภถุึคตจขชๆไำพะัีรนยบลฟหกดเ้่าสวงผปแอิืทมใฝ"
    "+๑๒๓๔ู฿๕๖๗๘๙๐\"ฎฑธํ๊ณฯญฐ,ฅฤฆฏโฌ็๋ษศซ.()ฉฮฺ์?ฒฬฦ_% "
)

UI_STRINGS = [
    "ด่าน", "โบนัสสุภาษิต", "ตัวอักษร/นาที", "ความแม่นยำ", "สถิติใหม่!",
    "วรรค = ด่านต่อไป", "ลบ = เล่นอีกครั้ง", "×", "%", " ",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
]


def clusters(word):
    out = []
    for ch in word:
        if out and ord(ch) in COMBINING:
            out[-1] += ch
        else:
            out.append(ch)
    return out


def star(size, filled):
    """Programmatic 5-point star — Sarabun has no ★."""
    import math
    img = Image.new("L", (size, size), 255)
    cx, cy, r1, r2 = size / 2, size / 2, size / 2 - 1, size / 5
    pts = []
    for i in range(10):
        r = r1 if i % 2 == 0 else r2
        a = -math.pi / 2 + i * math.pi / 5
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    ImageDraw.Draw(img).polygon(pts, fill=0 if filled else 180)
    return img


def main():
    data = json.load(open(sys.argv[1]))
    words = set(data["words"])
    for s in data["sentences"]:
        words.update(s)

    # key sets per class: L gets every cluster prefix (typed feedback can end
    # mid-cluster) plus Kedmanee singles; S needs only complete clusters.
    keys = {"L": set(KEDMANEE), "S": {" "}, "U": set(UI_STRINGS)}
    for w in words:
        for c in clusters(w):
            keys["S"].add(c)
            for i in range(1, len(c) + 1):
                keys["L"].add(c[:i])

    fonts = {cl: ImageFont.truetype(FONT, sz) for cl, sz in SIZES.items()}
    measure = ImageDraw.Draw(Image.new("L", (1, 1)))

    entries = []
    widest = ("", 0)
    for cl, ks in keys.items():
        font = fonts[cl]
        ascent, descent = font.getmetrics()
        pad = SIZES[cl]  # marks can overhang the em box; render roomy, crop to ink
        for key in sorted(ks):
            adv = round(measure.textlength(key, font=font, language="tha"))
            img = Image.new("L", (adv + 2 * pad, ascent + descent + 2 * pad), 255)
            # pen at (pad, pad); baseline is then at y = pad + ascent
            ImageDraw.Draw(img).text((pad, pad), key, font=font, fill=0, language="tha")
            # ink extent: getbbox boxes non-zero pixels, so invert (white bg = 0)
            bbox = ImageOps.invert(img).getbbox()
            if bbox is None:  # spaces: advance only, no bitmap
                entries.append((cl, key, 0, 0, 0, 0, adv, b""))
                continue
            x0, y0, x1, y1 = bbox
            crop = img.crop(bbox)
            entries.append((cl, key, x0 - pad, y0 - (pad + ascent),
                            x1 - x0, y1 - y0, adv, crop.tobytes()))
        if cl == "L":
            for w in words:
                width = sum(round(measure.textlength(c, font=font, language="tha"))
                            for c in clusters(w))
                if width > widest[1]:
                    widest = (w, width)

    for filled in (True, False):
        img = star(SIZES["U"] * 2, filled)
        entries.append(("U", "_star1" if filled else "_star0",
                        0, -img.height, img.width, img.height, img.width + 12,
                        img.tobytes()))

    with open(sys.argv[2], "wb") as f:
        f.write(b"TKA1")
        f.write(struct.pack("<H", len(SIZES)))
        for cl in SIZES:
            ascent, descent = fonts[cl].getmetrics()
            f.write(struct.pack("<BHH", ord(cl), ascent, descent))
        f.write(struct.pack("<I", len(entries)))
        for cl, key, dx, dy, w, h, adv, bits in entries:
            kb = key.encode()
            f.write(struct.pack("<BH", ord(cl), len(kb)) + kb)
            f.write(struct.pack("<hhHHH", dx, dy, w, h, adv))
            f.write(bits)

    total = sum(len(e[7]) for e in entries)
    print(f"{len(entries)} glyphs, {total / 1e6:.1f} MB bitmap, "
          f"widest L word: {widest[0]!r} = {widest[1]}px")


if __name__ == "__main__":
    main()
