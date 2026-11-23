# MASTER PROMPT FOR CLAUDE CODE — MIXPILOT

You are acting as a senior Chrome Extensions engineer, real-time audio/DSP engineer, applied ML engineer, and product designer. Your task is to turn this repository into a polished, reliable Chrome extension called **MixPilot**.

Do not merely give me an implementation plan. Inspect the repository, make the changes, implement working functionality, run checks, and report what is genuinely complete. Keep the extension loadable throughout development.

## 0. Product context

MixPilot is a Chrome extension for YouTube that lets viewers control the audio mix of a video while it plays.

The problem: many YouTube videos have a poor audio mix. Background music can drown out the speaker, speech can be too loud relative to the soundtrack, and a viewer may like the music but want to mute or reduce the speaker to identify the track.

The core experience is a mixer with **two independent audio stems**:

- **Speech** — raise, lower, or mute the speaker/dialogue.
- **Music** — raise, lower, or mute the background music/accompaniment.

The user should then be able to click **Identify music** to recognize the isolated music stem, show the track title and artist, and save the track with the timestamp of the YouTube video where it was heard.

The current repository is a starter. Read `README.md`, `CLAUDE.md`, `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, and `docs/COMPETITOR_RESEARCH.md` before coding. The starter currently supports user-initiated tab audio capture, passthrough, master gain, and a basic peak-protection stage. It does **not** yet perform source separation or song recognition.

## 1. Competitive context and product differentiation

Research indicates that individual parts of this idea already exist in browser extensions:

- UnTube: local speech isolation.
- AudioX: voice/music balancing.
- MusicMute: background-music removal.
- AI Voice Booster: dialogue enhancement and loudness balancing.
- tuneOut and open-source browser song-finder projects: music identification from browser-tab audio.

Do not reproduce these as a generic bundle and do not spend time making another simple EQ extension. Our differentiation must be:

1. True speech/music stem separation.
2. Independent gain control for both stems (not a single crossfade slider).
3. Music recognition using the isolated music stem, making identification more reliable when speech overlaps the song.
4. Timestamp-linked soundtrack history for each YouTube video.
5. Per-video/channel mix memory and practical presets.
6. Local-first processing and explicit consent before any recognition audio leaves the device.

Use the competitor notes as a starting point, then verify important current capabilities against official product listings and vendor documentation. Do not claim that MixPilot is unique in a capability that a competitor already offers.

## 2. Non-negotiable technical truthfulness

**Do not fake source separation.**

An equalizer, high-pass filter, voice frequency boost, voice activity detector, compressor, or a speech/music crossfade slider does not create independent speech and music stems. The independent controls must operate on separate outputs from a genuine source-separation model.

Do not:
- Connect both sliders to the same gain node and call it separation.
- Use different EQ curves and label them speech/music stems.
- Display a song result that came from a hard-coded fixture as a live recognition result.
- Claim real-time support before measuring latency, CPU usage, memory, and audio artifacts.
- Hide an unsupported model/device behind a fake enabled state.

If a real-time model is not feasible on a target device, clearly show that separation is unavailable on that device and offer a transparent passthrough fallback. The user must always be able to restore original audio.

## 3. Technical investigation — do this before choosing the model

Investigate current candidate models and runtimes. Compare at least three realistic approaches. For each, document:

- What it actually separates (speech vs accompaniment, vocals vs instrumental, etc.).
- Whether it can separate dialogue/music from arbitrary YouTube audio, not only studio songs.
- Model format (ONNX or otherwise), model size, license, source, and redistribution rights.
- Browser execution support and dependencies.
- Quantization availability and expected quality impact.
- Expected inference latency / real-time factor on low-, mid-, and high-tier Windows laptops.
- Memory usage and CPU/GPU/WebGPU compatibility.
- Streaming/chunked inference availability.
- Whether outputs can be kept synchronized.

Do not select a model merely because it performs well on a server GPU. Test whether it can operate in-browser under Chrome Manifest V3 constraints.

A promising direction to investigate is a compact, quantized ONNX model using a bundled ONNX Runtime Web build, with WebGPU where supported and WASM/CPU fallback where practical. This is a direction to validate, not a predetermined answer.

All executable JavaScript and WASM must be bundled with the extension. Do not fetch/execute inference runtime code from a CDN. Model weights are data; if downloaded on demand, verify the downloaded artifact, document its origin and license, and clearly explain the first-run download. Prefer a packaged model if the store bundle size and redistribution rights allow it.

## 4. Required architecture

Keep the Manifest V3 architecture sound.

### Extension components

- **Popup / UI:** React + TypeScript is acceptable if it improves maintainability, but do not introduce an unnecessarily complex framework. A clean, compact, polished popup is essential.
- **Service worker:** only event routing, permissions, tab validation, session lifecycle, and state coordination. No heavy inference here.
- **Offscreen document:** owns tab media capture, the AudioContext, and lifecycle of the audio graph.
- **Audio processing worker / worklet:** handles streaming buffers and model inference without blocking the UI thread. Use AudioWorklet for deterministic audio scheduling when appropriate. Keep long inference tasks out of the service worker and main UI thread.
- **Settings/history store:** `chrome.storage.local` for small preferences and metadata; IndexedDB for model cache or larger data if required.

### Target audio pipeline

```text
YouTube tab audio
       |
       v
Tab capture / MediaStream
       |
       v
Input conditioning + bounded chunk buffer + resampling
       |
       v
Real source-separation model
       |
       +---------------------------+
       |                           |
       v                           v
 Speech stem                 Music stem
       |                           |
 Speech GainNode             Music GainNode
       |                           |
       +-------------+-------------+
                     |
                     v
              Stem summing stage
                     |
                     v
          Master gain + peak limiter
                     |
                     v
           AudioContext.destination
```

The stem outputs must be synchronized. Handle chunk boundaries with appropriate overlap/windowing and overlap-add or the model's documented streaming method. Avoid clicks, gaps, and phase/timing drift.

The audio pipeline must have bounded buffers. If inference falls behind, do not let latency grow indefinitely. Define a stable fallback strategy and show a real status to the user.

### Audio capture rules

- Only process YouTube in the first release.
- Start capture only after a clear, explicit user action.
- Use `chrome.tabCapture`; do not try to download, extract, or modify YouTube media URLs/streams.
- Preserve playback by routing the captured stream to the AudioContext destination.
- Ensure that a failed start does not leave the tab silent.
- Ensure that stop/disable closes tracks, nodes, buffers, workers, and contexts.
- Stop or handle capture safely when the user navigates away from YouTube, closes the tab, reloads the video, or reloads the extension.
- Test repeated start/stop and popup closure.

### Performance targets to measure

Set realistic targets after benchmarking, but aim for:
- No unbounded latency growth.
- No persistent audio glitches or duplicated audio.
- A usable low-latency mode on a mid-range laptop.
- Clear status when model loading or inference is too slow.
- CPU and memory use low enough for ordinary browser viewing.

Do not promise a numeric latency before measuring it.

## 5. Product features to implement

### P0 — core mixer

1. Enable/disable MixPilot for the active YouTube tab.
2. Speech slider: 0–200%.
3. Music slider: 0–200%.
4. Master slider: suitable safe range, with peak protection.
5. Exact mute and easy restore of previous gain.
6. Balanced / Dialogue / Music / Lecture / Custom presets.
7. Bypass to original audio and an A/B comparison action.
8. Reset to original mix.
9. Processing/model status, errors, and useful first-run explanation.
10. A graceful path when the model is unavailable.

Sliders must be smooth, keyboard-accessible, labelled, and responsive. Changes should avoid zipper noise/clicks.

### P1 — music identification

1. Add an **Identify music** action.
2. Prefer the isolated music stem over the mixed audio.
3. Capture only a short excerpt that meets the selected provider's minimum requirements.
4. Use a provider adapter interface so the vendor can be replaced without rewriting the UI/audio engine.
5. Research documented providers such as AudD and ACRCloud; compare pricing, request limits, formats, commercial terms, accuracy, and privacy before choosing.
6. Display title, artist, optional album/artwork/release date, match confidence when provided, provider name, and useful outbound links.
7. Store the current YouTube URL and playback timestamp with the recognition result.
8. Keep recognition failure from interrupting playback.
9. If no provider credentials are configured, show a real setup state. Do not pretend recognition succeeded.

**Important:** Do not rely on an undocumented unofficial Shazam endpoint. Apple's official ShazamKit overview currently lists Apple platform support and an Android SDK; do not assume that it provides a general web/Chrome-extension SDK. Verify vendor documentation before claiming official Shazam integration.

### Recognition security and privacy

- Never hardcode an API secret in extension JavaScript or commit it to Git.
- Prefer a small server-side proxy with credentials in environment variables, input validation, strict payload-size/duration limits, rate limiting, and no raw-audio retention.
- If there is no backend infrastructure, design a clearly labelled user-managed-key option only if the provider's terms permit it. Explain that an extension-stored key is not a strong secret.
- Before sending an excerpt, show what is sent and to whom. Require an explicit Identify action.
- No automatic or continuous uploads.
- Delete temporary audio buffers immediately after the request completes or fails.

### P1 — track timeline and history

- Maintain local recognition history.
- Each item shows track, artist, YouTube title, timestamp, and recognition date.
- Clicking an item should seek the same video to that timestamp when possible.
- Support multiple songs per video.
- Allow deleting one item or all history.
- Do not store raw audio in history.

### P2 — profiles and adaptive mixing

- Global default, per-channel, and per-video profile scopes.
- Precedence: video override > channel override > global default.
- Provide a simple reset / clear preferences option.
- Add optional speech-aware automatic music ducking only after the source-separation mixer is stable.
- Duck smoothly and restore music when speech stops; allow sensitivity and reduction strength controls.
- Add optional normalization, speech EQ, and noise reduction as distinct modules, not as fake substitutes for source separation.

## 6. UX / visual direction

Design a premium, restrained dark interface. Avoid a generic browser-extension settings form.

Visual direction:
- Charcoal/near-black base.
- One restrained accent color (mint/teal is acceptable).
- Clean typography, clear spacing, subtle borders, compact controls.
- Speech and Music are equally prominent channels, each with its own icon, slider, numeric value, mute button, and meter.
- Master output appears below the two stems.
- Preset selector is visible without overwhelming the mixer.
- Identify music is easy to find but visually secondary to mixing.
- Display status states: Inactive, Starting, Loading model, Ready, CPU fallback, Recognition in progress, Error.
- Responsive popup dimensions; use a separate options page for full history/settings if necessary.
- Add accessible labels, keyboard operation, focus states, and sensible color contrast.

Do not add animated visualizations that consume significant CPU or distract from the mixer. A simple real-time level meter is enough.

## 7. YouTube integration

Start with a stable popup. After the popup and audio engine work, consider an in-player overlay that follows YouTube SPA navigation safely.

- Keep content scripts narrowly scoped to YouTube.
- Do not rely on fragile DOM selectors without fallbacks.
- Do not break the native controls or intercept unrelated clicks.
- Keep the overlay optional and dismissible.
- Do not scrape or process YouTube page media URLs; rely on the supported capture API.

## 8. Quality, tests, and failure handling

Create automated tests for pure logic and service abstractions. Add a manual audio test checklist.

Test clips/scenarios:
- Speech with quiet music.
- Speech with loud music.
- Music-only passages.
- Speech-only passages.
- Overlapping vocals and dialogue.
- Multiple speakers and different accents.
- Outdoor noise, room echo, and background chatter.
- Quiet speech followed by a loud effect.
- Different sample rates and channel layouts.
- Long sessions to catch memory leaks and queue buildup.

Record:
- End-to-end latency.
- CPU usage.
- Memory use.
- Audio glitches/underruns.
- Speech intelligibility.
- Music artifacts.
- Recognition success rate on clean and mixed stems.

The UI must clearly recover from:
- Permission denied.
- Tab not on YouTube.
- Capture stream unavailable.
- Model download/load failure.
- Unsupported WebGPU/runtime.
- Inference slower than playback.
- Recognition network/provider error.
- Extension reload or navigation.

Never leave the user with a silent tab after an error. If uncertain whether the original path was restored, report that uncertainty clearly and offer the safest available recovery action.

## 9. Privacy, security, and Chrome Web Store readiness

- Manifest V3.
- Minimal permissions; no microphone permission.
- No broad `<all_urls>` permissions.
- No remote executable JavaScript/WASM.
- All executable logic bundled in the package.
- No hidden analytics or tracking.
- No raw audio retention.
- Clear privacy disclosure for user-triggered recognition.
- No API keys in source control.
- Include a permission rationale and draft privacy policy before Chrome Web Store publication.
- Inspect all transitive dependencies for remote code loading.
- Verify model and library licenses before distribution.

## 10. Git workflow

The user requested a GitHub repository. First inspect `git status`, configured remotes, and GitHub CLI authentication if available.

- Never overwrite or push to an unrelated existing remote.
- If there is no remote and GitHub CLI is authenticated, create a **private** repository named `mixpilot-chrome-extension`, commit the working implementation, and push the default branch.
- If GitHub authentication or repository write access is unavailable, do not claim that the remote repo exists. Leave the local repo ready and provide the exact commands the user should run.
- Do not commit `.env`, provider secrets, raw audio, personal data, model files with unclear redistribution rights, or generated cache/build artifacts.
- Use clear, conventional commit messages.

## 11. Implementation workflow

Work in these phases, but do not stop at writing the plan:

### Phase A — audit
- Inspect the current starter and verify the capture/passthrough flow.
- Run the extension and correct bugs in the existing baseline.
- Research and document the model/runtime/provider choices.

### Phase B — audio engine
- Create clean TypeScript interfaces for capture, processing, source separation, and mixing.
- Add the real model adapter.
- Implement bounded streaming/chunk inference and synchronized stem outputs.
- Add gain nodes, mute, limiter, bypass, and fallback.
- Add tests and performance measurements.

### Phase C — mixer UI
- Build the two-stem mixer UI and presets.
- Connect controls to the actual independent gains.
- Add status, errors, keyboard support, and a clear recovery path.

### Phase D — music recognition
- Add provider abstraction and one documented provider.
- Use isolated music stem and explicit consent.
- Add result display, timestamps, and local history.
- Add backend proxy only if required, with secrets held server-side.

### Phase E — polish and release readiness
- Add profiles, A/B comparison, and optional timeline UI.
- Test YouTube SPA navigation and long sessions.
- Audit permissions, CSP, remote code, data flows, model licenses, and dependency licenses.
- Update README with precise setup, build, permissions, limitations, and screenshots if available.

## 12. Final report format

When done, give me:

1. What is implemented and genuinely working.
2. What is not implemented and why.
3. Source-separation model selected, source, license, size, runtime, and benchmark results.
4. Audio latency, CPU, and memory measurements with the machine/test conditions.
5. Recognition provider selected, setup steps, pricing/limits, and what data is sent.
6. Commands to install, run, test, and package the extension.
7. Tests run and their actual results.
8. GitHub repository URL only if a remote repository was truly created and pushed successfully.
9. Known limitations and next highest-value task.

Start by auditing the repository and reading the documentation. Then implement the product; do not stop after restating this prompt.
