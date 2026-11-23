# MixPilot

**Your video. Your mix.**

MixPilot is a Chrome extension concept for taking control of the audio mix in YouTube videos. Its intended end state is real-time, independent control of speech and background music, optional soundtrack recognition, and per-video listening preferences.

> **Current status (v0.3.0, Phase B complete):**
> - **Works today:** live on-device speech/music separation on YouTube, with independent Speech, Music and Master gains, a level-matched A/B, and automatic fallback to the original audio if the device can't keep up.
> - **Verified:** automated tests and objective measurements in Chrome 158 (see [`docs/MODEL_BENCHMARK.md`](./docs/MODEL_BENCHMARK.md)).
> - **Not verified:** listening tests haven't been done yet, so separation is **not yet marked complete**.
> - **Interim UI:** the popup is a functional placeholder until Phase C.
> - **Not yet:** song identification.

## What makes the product different

The product should go beyond a simple speech-isolation toggle. Its core interaction is a two-stem mixer:

- **Speech:** independently raise, lower, or mute dialogue.
- **Music:** independently raise, lower, or mute the soundtrack.
- **Identify music:** recognize a user-selected excerpt from the isolated music stem and show track metadata and links.

The full product spec and Claude Code build instructions are in:

- [`CLAUDE_PROMPT.md`](./CLAUDE_PROMPT.md) — copy this into Claude Code as the implementation brief.
- [`docs/PRODUCT_SPEC.md`](./docs/PRODUCT_SPEC.md) — product scope and acceptance criteria.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — Chrome audio-capture and processing architecture.
- [`docs/COMPETITOR_RESEARCH.md`](./docs/COMPETITOR_RESEARCH.md) — initial market comparison and differentiation.

## Build and load locally

Requires Node.js 20 or newer.

```powershell
npm install
npm run build        # outputs the loadable extension to dist/
```

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the **`dist/`** folder.
3. Open a YouTube video, click the MixPilot icon, then choose **Enable MixPilot**.

Audio is processed locally and played back through the same tab's output.

- **Delay:** processing adds about 70 ms, below the point where most people notice audio lagging behind the picture (about 125 ms).
- **Startup:** about one second after enabling, the model is running and the Speech and Music sliders act on separated stems.
- **Bundled model:** `models/dfn3_stream.onnx` (16 MB, MIT/Apache-2.0); see `models/MODEL_CARD.md`.

## Checks

```powershell
npm run check        # typecheck + unit tests + build
npm run test:e2e     # lifecycle E2E: throwaway Chrome profile, loads dist/, drives a CC-licensed YouTube video
npm run test:e2e:separation   # live separation on YouTube: timing, stability, CPU, level matching, overload recovery
npm run bench:harness         # ground truth: real-time engine in Chrome vs offline SI-SDR (needs bench/ data, see bench/README.md)
```

The end-to-end test verifies capture, signal flow, gain accuracy, mute, and the stop/cleanup paths numerically. It can't judge how things sound; see `tests/MANUAL_QA.md` for the listening checks.

## Stop audio processing

Open the extension popup and click **Disable MixPilot**. Capture also stops when the captured tab closes, navigates away from YouTube, or when the extension is reloaded.

## Permissions

| Permission | Why |
|---|---|
| `tabCapture` + `activeTab` | Capture the current tab's audio, only after you click the extension |
| `offscreen` | Host the audio engine in a hidden extension page; MV3 service workers can't run Web Audio |
| `storage` | Remember settings |
| `https://*.youtube.com/*` | Know when the captured tab leaves YouTube (to stop capture), and later read the video timestamp for song history. No other sites. |

The extension's CSP adds `'wasm-unsafe-eval'` so the **bundled** ONNX Runtime WebAssembly can compile. It doesn't allow remote code: `script-src` is still `'self'` only.

## Development status

| Capability | Status |
|---|---|
| Manifest V3 scaffold (TypeScript, esbuild, Vitest) | Implemented |
| User-initiated YouTube tab capture | Implemented, E2E-tested |
| Audio passthrough | Implemented, E2E-tested |
| Master gain (0–200%) | Implemented, E2E-tested (measured within 0.1 dB) |
| Peak protection | Lookahead limiter, unit-tested; listening test pending |
| Stop on tab close / leaving YouTube / extension reload | Implemented, E2E-tested |
| Speech/music source separation | Live in the extension (DeepFilterNet3, on-device). Live SI-SDR matches offline. **Listening tests pending.** |
| Independent speech/music gains (0–200%) | Implemented on separate model outputs; E2E-tested |
| A/B original (latency- and level-matched) | Implemented; E2E-tested (within 0.13 dB) |
| Overload/unsupported fallback | Implemented; E2E-tested (worker stall → original audio → automatic recovery) |
| Music recognition | Not implemented |
| Per-video/channel profiles | Not implemented |
| YouTube in-player controls | Not implemented |

## Important technical note

An equalizer can change frequency bands, but it cannot reliably separate a speaker from music that overlaps the same frequencies. Independent controls require a source-separation model that outputs at least two synchronized stems (speech/vocals and accompaniment/music). See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Privacy direction

The intended default is on-device processing. No audio should be uploaded for ordinary playback or source separation. Music recognition should only send a short, user-selected excerpt to a recognition provider after an explicit action and clear disclosure. Do not store raw audio by default.

## GitHub repository setup

This working copy is ready to initialize as a Git repository. To create a private GitHub repository and push the first commit with GitHub CLI:

```bash
git init
git add .
git commit -m "chore: initialize MixPilot Chrome extension"
gh auth login
gh repo create mixpilot-chrome-extension --private --source=. --remote=origin --push
```

To make it public, replace `--private` with `--public`. Review the files before publishing and do not commit API keys, user audio, model files with unclear redistribution rights, or local build artifacts.

## License

No license has been selected yet. Choose a license only after deciding whether the project will be open source and checking the licenses of all included dependencies and model weights.
