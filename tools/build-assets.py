#!/usr/bin/env python3
"""Build web/assets/ranat/ from VCSL (github.com/sgossner/VCSL, CC0).

No free ranat ek recordings exist anywhere (checked 2026-07); the closest real
instruments are VCSL's rosewood xylophone (hard mallets = the ranat ek's bright
ไม้แข็ง voice) and balafon (the mellow voice). The Thai character comes from how
music.js *plays* them: near-7-TET tuning, octave doubling, kro rolls, a ching
timekeeper (VCSL finger cymbals) and a soft gong at section starts.

Stdlib only. Re-run to rebuild the assets from source; output is committed so
the app never depends on GitHub being up.
"""
import json
import math
import os
import struct
import urllib.request
import wave

RAW = "https://raw.githubusercontent.com/sgossner/VCSL/master/"
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web", "assets", "ranat")

XYLO = "Idiophones/Struck Idiophones/Xylophone/Hard Mallets/Xylo_Hard_{n}_{v}_01_far.wav"
BALA = "Idiophones/Struck Idiophones/Balafon/Traditional Mallet/EthnicXylo_tradM_{n}_{v}_rr1_Mid.wav"

FREQ = {"C#3": 138.59, "F3": 174.61, "G3": 196.00, "C4": 261.63, "F4": 349.23,
        "G4": 392.00, "C5": 523.25, "F5": 698.46, "G5": 783.99, "C6": 1046.50,
        "G6": 1567.98}

# (source url path, output name, max seconds)
FILES = []
for n in ["G3", "C4", "G4", "C5", "G5", "C6", "G6"]:
    for v in ["pp", "ff"]:
        FILES.append((XYLO.format(n=n, v=v), f"x_{v}_{n.replace('#','s')}.wav", 2.5,
                      {"set": "xylo", "layer": v, "freq": FREQ[n]}))
for n in ["C#3", "F3", "C4", "F4", "C5", "F5"]:
    for v in ["vl1", "vl3"]:
        FILES.append((BALA.format(n=n, v=v), f"b_{v}_{n.replace('#','s')}.wav", 2.5,
                      {"set": "bala", "layer": "pp" if v == "vl1" else "ff", "freq": FREQ[n]}))
FILES.append(("Idiophones/Struck Idiophones/Finger Cymbals/Fing_Cymb.wav",
              "ching.wav", 4.0, {"set": "ching"}))
FILES.append(("Idiophones/Struck Idiophones/Gong 1/gong_p.wav",
              "gong.wav", 6.0, {"set": "gong"}))


def read_wav(path):
    with wave.open(path, "rb") as w:
        nch, width, rate = w.getnchannels(), w.getsampwidth(), w.getframerate()
        raw = w.readframes(w.getnframes())
    n = len(raw) // width
    if width == 2:
        ints = struct.unpack(f"<{n}h", raw)
        scale = 32768.0
    elif width == 3:
        ints = [int.from_bytes(raw[i * 3:i * 3 + 3], "little", signed=True) for i in range(n)]
        scale = 8388608.0
    elif width == 4:
        ints = struct.unpack(f"<{n}i", raw)
        scale = 2147483648.0
    else:
        raise ValueError(f"{path}: unsupported sample width {width}")
    mono = [sum(ints[i:i + nch]) / nch / scale for i in range(0, n, nch)]
    return mono, rate


def trim_normalize(x, rate, max_secs):
    peak = max(abs(v) for v in x) or 1.0
    # onset: first sample above 2% of peak, minus 5ms of pre-attack air
    i0 = next(i for i, v in enumerate(x) if abs(v) > 0.02 * peak)
    i0 = max(0, i0 - int(rate * 0.005))
    x = x[i0:i0 + int(rate * max_secs)]
    # tail: cut where a 50ms window stays under -60dB of peak
    win = int(rate * 0.05)
    end = len(x)
    for i in range(len(x) - win, 0, -win):
        if max(abs(v) for v in x[i:i + win]) > 0.001 * peak:
            end = min(len(x), i + 2 * win)
            break
    x = x[:end]
    fade = min(int(rate * 0.08), len(x))
    for i in range(fade):  # cosine fade-out so the cut is inaudible
        x[len(x) - fade + i] *= 0.5 * (1 + math.cos(math.pi * i / fade))
    g = 0.71 / peak  # -3dBFS
    return [v * g for v in x]


def write_wav(path, x, rate):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack(f"<{len(x)}h",
                                  *(max(-32768, min(32767, round(v * 32767))) for v in x)))


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = []
    for src, name, max_secs, meta in FILES:
        tmp = "/tmp/vcsl_dl.wav"
        url = RAW + urllib.request.quote(src)
        print(f"{name} <- {src}")
        urllib.request.urlretrieve(url, tmp)
        x, rate = read_wav(tmp)
        x = trim_normalize(x, rate, max_secs)
        write_wav(os.path.join(OUT, name), x, rate)
        manifest.append({"file": name, **meta})
    with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as f:
        json.dump({"source": "VCSL (github.com/sgossner/VCSL), CC0", "notes": manifest}, f, indent=1)
    total = sum(os.path.getsize(os.path.join(OUT, f)) for f in os.listdir(OUT))
    print(f"done: {len(FILES)} samples, {total // 1024}KB total")


if __name__ == "__main__":
    main()
