# MixPilot — Session Handoff

**Written:** 2026-11-23, at the end of the session that completed **Phase A** and **Phase B**.
**Audience:** the next coding agent.
**Read first:** `CLAUDE.md`, `CLAUDE_PROMPT.md` (the main spec), then this file, `docs/DEVELOPMENT_PLAN.md` and `docs/MODEL_BENCHMARK.md`.

---

## 1. What the user asked for, and how they want you to work

MixPilot is a Chrome MV3 extension for YouTube: two independent stems (**Speech** and **Music**), each with its own gain, plus "Identify music" on the isolated music stem and timestamped track history. `CLAUDE_PROMPT.md` has the full product brief and phases A–E.

**User preferences (stated explicitly):**
- **Implement for real**, don't just propose code. Phases run in order: A audit, B audio engine, C mixer UI, D recognition, E polish.
- **Genuine AI separation.** Never fake stems with EQ, and never show fixture results as real.
- **Research and benchmark** before choosing models or providers.
- **Premium, restrained dark UI** (charcoal background, one mint/teal accent).
- **Test what you build.** Don't call a feature complete unless it's implemented *and* tested. Audio features also need human listening tests.
- **Stay inside the project folder.**
- **No pushing, publishing or destructive operations without explicit permission.** The user approved creating a GitHub repo and pushing in the message that produced this file. That approval doesn't carry over to future pushes.
- **Progress updates at major milestones:** architectural decisions, technical limitations, test results.
- **Commits:** local, one per phase, authored by the user only. **Do not add `Co-Authored-By` or any AI attribution lines** to commits or PRs (explicit user instruction).

## 2. Current state: v0.3.0

| Phase | Status |
|---|---|
| A — audit, baseline fixes, model research/benchmark | ✅ Done (commits `c11b107`, `d3685b3`) |
| B — live separation engine | ✅ Done and verified by automated + objective tests (commit `41d2529`). **Human listening test still pending**, so separation is not "complete". |
| C — designed mixer UI | ⏭️ **Next.** The current popup is a functional interim UI. |
| D — music recognition (provider adapter, consent, history) | Not started |
| E — profiles, timeline, store readiness, audits | Not started |

**Works today:**
1. Enable on a YouTube tab.
2. DeepFilterNet3 separates speech from everything else, on-device, in real time.
3. Speech, Music and Master sliders (0–200%) act independently.
4. A/B "Hear original" is latency- and level-matched.
5. The original audio plays while the model loads, if inference falls behind, or if separation is unavailable.
6. Capture stops when the tab closes, the tab leaves YouTube, or the extension reloads.

## 3. Key architecture

```
popup (TS) ──msg──> service worker (routing, tab validation, session state; no audio)
                        │ creates/closes
                        v
offscreen document: tabCapture getUserMedia → AudioContext(48 kHz) → MixEngine (src/engine/engine.ts)
  source ─┬─> AudioWorklet "mixpilot-separation" (src/audio/separation.worklet.ts → StemMixer)
          │     mid (L+R)/2 hops ──MessageChannel──> Worker (src/engine/separation.worker.ts): onnxruntime-web WASM + DFN3
          │     speech hops @ same index <──────────
          │     out0 speech×w → speechGain ─┐
          │     out1 music×w  → musicGain  ─┼→ processed ─┐
          │     out3 original×(1−w) ────────┘             ├→ master → lookahead limiter worklet → destination
          │     out2 original (latency-matched) → original┘  (A/B crossfade between processed/original)
          └─> direct (zero latency, used only when separation is unavailable/errored)
```

- **Model:** `models/dfn3_stream.onnx` (16 MB, sha256 `9142a630…07b8b1`, MIT OR Apache-2.0). It's a stateful single-frame streaming export of the official DeepFilterNet3 checkpoint.
  - One call = one 480-sample hop (10 ms at 48 kHz). State vector: 45,304 floats.
  - Output is delayed **1,440 samples (30 ms)** relative to the input.
  - Details in `models/MODEL_CARD.md`. Reproduce it with `bench/export/export_dfn_stream.py`.
- **Stems:**
  - Speech = model output.
  - Music = latency-matched original − speech, so the stems are sample-aligned and **sum exactly to the original**.
  - "Music" really means **everything except speech** (effects, noise, crowd). The UI must say so.
- **Latency:** D = 1,440 (model) + jitter allowance. Presets in `src/engine/protocol.ts`: low 960, **balanced 1920 (default)**, safe 3840. Balanced adds about 71.5 ms total, including the 1.5 ms limiter lookahead.
- **Transport:** the worklet and worker exchange 10 ms hops over a **direct MessageChannel**, using a fixed pool of 16 transferable buffers.
  - The audio thread doesn't allocate in steady state.
  - If every buffer is in flight, the worklet drops the hop instead of allocating.
  - The worker drops hops the worklet has already read past, and caps its backlog at 120 ms.
- **Fallback weight `w`:** ramps to 0 while the model loads, when a needed speech sample hasn't arrived, and during a 3 s overload hold. The fallback output then plays the original. Pure logic lives in `src/audio/stem-mixer.ts`.
- **Limiter:** `src/audio/limiter.ts`, stereo-linked lookahead, −1 dBFS ceiling. It's bit-exact below the ceiling, with no make-up gain.

## 4. Hard-won facts. Don't relearn these.

1. **Chrome refuses tab capture in a cross-origin-isolated document.**
   - Measured in Chrome 158, under both `COEP: require-corp` and `credentialless`: "Error starting tab capture".
   - So: **no COOP/COEP in the manifest and no SharedArrayBuffer.** That's why the transport uses messages.
2. **The MV3 default CSP blocked WASM compilation in the worker.**
   - The manifest sets `"content_security_policy": {"extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"}`.
   - This is required, and it doesn't allow remote code.
3. **WebGPU fails on the DFN3 graph:** the MatMul kernel rejects a rank-1 operand. **Multi-threaded WASM is slower than 1 thread** for this graph. Use 1-thread WASM only, and bundle only `ort-wasm-simd-threaded.wasm` (15 MB), not the 29 MB JSEP build.
4. **The official DeepFilterNet3 ONNX (3 graphs) has no recurrent-state inputs**, so it can't stream. The torchDF streaming wrapper solves this; the fork changes only pass GRU hidden state through.
5. **Bugs found in the starter, now fixed:**
   - The DynamicsCompressorNode "limiter" added **+1.35 dB make-up gain** at 100%.
   - With only `activeTab`, `changeInfo.url` is withheld after leaving YouTube, so the "stop on leave" check never fired. Fixed with host permission `https://*.youtube.com/*`.
   - Session state in `storage.local` survived extension reloads, leaving a stale "Active". Now `storage.session` is reconciled against whether the offscreen document exists.
6. **Testing Chrome extensions:**
   - Branded Chrome 158 **ignores `--load-extension`**.
   - Use CDP `Extensions.loadUnpacked`, which needs the launch flag `--enable-unsafe-extension-debugging`.
   - `Extensions.triggerAction` simulates a toolbar click and grants `activeTab`. It needs a **tab-type** target id: `Target.getTargets({filter:[{type:"tab"}]})`.
   - Dedicated workers need `Target.setAutoAttach` on their parent document.
   - CDP can't CPU-throttle workers. To stall one, evaluate a busy loop inside it.
   - The MV3 service worker goes idle and stops; open an extension page to wake it.
   - The action popup closes when focus moves.
   - `tests/e2e/harness.mjs` holds the shared helpers. It refuses to start if its debug port is already in use, to guard against reusing a stale Chrome.
7. **Level checks must compare output against the latency-matched original** (`levels.referenceDb`), not the live input, because the 70 ms delay skews the comparison.
8. **Windows shell gotchas:**
   - Long bash heredocs containing quotes sometimes fail to parse. Write a script file and run it instead.
   - `"\\dist"` collapses inside heredocs. Use `path.join` or `DIST` from the harness.
   - Wikimedia rejects downloads unless the User-Agent follows its policy format, e.g. `Name/0.1 (https://example.invalid; …)`.
9. **Python:** DeepFilterLib has no cp313 Windows wheel. The export venv uses **Python 3.11** with torch 2.0.1 / torchaudio 2.0.2 CPU. DFN 0.5.6 breaks on newer torchaudio.

## 5. Measured results (i7-13620H, RTX 4050, 16 GB, Windows 11, Chrome 158)

**Offline (28 synthetic mixtures, SI-SDR improvement):**
- **DFN3 streaming:** 7.7 dB speech / 9.9 dB music.
- **Alternatives:** GTCRN 5.2 / 6.4. Spleeter (offline, ~12 s latency) 6.5 / 8.3.

**Live engine vs offline (6 clips, `npm run bench:harness`):**
- **Quality:** speech 7.88 vs 7.89 dB, music 10.03 vs 10.02 dB.
- **Alignment:** delay exactly 3,360 samples on every clip.
- **Stability:** 0 underruns.

**Live on YouTube** (*Tears of Steel*, CC BY):
- **Startup:** model load 250–770 ms; running about 0.9–1.8 s after Enable.
- **Inference:** p50 about 2.3 ms per 10 ms hop, p95 2.5–4.2 ms.
- **Stability:** 0 underruns over 60 s.
- **CPU:** +32% of one core.
- **Level matching:** unity within 0.03 dB of the original; A/B within 0.13 dB.
- **Stall recovery:** a 6 s inference stall falls back to the original and recovers in 0.4 s.
- **Memory:** worker 3.4 MB JS heap + 13–27 MB ArrayBuffers. The ORT WASM heap isn't measured.

**Not measured:**
- Human listening quality.
- Low-tier hardware.
- Sessions of 30 minutes or more.
- Total WASM memory.

## 6. How to run things

```powershell
npm install
npm run check                 # tsc + 45 vitest unit tests + build to dist/
npm run test:e2e              # lifecycle E2E (14 checks), throwaway Chrome profile, needs youtube.com
npm run test:e2e:separation   # live separation E2E (11 checks): timing, stability, CPU, levels, overload recovery
npm run bench:harness         # live-vs-offline SI-SDR; needs bench data (bench/README.md)
```

Load in Chrome: `chrome://extensions` → Developer mode → Load unpacked → **`dist/`**.

`bench/` is dev-only and its large artefacts are git-ignored: two venvs, `bench/models`, `bench/audio/{raw,mix}`, `bench/out`, `bench/listening`. Rebuild them with `bench/README.md`. Audio sources and licenses are in `bench/audio/SOURCES.md`.

## 7. File map

| Path | Purpose |
|---|---|
| `src/background/service-worker.ts` | Message routing, tab validation, serialized start/stop, session/preferences storage, stop on tab close or leaving YouTube |
| `src/offscreen/offscreen.ts` | getUserMedia(tab), AudioContext, owns the `MixEngine`, handles OFFSCREEN_* messages |
| `src/engine/engine.ts` | Builds the graph; gains, A/B, fallback, snapshot stats (levels, latency, inference) |
| `src/engine/protocol.ts` | DFN3 constants, worker/worklet message types, latency presets |
| `src/engine/separation.worker.ts` | ORT-web session, DFN3 state carry, HopQueue processing |
| `src/audio/stem-mixer.ts` | **Core real-time logic:** alignment, stems, fallback weight, overload governor (unit-tested) |
| `src/audio/hop-bridge.ts` | HopSender (worklet) / HopQueue (worker) transport (unit-tested) |
| `src/audio/ring.ts` | Absolute-index float ring with wrapping 32-bit indices |
| `src/audio/limiter.ts`, `*.worklet.ts` | Lookahead limiter + worklet adapters |
| `src/shared/*` | Message types, gain math, level metering, URL check, serial queue, session reconciliation |
| `src/popup/popup.ts`, `static/popup.*` | **Interim** UI: enable/disable, Speech/Music/Master sliders, A/B, status line |
| `static/manifest.json` | Permissions: activeTab, tabCapture, offscreen, storage + host `https://*.youtube.com/*`; CSP with wasm-unsafe-eval |
| `scripts/build.mjs` | esbuild bundles + copies static, the ORT wasm and the model into `dist/` |
| `tests/unit/*` | 45 tests (limiter, pipeline with an oracle model through the real transport, shared logic) |
| `tests/e2e/*` | CDP-driven Chrome tests + harness helpers |
| `bench/*` | Benchmark, export, ground-truth harness |
| `docs/MODEL_BENCHMARK.md` | All model and engine measurements |
| `docs/DEVELOPMENT_PLAN.md` | Audit, bug list, phases |
| `tests/MANUAL_QA.md` | Human listening/QA checklists |

## 8. Next steps

### Phase C: mixer UI (next)
Build to `CLAUDE_PROMPT.md` §6:
- **Look:** premium dark; charcoal plus one mint accent.
- **Channels:** Speech and Music as equal channels, each with an icon, slider, numeric value, mute with restore, and a level meter. The engine already exposes `levels.speechDb` / `musicDb` / `outputDb` via `GET_ENGINE_STATS`.
- **Master** below the two channels.
- **Presets:** Balanced / Dialogue / Music / Lecture / Custom.
- **A/B, Reset** controls.
- **Status states:** Inactive, Starting, Loading model, Ready (Separating), Fallback/Too slow, Recognition in progress, Error. Map them from the engine's `status` values: `loading | priming | running | overloaded | unavailable | error`.
- **First-run explanation; accessibility:** labels, keyboard, focus states, contrast.
- **No heavy animations.**
- **Optional:** a latency setting (`Preferences.latency` exists but has no UI yet; it only takes effect at the next start).
- **Required in the copy:** "Music" = everything except speech. Mute must be exactly 0, with the previous value restorable.
- **Design skills available:** `frontend-design`, `impeccable`.

### Phase D: recognition
- **Providers:** research AudD vs ACRCloud (pricing, terms, formats, privacy). No unofficial Shazam endpoint.
- **Interface:** a provider adapter.
- **Consent:** an explicit consent sheet that shows what is sent and to whom.
- **Audio source:** a short excerpt from the **music stem**. That needs a tap; the engine's `musicGain` node, or pre-gain worklet output 1.
- **History:** store the video URL and playback timestamp (needs a YouTube content script or `chrome.scripting`; the host permission already exists) in local history, with seek-back.
- **Secrets:** never hardcode keys. Prefer a proxy, or a clearly labelled user-managed key flow.
- **No credentials configured:** show a real setup state.

### Phase E
- **Profiles:** video > channel > global.
- **Robustness:** SPA navigation and long-session tests.
- **Audits:** permissions, CSP, remote code and license audit.
- **Store readiness:** privacy policy draft and README screenshots.

## 9. Known limitations and open items

- **Listening tests by the user haven't been done.** Ask for them, and don't mark separation complete until they are.
- **Music louder than speech** (−5 dB) is the weakest case: the music stem improved only about +5 dB.
- **Mono model on the mid channel:** hard-panned speech leaks into the music stem.
- **During a fallback, the user's stem gains don't apply;** the original plays.
- **One unexplained E2E anomaly** in the lifecycle test: `speechGain` changed with no matching request. It didn't reproduce in 2 instrumented runs; the likely cause was a stale Chrome on the same debug port, which the harness now guards against. Set `E2E_DEBUG_STORAGE=1` to log storage writes.
- **Package size:** `dist/` is about 31 MB (model 16 MB + WASM 15 MB). An optional optimisation: move the STFT out of the graph (the matmul FFT matrices are about 7.4 MB).
- **Repo size:** `models/dfn3_stream.onnx` is committed (16 MB, allowed by its license). Don't add more weights without checking license and size.
- **Not yet in the repo:** a LICENSE file and a privacy policy (Phase E).
