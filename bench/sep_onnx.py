"""Run GTCRN (streaming, frame-by-frame) and Spleeter 2-stem on the mixture set.

Writes bench/out/<system>/<id>/{speech,music}.wav at 48 kHz and timing JSON.
Run with bench/.venv (Python 3.13).
"""
import json
import os
import sys
import time
from math import gcd

import numpy as np
import onnxruntime as ort
import soundfile as sf
from scipy.signal import resample_poly, stft, istft

HERE = os.path.dirname(os.path.abspath(__file__))
MIX = os.path.join(HERE, "audio", "mix")
OUT = os.path.join(HERE, "out")
SR = 48000


def resample(x, a, b):
    if a == b:
        return x.astype(np.float32)
    g = gcd(a, b)
    return resample_poly(x, b // g, a // g).astype(np.float32)


def fit(x, n):
    return x[:n] if len(x) >= n else np.pad(x, (0, n - len(x)))


def session(path, threads=1):
    so = ort.SessionOptions()
    so.intra_op_num_threads = threads
    so.inter_op_num_threads = 1
    return ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])


# ---------------------------------------------------------------- GTCRN
class Gtcrn:
    """16 kHz streaming speech enhancement; one 16 ms hop per model call."""

    name = "gtcrn"

    def __init__(self):
        self.s = session(os.path.join(HERE, "models", "gtcrn", "gtcrn_simple.onnx"))

    def separate(self, mix48):
        x = resample(mix48, SR, 16000)
        win = np.sqrt(np.hanning(513)[:512]).astype(np.float32)  # periodic sqrt-hann
        _, _, X = stft(x, 16000, window=win, nperseg=512, noverlap=256, boundary="zeros", padded=True)
        X = X * win.sum()  # undo scipy scaling to match torch.stft magnitude
        conv = np.zeros([2, 1, 16, 16, 33], np.float32)
        tra = np.zeros([2, 3, 1, 1, 16], np.float32)
        inter = np.zeros([2, 1, 33, 16], np.float32)
        Y = np.zeros_like(X)
        times = []
        for t in range(X.shape[1]):
            frame = np.stack([X[:, t].real, X[:, t].imag], -1).astype(np.float32)[None, :, None, :]
            t0 = time.perf_counter()
            enh, conv, tra, inter = self.s.run(None, {"mix": frame, "conv_cache": conv, "tra_cache": tra, "inter_cache": inter})
            times.append(time.perf_counter() - t0)
            Y[:, t] = enh[0, :, 0, 0] + 1j * enh[0, :, 0, 1]
        _, y = istft(Y / win.sum(), 16000, window=win, nperseg=512, noverlap=256, boundary=True)
        speech = fit(resample(y, 16000, SR), len(mix48))
        hop_s = 256 / 16000
        return speech, {"per_call_ms_median": 1e3 * float(np.median(times)), "hop_ms": 1e3 * hop_s,
                        "rtf": float(np.median(times)) / hop_s, "algorithmic_latency_ms": 32.0}


# ---------------------------------------------------------------- Spleeter
class Spleeter:
    """Offline 2-stem (vocals/accompaniment); 512-frame (~11.9 s) windows. Upper bound, not streamable."""

    name = "spleeter2"
    N_FFT, HOP, SRM = 4096, 1024, 44100

    def __init__(self):
        d = os.path.join(HERE, "models", "sherpa-onnx-spleeter-2stems-fp16")
        self.v = session(os.path.join(d, "vocals.fp16.onnx"), threads=4)
        self.a = session(os.path.join(d, "accompaniment.fp16.onnx"), threads=4)

    def separate(self, mix48):
        x = resample(mix48, SR, self.SRM)
        win = np.hanning(self.N_FFT + 1)[:-1].astype(np.float32)
        _, _, X = stft(x, self.SRM, window=win, nperseg=self.N_FFT, noverlap=self.N_FFT - self.HOP, boundary="zeros", padded=True)
        T = X.shape[1]
        Tp = int(np.ceil(T / 512) * 512)
        mag = np.abs(X[:1024, :]).T  # (T, 1024)
        mag = np.pad(mag, ((0, Tp - T), (0, 0))) * win.sum()
        inp = np.stack([mag, mag]).reshape(2, Tp // 512, 512, 1024).astype(np.float32)
        t0 = time.perf_counter()
        v = self.v.run(None, {"x": inp})[0]
        a = self.a.run(None, {"x": inp})[0]
        dt = time.perf_counter() - t0
        v = v[0].reshape(Tp, 1024)[:T].T
        a = a[0].reshape(Tp, 1024)[:T].T
        den = v ** 2 + a ** 2 + 1e-10
        mv = (v ** 2 + 5e-11) / den
        M = np.zeros(X.shape, np.float32)
        M[:1024] = mv  # bins above ~11 kHz: Spleeter leaves them to accompaniment
        _, y = istft(X * M, self.SRM, window=win, nperseg=self.N_FFT, noverlap=self.N_FFT - self.HOP, boundary=True)
        speech = fit(resample(y, self.SRM, SR), len(mix48))
        dur = len(mix48) / SR
        return speech, {"wall_s": dt, "audio_s": dur, "rtf": dt / dur, "window_frames": 512,
                        "algorithmic_latency_ms": 512 * self.HOP / self.SRM * 1e3}


def main(which):
    idx = json.load(open(os.path.join(MIX, "index.json")))
    sysm = {"gtcrn": Gtcrn, "spleeter2": Spleeter}[which]()
    stats = []
    for item in idx:
        mix, _ = sf.read(os.path.join(MIX, item["id"], "mix.wav"), dtype="float32")
        speech, st = sysm.separate(mix)
        music = mix - speech  # residual keeps stems sample-aligned and sum == mixture
        d = os.path.join(OUT, sysm.name, item["id"])
        os.makedirs(d, exist_ok=True)
        sf.write(os.path.join(d, "speech.wav"), speech, SR, subtype="FLOAT")
        sf.write(os.path.join(d, "music.wav"), music, SR, subtype="FLOAT")
        stats.append({"id": item["id"], **st})
        print(item["id"], {k: round(v, 3) if isinstance(v, float) else v for k, v in st.items()}, flush=True)
    json.dump(stats, open(os.path.join(OUT, sysm.name, "timing.json"), "w"), indent=1)


if __name__ == "__main__":
    main(sys.argv[1])
