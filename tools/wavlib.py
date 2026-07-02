"""Shared WAV helpers for the asset build scripts (stdlib only).

Used by build-assets.py (VCSL, committed) and build-lexar.py (local library,
gitignored). One source of truth for reading, trimming and writing samples.
"""
import math
import struct
import wave


def read_wav(path):
    """Any wav -> (mono float list, rate). Handles 16/24/32-bit int, 32-bit
    float and WAVE_FORMAT_EXTENSIBLE (which the wave module refuses), downmixes."""
    try:
        with wave.open(path, "rb") as w:
            nch, width, rate = w.getnchannels(), w.getsampwidth(), w.getframerate()
            raw = w.readframes(w.getnframes())
    except wave.Error:
        return _read_wav_raw(path)
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


def _read_wav_raw(path):
    """RIFF parser for formats the wave module rejects: float32 (fmt 3) and
    WAVE_FORMAT_EXTENSIBLE (fmt 0xFFFE), as written by field recorders."""
    with open(path, "rb") as f:
        data = f.read()
    assert data[:4] == b"RIFF" and data[8:12] == b"WAVE", f"{path}: not a wav"
    pos, fmt, raw = 12, None, None
    while pos + 8 <= len(data):
        cid = data[pos:pos + 4]
        size = int.from_bytes(data[pos + 4:pos + 8], "little")
        body = data[pos + 8:pos + 8 + size]
        if cid == b"fmt ":
            fmt = body
        elif cid == b"data":
            raw = body
        pos += 8 + size + (size & 1)
    tag = int.from_bytes(fmt[0:2], "little")
    nch = int.from_bytes(fmt[2:4], "little")
    rate = int.from_bytes(fmt[4:8], "little")
    bits = int.from_bytes(fmt[14:16], "little")
    if tag == 0xFFFE:  # extensible: real format tag lives in the GUID
        tag = int.from_bytes(fmt[24:26], "little")
    width = bits // 8
    n = len(raw) // width
    if tag == 3 and bits == 32:
        vals = struct.unpack(f"<{n}f", raw)
    elif tag == 3 and bits == 64:
        vals = [v for v in struct.unpack(f"<{n // 2}d", raw)]
    elif tag == 1:
        if bits == 16:
            vals = [v / 32768.0 for v in struct.unpack(f"<{n}h", raw)]
        elif bits == 24:
            vals = [int.from_bytes(raw[i * 3:i * 3 + 3], "little", signed=True) / 8388608.0
                    for i in range(n)]
        elif bits == 32:
            vals = [v / 2147483648.0 for v in struct.unpack(f"<{n}i", raw)]
        else:
            raise ValueError(f"{path}: unsupported bits {bits}")
    else:
        raise ValueError(f"{path}: unsupported format tag {tag}")
    mono = [sum(vals[i:i + nch]) / nch for i in range(0, len(vals), nch)]
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
    need more), and blend the tail into the head so loop=true is seamless.
    RMS-normalized (not peak): beds at one loudness mix predictably."""
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
    rms = math.sqrt(sum(v * v for v in body) / len(body)) or 1.0
    g = 0.15 / rms
    peak = max(abs(v) for v in body)
    if peak * g > 0.95:  # crest-heavy beds (waves): back off to avoid clipping
        g = 0.95 / peak
    return [v * g for v in body], out_rate


def write_wav(path, x, rate):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(struct.pack(f"<{len(x)}h",
                                  *(max(-32768, min(32767, round(v * 32767))) for v in x)))
