# MixPilot

**Your video. Your mix.**

MixPilot is a Chrome extension for taking control of speech and background sound in YouTube videos.

> **Current status (v0.4.0):**
> - **Current UI:** deliberately minimal monochrome panel with bold Speech, Music/other and Master sliders plus one Restore button. Capture starts/stops from the browser toolbar icon.
> - **Audio model:** DeepFilterNet3 remains in use. Speech at 0% mutes the estimated Speech output, but speech can still leak into the residual Music stem. See [`docs/MODEL_REVIEW_2026-11.md`](./docs/MODEL_REVIEW_2026-11.md); no replacement has yet passed real-music and Chrome validation.
> - **Not verified:** human listening/UI QA and long-session tests. Separation is **not marked complete** until listening tests are reviewed.
> - **Advanced features:** recognition and profiles are not exposed in the current minimal panel.
> - **Not store-ready:** full provider/model/license evaluation, privacy review and screenshots remain pending.

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
3. Open a YouTube video and click the MixPilot toolbar icon once to enable capture; use the in-player **Disable MixPilot** button to stop.

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

Use the in-player **Disable MixPilot** button or click the toolbar icon again. Capture also stops when the captured tab closes, navigates away from YouTube, or when the extension is reloaded.

## Permissions

| Permission | Why |
|---|---|
| `tabCapture` + `activeTab` | Capture the current tab's audio, only after you click the extension |
| `offscreen` | Host the audio engine in a hidden extension page; MV3 service workers can't run Web Audio |
| `storage` | Store settings, mix profiles, optional user-managed AudD token and local recognition history |
| `https://*.youtube.com/*` | YouTube in-player controls, tab lifecycle validation and video/timestamp history. No other playback sites. |
| `https://api.audd.io/*` | Send a short music-stem excerpt only after the user requests recognition and accepts the disclosure. |

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
| YouTube-native mixer | Minimal monochrome Speech/Music/Master sliders and Restore; manual visual QA pending |
| Speech/music source separation | DeepFilterNet3 remains; audible speech leakage in residual Music is a known limitation. Real-music model replacement not validated |
| Music recognition | AudD adapter exists in code but is not exposed in the minimal panel |
| Per-video/channel/global profiles | Prior implementation is not exposed or applied in the current minimal panel |
| Privacy/store readiness | Draft policy and checklist; not release-ready |

## Important technical note

An equalizer can change frequency bands, but it cannot reliably separate a speaker from music that overlaps the same frequencies. Independent controls require a source-separation model that outputs at least two synchronized stems (speech/vocals and accompaniment/music). See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Privacy direction

Ordinary playback and separation are on-device. Recognition is opt-in per request and uploads an eight-second Music-stem excerpt to AudD after a consent sheet; the user supplies and stores the token locally. MixPilot keeps metadata history locally, not the excerpt. Review [`docs/PRIVACY_POLICY_DRAFT.md`](./docs/PRIVACY_POLICY_DRAFT.md) and [`docs/STORE_READINESS.md`](./docs/STORE_READINESS.md); both real-provider QA and legal/provider review are still required.

## Release readiness

The project is already maintained in Git. Do not publish a release until the open items in [`docs/STORE_READINESS.md`](./docs/STORE_READINESS.md) have been completed. Never commit user API tokens, audio, or ignored build/benchmark artifacts.

## License

No license has been selected yet. Choose a license only after deciding whether the project will be open source and checking the licenses of all included dependencies and model weights.
