#!/usr/bin/env python3
"""Build web/assets/ranat/ from VCSL (github.com/sgossner/VCSL, CC0).

No free ranat ek recordings exist anywhere (checked 2026-07); the closest real
instruments are VCSL's rosewood xylophone (hard mallets = the ranat ek's bright
ไม้แข็ง voice) and balafon (the mellow voice). The Thai character comes from how
music.js *plays* them: near-7-TET tuning, octave doubling, kro rolls, a ching
timekeeper (VCSL finger cymbals) and a soft gong at section starts.

v3 adds the rest of a mahori-style ensemble, again by role rather than by name:
  khong  marimba            = khong wong (the round skeletal-line gongs)
  zith   dan tranh          = jakhe/khim (plucked zither; the dan tranh is the
                              jakhe's Vietnamese cousin)
  flute  tenor+alto recorder = khlui (bamboo flute; edge-blown, no reed - same
                              family, played breathy and sliding by the engine)
  saw    bowed psaltery     = saw u-ish sustained bow, for the misty regions
  thon/ram darbuka + frame drum = thon-rammana (the goblet+frame drum pair)

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
ZITH = "Chordophones/Zithers/Dan Tranh/Normal/{n}_{v}_1.wav"
KHONG = "Idiophones/Struck Idiophones/Marimba/Marimba_hit_Outrigger_{n}_{v}_01.wav"
TENREC = "Aerophones/Edge-blown Aerophones/Baroque Tenor Recorder/Sustain/TenRecorder_Sus_{n}_rr1_Main.wav"
ALTREC = "Aerophones/Edge-blown Aerophones/Baroque Alto Recorder/Sustain/AltRecorder_Sus_{n}_rr1_Main.wav"
SAW = "Chordophones/Zithers/Psaltery, Bowed and Plucked/LongBow/BowedPsaltery_{n}_Main_LongBow_{rr}.wav"
DARB = "Membranophones/Struck Membranophones/Darbuka/Darbuka_{k}_hit_{v}_rr1.wav"
FRAME = "Membranophones/Struck Membranophones/Frame Drum/HDrumS_{k}_rr1_Sum.wav"

FREQ = {"C#3": 138.59, "F3": 174.61, "G3": 196.00, "C4": 261.63, "F4": 349.23,
        "G4": 392.00, "C5": 523.25, "F5": 698.46, "G5": 783.99, "C6": 1046.50,
        "G6": 1567.98,
        "C3": 130.81, "E3": 164.81, "G#3": 207.65, "E4": 329.63, "G#4": 415.30,
        "A#3": 233.08, "D4": 293.66, "F#4": 369.99, "E5": 659.26,
        "F#3": 185.00, "B3": 246.94, "D#4": 311.13, "B4": 493.88,
        "G2": 98.00, "B2": 123.47}

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
# jakhe/khim role: dan tranh plucks, two velocity layers
for n in ["C#3", "F#3", "B3", "D#4", "F#4", "B4"]:
    for v in ["mf", "ff"]:
        FILES.append((ZITH.format(n=n, v=v), f"z_{v}_{n.replace('#','s')}.wav", 2.5,
                      {"set": "zith", "layer": "pp" if v == "mf" else "ff", "freq": FREQ[n]}))
# khong wong role: marimba, round and warm, carries the skeletal line
for n in ["G2", "F3", "C4", "G4"]:
    for v in ["soft", "loud"]:
        FILES.append((KHONG.format(n=n, v=v), f"k_{v}_{n}.wav", 2.8,
                      {"set": "khong", "layer": "pp" if v == "soft" else "ff", "freq": FREQ[n]}))
# khlui role: recorder sustains (tenor low, alto high), single layer
for n in ["C3", "E3", "G#3"]:
    FILES.append((TENREC.format(n=n), f"f_{n.replace('#','s')}.wav", 3.8,
                  {"set": "flute", "layer": "solo", "freq": FREQ[n]}))
for n in ["C4", "E4", "G#4", "C5"]:
    FILES.append((ALTREC.format(n=n), f"f_{n.replace('#','s')}.wav", 3.8,
                  {"set": "flute", "layer": "solo", "freq": FREQ[n]}))
# saw u-ish role: bowed psaltery long bows, single layer
for n, rr in [("A#3", "rr2"), ("C4", "rr1"), ("E4", "rr2"), ("G#4", "rr1"),
              ("C5", "rr1"), ("E5", "rr2")]:
    FILES.append((SAW.format(n=n, rr=rr), f"s_{n.replace('#','s')}.wav", 4.5,
                  {"set": "saw", "layer": "solo", "freq": FREQ[n]}))
# thon-rammana: darbuka (goblet) strokes + small frame drum, unpitched variants
for k, v, var in [("1", "vl1", "thom"), ("1", "vl2", "thom"),
                  ("4", "vl1", "tek"), ("4", "vl2", "tek")]:
    FILES.append((DARB.format(k=k, v=v), f"d_{var}_{v}.wav", 1.2,
                  {"set": "thon", "var": var}))
for k, var in [("Hit_v2", "ting"), ("Hit_v3", "ting2"), ("HitMuted_v2", "mute")]:
    FILES.append((FRAME.format(k=k), f"r_{var}.wav", 1.2,
                  {"set": "ram", "var": var}))
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
