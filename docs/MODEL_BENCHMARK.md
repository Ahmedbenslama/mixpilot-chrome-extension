# Source-separation model benchmark

**Date:** 2026-11-23 · **Machine:** Intel i7-13620H (10C/16T), RTX 4050 Laptop, 16 GB RAM, Windows 11, Chrome 158 · **Runtime:** onnxruntime-web 1.31.1

Reproduce the results with the scripts in `bench/` (see `bench/README.md`). Model weights, audio and outputs are git-ignored.

## Decision

**Selected: DeepFilterNet3 (DFN3) as a stateful single-frame streaming ONNX graph, run on single-threaded WASM.**

- **Speech stem:** DFN3's output.
- **Music stem:** mixture − speech, computed sample by sample. The two stems are therefore always time-aligned and sum exactly to the original.

DFN3 is the only candidate that meets the lip-sync latency budget (≤ ~100 ms added). It also had the best separation scores in this test set, including against the offline Spleeter upper bound.

**Honest framing:** DFN3 is a *speech-enhancement* network. It extracts speech and treats everything else (music, effects, noise, crowd) as "not speech". So MixPilot's "Music" stem is really **"everything except speech"**, and the UI and docs should say so. That's still genuine model-based separation, not EQ: the speech estimate is a neural network's output, and the music stem is exactly what that network removed.

## Candidates

| | DFN3 (streaming) | GTCRN | Spleeter 2-stem (fp16) |
|---|---|---|---|
| Task | Speech vs everything else | Speech vs everything else | Vocals vs accompaniment (music-trained) |
| Source | [Rikorose/DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) checkpoint, exported here with [torchDF](https://github.com/grazder/DeepFilterNet/tree/torchDF-changes/torchDF) streaming wrapper | [Xiaobin-Rong/gtcrn](https://github.com/Xiaobin-Rong/gtcrn) `stream/onnx_models/gtcrn_simple.onnx` | [sherpa-onnx release](https://github.com/k2-fsa/sherpa-onnx/releases/tag/source-separation-models) of [deezer/spleeter](https://github.com/deezer/spleeter) |
| License | MIT OR Apache-2.0 | MIT | MIT |
| Sample rate | 48 kHz (fullband) | 16 kHz | 44.1 kHz |
| ONNX size | 16.1 MB (sha256 `9142a630…07b8b1`) | 0.5 MB | 2 × 19.7 MB |
| Algorithmic latency | **30 ms (measured)** | 32 ms | ~11.9 s window: not usable live |
| Streaming | Yes: 10 ms hop, 45,304-float state vector | Yes: 16 ms hop, caches | No |

Other options were reviewed but not benchmarked:
- **HTDemucs:** music separation, 80–170 MB, offline windows.
- **Bandit / Banquet:** cinematic dialogue/music/effects. These address the right task, but they're non-causal, have no ONNX export, and the checkpoint license is unverified.
- **Causal Conv-TasNet / HS-TasNet:** no public weights under a usable license.

## Separation quality

**Test set:** 28 synthetic mixtures of 12 s each at 48 kHz mono.
- **Speech:** LibriSpeech dummy subset, CC BY 4.0. This is 16 kHz source audio, so the reference speech is band-limited.
- **Music:** 7 CC BY tracks, 5 instrumental and 2 with sung vocals; see `bench/audio/SOURCES.md`.
- **Mixing levels:** speech-to-music ratio (SMR) of +10, +5, 0 and −5 dB.

**Metric:** SI-SDR improvement over the unprocessed mixture (dB, higher is better), shown as speech / music. For every system the music stem is mixture − speech, and reconstruction error is −144 dB (float precision).

| Group | DFN3 official (PyTorch) | **DFN3 streaming ONNX** | GTCRN | Spleeter (offline, upper bound) |
|---|---|---|---|---|
| All | 7.8 / 10.0 | **7.7 / 9.9** | 5.2 / 6.4 | 6.5 / 8.3 |
| SMR +10 dB | 5.5 / 14.1 | 5.4 / 13.9 | 3.5 / 11.0 | 3.4 / 10.8 |
| SMR +5 dB | 7.7 / 12.0 | 7.7 / 12.0 | 5.1 / 8.2 | 6.6 / 10.8 |
| SMR 0 dB | 8.8 / 8.7 | 8.7 / 8.7 | 5.8 / 4.4 | 8.2 / 8.0 |
| SMR −5 dB | 9.2 / 5.2 | 9.1 / 5.2 | 6.2 / 2.2 | 7.6 / 3.7 |
| Instrumental music | 7.2 / 9.4 | 7.2 / 9.3 | 4.5 / 6.0 | 6.6 / 8.5 |
| Music with sung vocals | 9.3 / 11.5 | 9.1 / 11.4 | 6.9 / 7.6 | 6.1 / 7.9 |
| Absolute SI-SDR (all) | 10.3 / 7.5 | 10.2 / 7.4 | 7.7 / 4.0 | 9.0 / 5.8 |

**Streaming export validation:**
- ONNX vs PyTorch on the same frames: max abs diff 1.5e-8.
- The streaming graph scores within 0.1–0.2 dB of the official `df.enhance()` pipeline.
- Measured end-to-end delay: 1,440 samples = 30 ms.

**Observations:**
- **Sung vocals:** DFN3 puts singing in the *Music* stem, which is what MixPilot wants. Spleeter puts singing in "vocals", i.e. the Speech channel.
- **Weakest case:** the music stem at −5 dB SMR (music louder than speech), +5.2 dB improvement. Expect audible speech residue in the music stem when the music is loud.
- **Not tested:** SI-SDR doesn't capture musical-noise artefacts, so listening tests are required. Samples are in `bench/listening/`.

## In-browser speed (Chrome 158, onnxruntime-web 1.31.1)

Single-frame `session.run()` timings over 1,500 frames after 50 warm-up frames, in a cross-origin-isolated page.

| Model / config | Median per hop | p95 | p99 | RTF (median) |
|---|---|---|---|---|
| **DFN3, WASM, 1 thread** | **2.33 ms / 10 ms** | 3.23 ms | 4.47 ms | **0.23** |
| DFN3, WASM, 4 threads | 2.76 ms | 4.03 ms | 5.03 ms | 0.28 (threads hurt) |
| DFN3, WebGPU | — | — | — | **fails**: MatMul kernel rejects rank-1 operand |
| GTCRN, WASM, 1 thread | 0.96 ms / 16 ms | 1.23 ms | 1.49 ms | 0.06 |
| DFN3, WASM 1T, CDP CPU throttle ×3 (*emulated*) | 4.68 ms | 17.1 ms | 20.7 ms | 0.47 |
| DFN3, WASM 1T, CDP CPU throttle ×6 (*emulated*) | 4.34 ms | 14.7 ms | 28.9 ms | 0.43 |

- **Session creation:** 0.35–0.8 s on this machine; 2.3 s at ×6 throttle.
- **Native reference:** onnxruntime (Python, CPU, 1 thread) takes 1.74 ms per frame.
- **Throttled rows:** DevTools throttling is not a faithful model of a low-end CPU. Treat them as indicative only. They show that **tail latency, not the average, is the risk**: p99 spikes exceed the 10 ms hop. The engine therefore needs a jitter buffer and an overload fallback.
- **Runtime build:** only the plain WASM build (`ort-wasm-simd-threaded.wasm`, 15 MB) is needed. The JSEP/WebGPU build (29 MB) would add size for no benefit.

## Engineering consequences

1. **Inference placement:** a dedicated Worker in the offscreen document, fed by an AudioWorklet through SharedArrayBuffer rings. This requires cross-origin isolation of the offscreen document, to be verified in the extension.
2. **Stereo:** run the model once on the mid channel (L+R)/2. The speech stem is mono, centred. The music stem is the stereo mixture minus speech in each channel, which keeps the music's stereo image at 1× compute.
3. **Latency budget:** 30 ms algorithmic latency, plus a jitter buffer (start at ~30 ms, adaptive), plus render quanta. Bypass goes through a DelayNode of equal length so A/B doesn't jump in time.
4. **Overload:** if the output ring underruns repeatedly, crossfade to latency-matched passthrough and show "Separation paused: this device is too slow right now".
5. **Low-tier fallback:** GTCRN (RTF 0.06) is a possible "lite" mode, but it scores lower and is 16 kHz only, so its speech stem would be band-limited. It isn't planned for v1. Revisit if real low-end devices can't run DFN3.
6. **Package size:** model 16 MB + WASM 15 MB ≈ 31 MB. The ONNX graph holds the FFT as 960×962 matrices (~7.4 MB). Moving the STFT into JS could shrink the model and speed it up; this is a possible optimisation.

## In-extension results (Phase B, 2026-11-23, same machine, Chrome 158)

### Real-time pipeline vs offline: ground truth

`bench/web/run-harness.mjs` plays 6 of the benchmark mixtures through the **shipped `MixEngine`** in real time:
- **Path:** AudioWorklet, message transport, worker, onnxruntime-web, DFN3.
- **Method:** records the stems and scores them against the known references.

| Clip | Speech SI-SDRi (live / offline) | Music SI-SDRi (live / offline) |
|---|---|---|
| carefree +5 dB | 7.53 / 7.50 | 11.82 / 11.77 |
| windswept −5 dB | 7.78 / 7.72 | 4.13 / 4.08 |
| infraction_dance 0 dB | 9.87 / 9.83 | 9.72 / 9.65 |
| vocal_lost_in_a_dream +5 dB | 9.79 / 10.02 | 14.41 / 14.64 |
| vocal_i_will_remember 0 dB | 8.81 / 8.75 | 8.74 / 8.65 |
| scheming_weasel +10 dB | 3.52 / 3.50 | 11.34 / 11.35 |
| **Mean** | **7.88 / 7.89** | **10.03 / 10.02** |

The measured stem delay was exactly 3,360 samples (70 ms) on every clip, with 0 underruns.

### Live on YouTube

`tests/e2e/separation.e2e.mjs`, run on *Tears of Steel* (Blender Foundation, CC BY 3.0), with 60 s of sustained playback:

| Metric | Result |
|---|---|
| Model load in the worker (cached) / first load | 250–290 ms / 770 ms |
| Enable → separation running | 0.87–1.8 s (audio keeps playing, latency-matched, while loading) |
| Inference per 10 ms hop | p50 2.2–2.3 ms, p95 2.5–4.2 ms, max 4.5–8.1 ms |
| Underruns / overload events over 60 s | 0 / 0 |
| Minimum headroom (worker lead over the read point) | 28 ms of the 40 ms jitter allowance; i.e. about 12 ms of the buffer actually used |
| Processing delay added by MixPilot | 71.5 ms (30 model + 40 jitter buffer + 1.5 limiter), plus the audio output's own 40 ms that passthrough also has |
| CPU, renderer processes, % of one core | 7.4% with YouTube playing alone → 39.1% with separation; **+32% of one core** (about 2% of this 16-thread CPU) |
| Memory | Offscreen document 1.6 MB JS heap. Worker 3.4 MB JS heap + 13–27 MB ArrayBuffer backing stores. ONNX Runtime's WASM linear memory isn't visible to this CDP probe, so there's no total. |
| Unity mix vs original | within 0.02–0.03 dB |
| A/B original vs latency-matched original | within 0.02–0.13 dB |
| 6 s total inference stall | Switched to "overloaded" and kept playing the original (never silent); recovered automatically 0.4 s after the stall ended |

### Architecture change forced by measurement

The plan was SharedArrayBuffer rings, which require a cross-origin-isolated document. Measured in Chrome 158: **tab capture fails ("Error starting tab capture") in a cross-origin-isolated offscreen document**, under both `COEP: require-corp` and `credentialless`.

The engine therefore uses a direct worklet↔worker MessageChannel instead:
- Audio moves as 10 ms hops in a fixed pool of transferable buffers, so the audio thread doesn't allocate.
- Hops are dropped rather than queued when the worker stalls.

Unit tests and the ground-truth harness show this transport keeps the stems sample-exact.

## Not yet measured

- **Subjective listening quality on real YouTube content.** Needs a human; see `tests/MANUAL_QA.md`.
- **Real low-tier hardware.** Only this i7-13620H laptop has been measured.
- **Sessions longer than a few minutes,** e.g. 30 min or more.
- **ONNX Runtime WASM heap size.**
