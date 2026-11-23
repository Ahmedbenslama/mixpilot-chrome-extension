"""Run the official DeepFilterNet3 pipeline (libDF features + PyTorch model) on the mixture set.

DFN3 is causal apart from a 2-frame (20 ms) lookahead, so whole-file processing here is
equivalent to streaming in output quality. Run with bench/.venv-dfn (Python 3.11).
"""
import json
import os
import time

import numpy as np
import soundfile as sf
import torch
from df.enhance import enhance, init_df

HERE = os.path.dirname(os.path.abspath(__file__))
MIX = os.path.join(HERE, "audio", "mix")
OUT = os.path.join(HERE, "out")


def main():
    torch.set_num_threads(1)
    model, df_state, _ = init_df(model_base_dir="DeepFilterNet3", log_level="ERROR")
    sr = df_state.sr()
    assert sr == 48000
    idx = json.load(open(os.path.join(MIX, "index.json")))
    stats = []
    for item in idx:
        mix, _ = sf.read(os.path.join(MIX, item["id"], "mix.wav"), dtype="float32")
        t0 = time.perf_counter()
        speech = enhance(model, df_state, torch.from_numpy(mix)[None]).squeeze(0).numpy()
        dt = time.perf_counter() - t0
        speech = speech[: len(mix)]
        music = mix - speech
        d = os.path.join(OUT, "dfn3", item["id"])
        os.makedirs(d, exist_ok=True)
        sf.write(os.path.join(d, "speech.wav"), speech, sr, subtype="FLOAT")
        sf.write(os.path.join(d, "music.wav"), music, sr, subtype="FLOAT")
        st = {"id": item["id"], "wall_s": dt, "audio_s": len(mix) / sr, "rtf_torch_1thread": dt / (len(mix) / sr)}
        stats.append(st)
        print(item["id"], round(st["rtf_torch_1thread"], 3), flush=True)
    json.dump(stats, open(os.path.join(OUT, "dfn3", "timing.json"), "w"), indent=1)


if __name__ == "__main__":
    main()
