"""Shared WAV helpers for the asset build scripts (stdlib only).

Used by build-assets.py (VCSL, committed) and build-lexar.py (local library,
gitignored). One source of truth for reading, trimming and writing samples.
"""
import math
import struct
import wave


def read_wav(path):
    """Any PCM wav -> (mono float list, rate). Handles 16/24/32-bit, downmixes."""
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
    """Onset-trim, cap length, cut the silent tail, fade out, peak-normalize."""
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


def make_loop(x, rate, secs, out_rate=32000, xfade_s=2.0, skip_s=8.0):
    """Ambience processing: pick a stretch, downsample (noise-like beds don't
    need more), and blend the tail into the head so loop=true is seamless."""
    skip = int(rate * skip_s)
    x = x[skip:skip + int(rate * (secs + xfade_s))]
    n = int(len(x) * out_rate / rate)
    y = []
    for i in range(n):  # linear resample
        p = i * rate / out_rate
        k = int(p)
        if k + 1 >= len(x):
            break
        y.append(x[k] * (1 - (p - k)) + x[k + 1] * (p - k))
    xf = int(out_rate * xfade_s)
    body = y[:len(y) - xf]
    for i in range(xf):
        body[i] = body[i] * (i / xf) + y[len(body) + i] * (1 - i / xf)
    peak = max(abs(v) for v in body) or 1.0
    return [v * 0.71 / peak for v in body], out_rate


def write_wav(path, x, rate):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack(f"<{len(x)}h",
                                  *(max(-32768, min(32767, round(v * 32767))) for v in x)))
