# MixPilot

**Your video. Your mix.**

MixPilot is a Chrome extension concept for taking control of the audio mix in YouTube videos. Its intended end state is real-time, independent control of speech and background music, optional soundtrack recognition, and per-video listening preferences.

> **Current starter status (v0.1.0):** this repository contains a Manifest V3 extension scaffold with user-initiated tab-audio capture, audio passthrough, master-volume control, and a protected output stage. It does **not** yet separate speech from music or identify songs. The UI labels those features as unavailable rather than pretending that an equalizer can separate overlapping sources.

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

## Load the starter extension locally

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select this repository folder (the folder containing `manifest.json`).
6. Open a YouTube video, click the MixPilot extension icon, and choose **Enable MixPilot**.

The first activation uses Chrome's tab-capture permission. Audio is routed through a local Web Audio graph and back to the same tab's output. The starter only implements master volume; separate speech/music controls are not active yet.

## Stop audio processing

Open the extension popup and click **Disable MixPilot**. The extension also stops capture when the captured tab is closed or navigates away from YouTube.

## Development status

| Capability | Status |
|---|---|
| Manifest V3 scaffold | Implemented |
| User-initiated YouTube tab capture | Implemented |
| Audio passthrough | Implemented |
| Master gain (0–200%) | Implemented |
| Output dynamics protection | Basic implementation; needs listening tests |
| Speech/music source separation | Not implemented |
| Independent speech/music gains | Not implemented |
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
