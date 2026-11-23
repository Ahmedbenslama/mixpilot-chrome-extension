"""Score separated stems against ground truth with SI-SDR (scale-invariant SDR, dB).

SI-SDRi = SI-SDR(estimate, ref) - SI-SDR(mixture, ref): improvement over doing nothing.
Usage: python score.py sys1 [sys2 ...]   -> prints table, writes out/scores.json
"""
import json
import os
import sys

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
MIX = os.path.join(HERE, "audio", "mix")
OUT = os.path.join(HERE, "out")


def si_sdr(est, ref, eps=1e-9):
    est = est.astype(np.float64) - est.mean()
    ref = ref.astype(np.float64) - ref.mean()
    a = np.dot(est, ref) / (np.dot(ref, ref) + eps)
    t = a * ref
    return 10 * np.log10((np.dot(t, t) + eps) / (np.dot(est - t, est - t) + eps))


def load(p):
    return sf.read(p, dtype="float32")[0]


def main(systems):
    idx = json.load(open(os.path.join(MIX, "index.json")))
    rows = []
    for item in idx:
        d = os.path.join(MIX, item["id"])
        mix, sp, mu = load(f"{d}/mix.wav"), load(f"{d}/speech.wav"), load(f"{d}/music.wav")
        base_s, base_m = si_sdr(mix, sp), si_sdr(mix, mu)
        for s in systems:
            e = os.path.join(OUT, s, item["id"])
            if not os.path.exists(e):
                continue
            es, em = load(f"{e}/speech.wav"), load(f"{e}/music.wav")
            n = min(len(es), len(sp))
            rows.append({**item, "system": s,
                         "speech_sisdr": si_sdr(es[:n], sp[:n]), "music_sisdr": si_sdr(em[:n], mu[:n]),
                         "speech_sisdri": si_sdr(es[:n], sp[:n]) - base_s, "music_sisdri": si_sdr(em[:n], mu[:n]) - base_m,
                         "recon_err_db": 20 * np.log10(np.max(np.abs(es[:n] + em[:n] - mix[:n])) + 1e-12)})
    json.dump(rows, open(os.path.join(OUT, "scores.json"), "w"), indent=1, default=float)

    def agg(f):
        sel = [r for r in rows if f(r)]
        return {s: (np.mean([r["speech_sisdri"] for r in sel if r["system"] == s]),
                    np.mean([r["music_sisdri"] for r in sel if r["system"] == s])) for s in systems
                if any(r["system"] == s for r in sel)}

    groups = [("ALL", lambda r: True)]
    groups += [(f"SMR {v:+d} dB", (lambda v: lambda r: r["smr_db"] == v)(v)) for v in (10, 5, 0, -5)]
    groups += [("instrumental", lambda r: r["kind"] != "vocal"), ("sung vocals", lambda r: r["kind"] == "vocal")]
    print(f"{'group':<14}" + "".join(f"{s:>26}" for s in systems))
    print(f"{'':<14}" + "".join(f"{'speechΔ / musicΔ (dB)':>26}" for _ in systems))
    for name, f in groups:
        a = agg(f)
        print(f"{name:<14}" + "".join(f"{a[s][0]:>12.1f} / {a[s][1]:>9.1f}" if s in a else f"{'-':>26}" for s in systems))


if __name__ == "__main__":
    main(sys.argv[1:])
