"""Build synthetic speech+music mixtures with known ground truth.

Output: bench/audio/mix/<id>/{mix,speech,music}.wav  (48 kHz, mono, float32)
        bench/audio/mix/index.json

Speech: LibriSpeech dummy subset (CC BY 4.0), 16 kHz -> resampled to 48 kHz.
Music:  CC BY tracks listed in bench/audio/SOURCES.md, resampled to 48 kHz, downmixed to mono.
SMR = speech-to-music ratio in dB (RMS of speech vs RMS of music over the segment).
"""
import io
import json
import os
from math import gcd

import numpy as np
import pyarrow.parquet as pq
import soundfile as sf
from scipy.signal import resample_poly

SR = 48000
SEG_S = 12.0
SMRS_DB = [10, 5, 0, -5]
HERE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(HERE, "audio", "raw")
OUT = os.path.join(HERE, "audio", "mix")

MUSIC = [
    ("carefree", "carefree.ogg", "instrumental"),
    ("windswept", "windswept.ogg", "instrumental"),
    ("ghost_dance", "ghost_dance.oga", "instrumental"),
    ("scheming_weasel", "scheming_weasel.wav", "instrumental"),
    ("infraction_dance", "infraction_dance.ogg", "instrumental-electronic"),
    ("vocal_lost_in_a_dream", "vocal_lost_in_a_dream.opus", "vocal"),
    ("vocal_i_will_remember", "vocal_i_will_remember.opus", "vocal"),
]


def resample(x: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    if sr_in == sr_out:
        return x
    g = gcd(sr_in, sr_out)
    return resample_poly(x, sr_out // g, sr_in // g).astype(np.float32)


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x.astype(np.float64) ** 2) + 1e-12))


def load_speech_segments(n: int) -> list:
    """Concatenate utterances per speaker into SEG_S-long segments."""
    t = pq.read_table(os.path.join(RAW, "librispeech_dummy.parquet")).to_pylist()
    by_spk: dict = {}
    for row in t:
        audio, sr = sf.read(io.BytesIO(row["audio"]["bytes"]), dtype="float32")
        by_spk.setdefault(row["speaker_id"], []).append(resample(audio, sr, SR))
    need = int(SEG_S * SR)
    segs = []
    for spk, utts in sorted(by_spk.items(), key=lambda kv: -sum(len(u) for u in kv[1])):
        buf = np.concatenate([np.concatenate([u, np.zeros(int(0.25 * SR), np.float32)]) for u in utts])
        start = 0
        while start + need <= len(buf):
            segs.append((spk, buf[start:start + need]))
            start += need
    if len(segs) < n:
        raise RuntimeError(f"only {len(segs)} speech segments available")
    # interleave speakers for variety
    segs.sort(key=lambda s: s[0])
    picked, seen = [], {}
    for spk, seg in segs:
        if seen.get(spk, 0) < 2:
            picked.append((spk, seg))
            seen[spk] = seen.get(spk, 0) + 1
    return picked[:n] if len(picked) >= n else (picked + segs)[:n]


def load_music_excerpt(fname: str, offset_s: float) -> np.ndarray:
    x, sr = sf.read(os.path.join(RAW, fname), dtype="float32", always_2d=True)
    x = x.mean(axis=1)
    x = resample(x, sr, SR)
    start = int(offset_s * SR)
    seg = x[start:start + int(SEG_S * SR)]
    assert len(seg) == int(SEG_S * SR), fname
    return seg


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    n_mix = len(MUSIC) * len(SMRS_DB)
    speech = load_speech_segments(n_mix)
    index = []
    k = 0
    for mid, fname, kind in MUSIC:
        music = load_music_excerpt(fname, offset_s=40.0)
        for smr in SMRS_DB:
            spk, sp = speech[k % len(speech)]
            k += 1
            m = music * (rms(sp) / rms(music)) / (10 ** (smr / 20))
            mix = sp + m
            peak = float(np.max(np.abs(mix)))
            scale = 0.9 / peak if peak > 0.9 else 1.0
            sp, m, mix = sp * scale, m * scale, mix * scale
            cid = f"{mid}__smr{smr:+d}"
            d = os.path.join(OUT, cid)
            os.makedirs(d, exist_ok=True)
            for name, sig in (("mix", mix), ("speech", sp), ("music", m)):
                sf.write(os.path.join(d, f"{name}.wav"), sig.astype(np.float32), SR, subtype="FLOAT")
            index.append({"id": cid, "music": mid, "kind": kind, "smr_db": smr, "speaker": int(spk)})
    with open(os.path.join(OUT, "index.json"), "w") as f:
        json.dump(index, f, indent=1)
    print(f"wrote {len(index)} mixtures to {OUT}")


if __name__ == "__main__":
    main()
