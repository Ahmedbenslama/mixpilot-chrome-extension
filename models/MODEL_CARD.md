# dfn3_stream.onnx: model card

| | |
|---|---|
| File | `models/dfn3_stream.onnx` (16,133,762 bytes) |
| SHA-256 | `9142a6302be30df3fd8dee2502fc588cfe6ab25c76c421f115ab02211a07b8b1` |
| Model | DeepFilterNet3: official checkpoint `DeepFilterNet3` (epoch 120) from [Rikorose/DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) |
| Authors | Hendrik Schröter et al., "DeepFilterNet: Perceptually Motivated Real-Time Speech Enhancement" (arXiv 2305.08227) |
| License | **MIT OR Apache-2.0** (upstream `LICENSE-MIT`, `LICENSE-APACHE`). Redistribution permitted with license notice. |
| Export | Produced locally by `bench/export/export_dfn_stream.py`, using the pure-PyTorch streaming wrapper from [grazder/DeepFilterNet `torchDF-changes`](https://github.com/grazder/DeepFilterNet/tree/torchDF-changes) (same license). ONNX opset 14, `always_apply_all_stages=True`. |
| Runtime | onnxruntime-web 1.31.1 (MIT), WASM SIMD, 1 thread, bundled in the extension |

## Interface

One call processes one 10 ms hop at 48 kHz:

| | name | shape |
|---|---|---|
| in | `input_frame` | f32[480] — mono audio |
| in | `states` | f32[45304] — recurrent/feature state from the previous call (zeros at start) |
| in | `atten_lim_db` | f32[] — 0 (no attenuation limit) |
| out | `enhanced_audio_frame` | f32[480] — speech estimate for the input 1,440 samples (30 ms) earlier |
| out | `out_states` | f32[45304] |
| out | `lsnr` | f32[1] — local SNR estimate (unused) |

## Intended use in MixPilot

Speech-vs-everything-else separation of YouTube tab audio, on device:
- **Speech stem:** model output.
- **Music stem:** latency-matched mixture minus speech.

## Limitations

- **What it was trained for:** speech enhancement, not music separation. "Music" therefore contains music, effects, crowd and noise.
- **Singing:** sung vocals are mostly treated as not-speech, so they go to Music. That suits MixPilot, but singing that sounds speech-like may leak into Speech.
- **Weakest case:** music louder than speech. In the benchmark at −5 dB speech-to-music ratio, the music stem improved by only about +5 dB.
- **Mono model:** it runs on the mid channel. Speech panned hard to one side is only partly removed from the music stem.
- **Validation so far:** synthetic mixtures and automated live tests only. Subjective listening tests are still pending (see `tests/MANUAL_QA.md`).

## Validation

See `docs/MODEL_BENCHMARK.md`:
- **Offline:** SI-SDR on 28 mixtures.
- **In Chrome:** the same scores reproduced in real time through the shipped engine (mean difference 0.01 dB).
- **Live on YouTube:** inference timing and stability.
