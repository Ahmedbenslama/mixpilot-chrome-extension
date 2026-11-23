# MixPilot — Audit & Development Plan

**Date:** 2026-11-23 · **Status:** Phase A (audit) complete; model benchmarking not yet run.

## 1. Repository audit

### What exists (v0.1.0 starter)

| File | Role | Assessment |
|---|---|---|
| `manifest.json` | MV3, permissions `activeTab tabCapture offscreen storage` | Narrow and appropriate. No host permissions, no mic. |
| `background.js` | Service worker: start/stop capture, master gain, tab lifecycle | Works in principle; several lifecycle bugs (below). |
| `offscreen.js` | `getUserMedia(tab)` → Gain → DynamicsCompressor → destination | Correct passthrough approach. |
| `popup.*` | Enable button, master slider, "model required" placeholder card | Honest, but not the target mixer UI. |
| `tests/MANUAL_QA.md` | Manual checklist | No automated tests, no build, no package.json. |

There is no source separation, recognition, TypeScript, build step, or automated test. The folder is **not a git repository**. The `gh` CLI is not installed.

### Baseline bugs found (to fix in Phase A)

1. **Stale "active" state after extension reload or browser restart.** State lives in `chrome.storage.local`, which survives reloads, but the offscreen document and capture don't. The popup then shows "Active" with nothing running, and the next Enable click returns "already active" without capturing. Fix: keep session state in `chrome.storage.session` and reconcile it against whether the offscreen document exists.
2. **No `track.onended` handling.** If Chrome ends the capture (tab crash, discard), the service worker is never told and the state stays "active".
3. **Offscreen document is never closed** on stop, so an idle document stays alive.
4. **Concurrent start/stop races.** Nothing serializes the operations, so a double-click or a popup reopened during startup can interleave them.
5. **Failure after `getMediaStreamId` but before the graph is ready** can leave a stream ID unconsumed. The offscreen side cleans up, but the service worker doesn't report whether audio was restored.
6. **The "limiter" is a compressor** (−2 dBFS threshold, ratio 20, 3 ms attack). It's acceptable as basic peak protection, but it isn't a brickwall limiter and lets fast transients overshoot. This gets replaced by a lookahead limiter in the worklet.
7. **Popup error colour is set inline**, and the slider track gradient is computed in JS. Both are cosmetic and will be replaced in the new UI anyway.

## 2. The constraint that drives the architecture: lip sync

The extension cannot delay the YouTube video. Any processing latency on the audio path becomes an audio/video offset. Broadcast guidance (ITU-R BT.1359) puts the point where audio lagging video becomes detectable at about **125 ms**, and acceptable up to about **185 ms**. Output-device latency already uses part of that, so the processing budget is about **100 ms**. That means:

- Separation models that need seconds of context, such as offline Demucs or Spleeter on 10 s windows, **cannot be used in live mode however good they sound**, because their latency equals their lookahead.
- The model has to be **streaming or causal**, or work on sliding windows of at most about 100 ms of lookahead.
- Bypass and A/B must route through a matching delay so that switching doesn't jump in time.

This shifts the evaluation away from "best separation quality" toward "best quality within about 100 ms of algorithmic latency at an RTF below 0.5 in-browser."

## 3. Model candidates (preliminary; benchmarks pending)

| | A. DeepFilterNet3 (speech-enhancement mask) | B. Spleeter 2-stem / HTDemucs (music separation) | C. Bandit / Banquet (cinematic dialogue/music/effects) |
|---|---|---|---|
| Separates | Clean speech vs everything else. Music = mixture − speech (sample-aligned residual) | Vocals vs accompaniment, trained on songs | Dialogue vs music vs effects: the correct task |
| Arbitrary YouTube audio | Speech-in-noise yes; speech-over-music untested. Singing may be treated as speech or as noise | Trained on music, so speech lands in "vocals". Singing also lands in "speech" | Designed for it |
| Format / size | Official ONNX, 3 graphs, ~2M params (a few MB) | Spleeter ONNX via sherpa-onnx (tens of MB); HTDemucs ONNX ~80–170 MB | PyTorch; no ONNX export found; tens of millions of params |
| License | MIT / Apache-2.0 (upstream), to be verified | Spleeter MIT; Demucs MIT | Code Apache-2.0 per related work; **checkpoint license unverified** |
| Streaming | Yes, built for real time (~40 ms algorithmic latency, 48 kHz) | No. Fixed windows (Spleeter ~11.9 s; HTDemucs ~7.8 s) | No (bidirectional band-split RNN) |
| Browser feasibility | High (WASM; a Rust/WASM build already exists) | Offline only; HTDemucs runs on WebGPU for file splitting, not live | Low (export effort, size, compute) |
| Lip-sync compatible | **Yes** | Only with a short-window causal hack at large quality loss | No |

**Hypothesis to test:** Candidate A is the only one likely to meet the latency budget. Its risk is quality: it was trained to remove *noise*, and music under speech may be partly kept or cause musical-noise artefacts, which would then show up in the music residual. Phase A benchmarks will measure this directly. I'll also look at two more streaming-capable options during benchmarking: GTCRN (ultra-light, but 16 kHz only) and causal Conv-TasNet / HS-TasNet-style models, if any have public weights under a usable license.

**If no candidate separates well enough,** the honest outcome is to ship separation as "experimental" or "unavailable" with passthrough, rather than a fake. I'll report that plainly if it happens.

### Benchmark method (Phase A, before choosing)

- **Objective quality:** synthetic mixtures with known ground truth. Speech from LibriSpeech (CC BY 4.0) mixed with openly licensed music at −5, 0 and +5 dB speech-to-music ratios. Metrics: SI-SDR improvement on both stems, plus the reconstruction check speech + music = mixture.
- **Speed:** real-time factor and per-block latency in **onnxruntime-web 1.31.1 (MIT)** inside real Chrome 158, on WASM-SIMD (single- and multi-threaded) and on WebGPU, plus memory. Measured on this machine (i7-13620H, RTX 4050 Laptop, 16 GB). Low-tier performance gets estimated by limiting threads, and the estimate will be labelled as such.
- **Listening:** I can't listen to audio. I'll export separated stems as WAV files for you to judge, and you'll need to run the listening checklist on real YouTube content. No audio feature will be marked complete without it.

## 4. Target architecture

```
popup (TS UI) ──msg──> service worker (routing, tab validation, session state)
                              │ creates / messages
                              v
offscreen document: getUserMedia(tab) → AudioContext
   MediaStreamSource → AudioWorklet "capture"  ──SAB ring──>  Inference Worker (ORT-web, WASM/WebGPU)
                       AudioWorklet "stems"    <──SAB ring──  (speech, music) blocks
                         ├─ out0 speech → GainNode ─┐
                         └─ out1 music  → GainNode ─┼─> Master Gain → lookahead limiter → destination
   Bypass: source → DelayNode(model latency) ───────┘ (crossfaded A/B, level-matched)
```

- **Bounded buffers:** fixed-size SharedArrayBuffer rings. If inference falls behind by more than N blocks, the engine switches to latency-matched passthrough and shows "Separation paused — device too slow" rather than letting latency grow.
- **Cross-origin isolation:** set `cross_origin_embedder_policy` / `cross_origin_opener_policy` in the manifest so the offscreen document gets SharedArrayBuffer and WASM threads. To be verified in Phase A.
- **All ORT JS/WASM is bundled locally** (`ort.env.wasm.wasmPaths` set to an extension URL). Only the needed `.wasm` variants get copied into the package.
- **Tooling:** TypeScript + esbuild (one small dev dependency) and Vitest for unit tests. Plain TS UI, no React, to keep the popup light. This needs `package.json` and a `dist/` build that becomes the loadable extension.

## 5. Phases

| Phase | Deliverable | Exit criterion |
|---|---|---|
| **A. Baseline + benchmark** | Fix bugs 1–5; TS/esbuild/Vitest scaffold; benchmark harness; run candidates A/B (+ C if weights are usable) | Extension loads; benchmark table with measured numbers; model chosen with evidence |
| **B. Audio engine** | Worklets, SAB rings, inference worker, stem outputs, gains, limiter, latency-matched bypass, overload fallback | Unit tests for rings, overlap-add and gain math; reconstruction test; measured end-to-end latency |
| **C. Mixer UI** | Two equal stem channels (slider, value, mute/restore, meter), master, presets, A/B, reset, all status states, keyboard/ARIA | Real gains wired; UI screenshots; listening test by you |
| **D. Recognition** | Provider adapter; compare AudD vs ACRCloud; consent sheet; music-stem excerpt; history with timestamps and seek | Real setup state without keys; never a fixture shown as a result |
| **E. Polish** | Profiles (video > channel > global), SPA navigation, long-session test, permission/CSP/license audit, privacy policy draft, README | Release-readiness checklist |

## 6. Decisions needed from you

1. **Downloads for benchmarking:** model weights (DeepFilterNet3 ONNX, Spleeter 2-stem ONNX; tens of MB total), `npm install` of onnxruntime-web, esbuild and vitest, and a small set of openly licensed speech and music clips. All go into git-ignored folders.
2. **Local git:** run `git init` and make local commits per phase (no remote, no push), so every change is reviewable and reversible.
3. **Recognition provider keys** won't be needed until Phase D.

## Sources

- [Real-time Low-latency MSS using Hybrid Spectrogram-TasNet (arXiv 2402.17701)](https://arxiv.org/pdf/2402.17701)
- [Towards Practical Real-Time Low-Latency MSS (arXiv 2511.13146)](https://arxiv.org/abs/2511.13146v1)
- [Bandit: Generalized Bandsplit Network for Cinematic Audio Source Separation (arXiv 2309.02539)](https://pdf.arxiv.org/pdf/2309.02539)
- [Banquet / dialogue-music-effects-singing follow-up (arXiv 2408.03588)](https://arxiv.org/abs/2408.03588v1)
- [DeepFilterNet3 paper (arXiv 2305.08227)](https://arxiv.org/pdf/2305.08227.pdf)
- [DeepFilterNet3 ONNX mirror noting MIT/Apache-2.0 upstream](https://huggingface.co/aufklarer/DeepFilterNet3-ONNX/blob/main/README.md)
- [deepfilternet3-noise-filter (Rust/WASM browser build)](https://cdn.jsdelivr.net/npm/deepfilternet3-noise-filter@1.3.0/README.md)
- [Browser noise suppression in an AudioWorklet (WASM latency warning)](https://workadventu.re/tech/building-an-easy-to-use-browser-noise-suppression-library-in-an-audio-worklet/)
- [HTDemucs in ONNX Runtime Web (browser, offline)](https://huggingface.co/monteslu/htdemucs-web-onnx)
- [ONNX Runtime Web — get started](https://onnxruntime.ai/docs/get-started/with-javascript/web.html)
- [Chromium Extensions thread: ORT-web in an offscreen document](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/-4CNcu5bUGA)
