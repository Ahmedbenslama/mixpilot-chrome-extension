"""Export DeepFilterNet3 as a single stateful streaming ONNX graph and validate it.

One call = one 480-sample hop (10 ms @ 48 kHz):
    inputs : input_frame f32[480], states f32[N], atten_lim_db f32[]
    outputs: enhanced_audio_frame f32[480], out_states f32[N], lsnr f32[1]

Validation:
  1. ORT output == PyTorch streaming output on random frames.
  2. Streaming output vs official df.enhance() on a real mixture: measured delay and match SNR.
  3. Per-frame CPU time in onnxruntime (1 thread).
  4. Re-separate the full mixture set through the ONNX graph -> bench/out/dfn3_stream/.

Uses torch_df_streaming.py from grazder/DeepFilterNet (torchDF branch, MIT OR Apache-2.0, same as upstream).
Run with bench/.venv-dfn.
"""
import hashlib
import json
import os
import sys
import time

import numpy as np
import onnx
import onnxruntime as ort
import soundfile as sf
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, "df_patched"))  # fork deepfilternet3/modules: hidden-state passthrough only
from torch_df_streaming import TorchDFPipeline  # noqa: E402
from df.enhance import enhance, init_df  # noqa: E402

HOP = 480
OUT_ONNX = os.path.join(BENCH, "models", "dfn3_stream", "dfn3_stream.onnx")
IN_NAMES = ["input_frame", "states", "atten_lim_db"]
OUT_NAMES = ["enhanced_audio_frame", "out_states", "lsnr"]


def run_stream(sess, audio, n_states):
    """Feed audio hop-by-hop exactly as the browser will. Returns raw (undelayed-trim) output."""
    pad = (HOP - len(audio) % HOP) % HOP
    x = np.pad(audio, (0, pad + 4 * HOP)).astype(np.float32)
    st = np.zeros(n_states, np.float32)
    lim = np.array(0.0, np.float32)
    out = np.empty_like(x)
    times = []
    for i in range(0, len(x), HOP):
        t0 = time.perf_counter()
        y, st, _ = sess.run(OUT_NAMES, {"input_frame": x[i:i + HOP], "states": st, "atten_lim_db": lim})
        times.append(time.perf_counter() - t0)
        out[i:i + HOP] = y
    return out, np.array(times)


def best_delay(ref, est, max_lag=6 * HOP):
    n = min(len(ref), len(est)) - max_lag
    scores = [np.dot(ref[:n], est[lag:lag + n]) for lag in range(max_lag)]
    return int(np.argmax(scores))


def main():
    torch.set_num_threads(1)
    os.makedirs(os.path.dirname(OUT_ONNX), exist_ok=True)
    pipe = TorchDFPipeline(always_apply_all_stages=True, device="cpu")
    m = pipe.torch_streaming_model.eval()
    n_states = int(pipe.states.numel())
    feats = (torch.rand(HOP), torch.zeros(n_states), torch.tensor(0.0))
    with torch.no_grad():
        m(*feats)
        torch.onnx.export(torch.jit.script(m), feats, OUT_ONNX, input_names=IN_NAMES,
                          output_names=OUT_NAMES, opset_version=14)
    onnx.checker.check_model(onnx.load(OUT_ONNX))
    size = os.path.getsize(OUT_ONNX)
    sha = hashlib.sha256(open(OUT_ONNX, "rb").read()).hexdigest()
    print(f"exported {OUT_ONNX} ({size/1e6:.2f} MB) states={n_states} sha256={sha}")

    so = ort.SessionOptions()
    so.intra_op_num_threads = 1
    so.inter_op_num_threads = 1
    sess = ort.InferenceSession(OUT_ONNX, so, providers=["CPUExecutionProvider"])

    # 1. ORT vs torch on random frames
    st_t = torch.zeros(n_states)
    st_o = np.zeros(n_states, np.float32)
    worst = 0.0
    with torch.no_grad():
        for _ in range(50):
            f = torch.randn(HOP) * 0.1
            yt, st_t, _ = m(f, st_t, torch.tensor(0.0))
            yo, st_o, _ = sess.run(OUT_NAMES, {"input_frame": f.numpy(), "states": st_o, "atten_lim_db": np.array(0.0, np.float32)})
            worst = max(worst, float(np.max(np.abs(yt.numpy() - yo))))
    print(f"[1] max |torch - ort| over 50 frames: {worst:.2e}")

    # 2. compare against official enhance() on a real mixture
    model, df_state, _ = init_df(model_base_dir="DeepFilterNet3", log_level="ERROR")
    idx = json.load(open(os.path.join(BENCH, "audio", "mix", "index.json")))
    mix, sr = sf.read(os.path.join(BENCH, "audio", "mix", idx[2]["id"], "mix.wav"), dtype="float32")
    ref = enhance(model, df_state, torch.from_numpy(mix)[None]).squeeze(0).numpy()
    raw, times = run_stream(sess, mix, n_states)
    d_ref = best_delay(ref, raw)
    d_in = best_delay(mix, raw)
    aligned = raw[d_ref:d_ref + len(ref)]
    snr = 10 * np.log10(np.sum(ref ** 2) / (np.sum((ref - aligned) ** 2) + 1e-12))
    print(f"[2] stream delay vs enhance(): {d_ref} samples ({d_ref/48:.1f} ms); vs input: {d_in} samples ({d_in/48:.1f} ms); "
          f"match SNR vs enhance(): {snr:.1f} dB")

    # 3. timing
    print(f"[3] ORT CPU 1-thread per 10 ms frame: median {1e3*np.median(times):.2f} ms, p95 {1e3*np.percentile(times,95):.2f} ms, "
          f"RTF {np.median(times)/0.01:.3f}")

    # 4. full set via ONNX streaming graph
    for item in idx:
        mix, sr = sf.read(os.path.join(BENCH, "audio", "mix", item["id"], "mix.wav"), dtype="float32")
        raw, _ = run_stream(sess, mix, n_states)
        speech = raw[d_in:d_in + len(mix)]
        music = mix - speech
        dd = os.path.join(BENCH, "out", "dfn3_stream", item["id"])
        os.makedirs(dd, exist_ok=True)
        sf.write(os.path.join(dd, "speech.wav"), speech, sr, subtype="FLOAT")
        sf.write(os.path.join(dd, "music.wav"), music, sr, subtype="FLOAT")
    json.dump({"onnx": os.path.relpath(OUT_ONNX, BENCH), "bytes": size, "sha256": sha, "n_states": n_states,
               "delay_samples": d_in, "ort_cpu_frame_ms_median": 1e3 * float(np.median(times)),
               "torch_vs_ort_max_abs": worst, "match_snr_vs_enhance_db": float(snr)},
              open(os.path.join(BENCH, "models", "dfn3_stream", "export_report.json"), "w"), indent=1)
    print("[4] wrote bench/out/dfn3_stream")


if __name__ == "__main__":
    main()
