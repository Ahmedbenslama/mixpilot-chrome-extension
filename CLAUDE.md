# Claude Code instructions for MixPilot

You are working in the MixPilot Chrome extension repository. Read these files before making changes:

1. `README.md`
2. `docs/PRODUCT_SPEC.md`
3. `docs/ARCHITECTURE.md`
4. `docs/COMPETITOR_RESEARCH.md`
5. `CLAUDE_PROMPT.md`

## Non-negotiable engineering rules

- Be honest about implemented versus mocked functionality. Never ship fake speech/music separation or fake song recognition.
- Independent Speech and Music controls must be backed by separate model outputs (stems), not EQ bands or a single crossfade slider.
- Preserve audible playback after `chrome.tabCapture` capture by routing the stream to the audio output. Test failure recovery and stop behavior.
- Keep processing local unless the user explicitly invokes music recognition.
- Never hardcode provider secrets in extension files.
- Do not use undocumented Shazam endpoints as the core recognition provider.
- Bundle executable JavaScript/WASM code in the extension package; do not execute remotely hosted code.
- Keep permissions narrow. No microphone permission. No broad `<all_urls>` unless the product requirements and Chrome review justify it.
- Keep heavy inference out of the MV3 service worker.
- Add tests for logic and document manual audio-quality tests.
- Do not mark an audio feature complete until it passes listening tests on real representative examples.

## Working method

- Inspect the existing code before editing.
- Implement in coherent vertical slices; keep the extension loadable after each slice.
- Run all available checks after each substantial change.
- Report exact files changed, tests run, results, known limitations, and any required setup keys.
- Do not add dependencies or model weights without checking their license, bundle size, maintenance status, and Manifest V3 compatibility.
