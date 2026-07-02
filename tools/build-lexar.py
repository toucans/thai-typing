#!/usr/bin/env python3
"""Build web/assets/lexar/ from the sample library on the Lexar drive.

These are high-quality chromatic recordings (Decent Sampler library under
/mnt/lexar/oriental instruments/) that upgrade one ensemble role:

  kanun pluck  -> set "zith"   the khim/jakhe role (the kanun is the khim's
                               direct relative - same trapezoid zither family)

(The library's kaval and duduk were tried and retired: sustained winds didn't
fit the music's short-sounds-over-nature character.)

Output is GITIGNORED: this library is not redistributable, so it never enters
the repo. The app loads assets/lexar/manifest.json as an optional overlay on
the committed VCSL set (assets/ranat/) - a fresh clone still works, this box
just sounds better. Re-run after remounting the drive if the files vanish.

Stdlib only. Chromatic sources are thinned to every 3rd semitone; playbackRate
covers the gaps (max +-1 semitone stretch, inaudible).
"""
import json
import os
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from wavlib import read_wav, trim_normalize, write_wav

SRC = "/mnt/lexar/oriental instruments"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "assets", "lexar")

# (preset, our set name, filename prefix, keep every Nth semitone, max seconds)
PICKS = [
    ("Kanun/Kanun Pluck.dspreset", "zith", "kn", 3, 2.2),
]

midi_freq = lambda n: 440.0 * 2 ** ((n - 69) / 12)


def main():
    if not os.path.isdir(SRC):
        sys.exit(f"{SRC} not found - is the Lexar drive mounted?")
    os.makedirs(OUT, exist_ok=True)
    manifest = []
    for preset, setname, prefix, step, max_secs in PICKS:
        root = ET.parse(os.path.join(SRC, preset)).getroot()
        samples = sorted(root.findall(".//sample"), key=lambda s: int(s.get("rootNote")))
        base = int(samples[0].get("rootNote"))
        for s in samples:
            note = int(s.get("rootNote"))
            if (note - base) % step:
                continue
            path = os.path.join(SRC, os.path.dirname(preset), s.get("path"))
            x, rate = read_wav(path)
            x = trim_normalize(x, rate, max_secs)
            name = f"{prefix}_{note}.wav"
            write_wav(os.path.join(OUT, name), x, rate)
            manifest.append({"file": name, "set": setname, "layer": "solo",
                             "freq": round(midi_freq(note), 2)})
            print(f"{name}  {setname}  {midi_freq(note):7.1f}Hz  {len(x)/rate:.1f}s")
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"source": "local library (Lexar drive), NOT redistributable - gitignored",
                   "notes": manifest}, f, indent=1)
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f"done: {len(manifest)} samples, {total // 1024}KB total (local only)")


if __name__ == "__main__":
    main()
