#!/usr/bin/env python3
"""Render shaped Thai text to the raw grayscale format fbtest blits
(uint32-LE width, uint32-LE height, then width*height gray bytes).

Needs Pillow with libraqm (checked below) — naive renderers misplace Thai
tone marks. This is the proof-of-concept ancestor of the build-time atlas
generator; the real one will shape every cluster in the lesson corpus.

Usage: render-thai.py "ข้อความ" out.gray [size]
"""
import sys
import struct

from PIL import Image, ImageDraw, ImageFont, features

assert features.check("raqm"), "Pillow lacks raqm — Thai shaping would be wrong"

FONT = "/home/johan/thai-typing/kobo/assets/Sarabun-Regular.ttf"

text = sys.argv[1]
out = sys.argv[2]
size = int(sys.argv[3]) if len(sys.argv) > 3 else 110

font = ImageFont.truetype(FONT, size)
d = ImageDraw.Draw(Image.new("L", (1, 1)))
bbox = d.textbbox((0, 0), text, font=font, language="tha")
w, h = bbox[2] - bbox[0] + 40, bbox[3] - bbox[1] + 40

img = Image.new("L", (w, h), 255)
ImageDraw.Draw(img).text((20 - bbox[0], 20 - bbox[1]), text,
                         font=font, fill=0, language="tha")
with open(out, "wb") as f:
    f.write(struct.pack("<II", w, h))
    f.write(img.tobytes())
print(f"{w}x{h} -> {out}")
