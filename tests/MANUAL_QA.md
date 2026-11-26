# Manual QA — MixPilot

Automated coverage: `npm run check` runs typecheck, unit tests and build. Chrome E2E tests are separate (`npm run test:e2e` and `npm run test:e2e:separation`); they require the documented Chrome/CDP harness and network access to the test video. Audio checks below need a human: listening, real interactions, and permission dialogs.

## Phase A: passthrough (record the date, Chrome version and machine)

- [ ] Load `dist/` unpacked; open a YouTube video; click the MixPilot icon to enable.
- [ ] Audio stays audible, with no doubling or echo and no audible delay against the picture.
- [ ] Compare by ear with MixPilot off: the level at 100% master sounds the same as off.
- [ ] Move master through 0 → 50 → 100 → 150 → 200%: smooth, no clicks or zipper noise.
- [ ] At 150–200% on a loud scene: no harsh clipping (the limiter should hold peaks below −1 dBFS).
- [ ] Disable: playback returns to normal immediately.
- [ ] Close the popup while active: audio continues; reopening shows Active.
- [ ] Non-YouTube tab → Enable shows a clear error and changes nothing.
- [ ] Reload the extension while active → tab audio returns to normal; UI shows Inactive.
- [ ] 30-minute session: no drift, crackle, or growing delay.

## Phase B: source separation listening test

**Setup:** Load `dist/`, enable on a video and wait for **Separating** (about 1 s). Record date, URL, timestamp and observations.

- [ ] Speech 0%, Music 100%: voices disappear or almost disappear; note residue, warbling and musical-noise artifacts.
- [ ] Speech 100%, Music 0%: mostly clean dialogue; note music bleed, choppy words or robotic tone.
- [ ] Speech 150%, Music 30%: dialogue is easier to follow than the original.
- [ ] Both at 100%: sounds like the original. Toggle A/B; no jump in time or level.
- [ ] Sliders are smooth; lip sync is acceptable (about 70 ms processing delay).
- [ ] Test dialogue with quiet/loud music, music-only, speech-only, sung vocals under dialogue, overlapping speakers, bass/percussion, noise/reverb, and effects.
- [ ] Long session (≥ 30 min): memory, CPU and latency stay stable.
- [ ] Record intelligibility, music artifacts, CPU/memory, latency and underruns. Do not mark separation complete until these human results are reviewed.

## Phase C: mixer UI

- [ ] Layout works under the YouTube player in dark and light YouTube themes and at narrow viewport widths.
- [ ] Keyboard Tab/Shift+Tab and arrow-key slider controls work; focus remains visible and YouTube shortcuts do not steal control while a slider is focused.
- [ ] Speech and Music sliders are independent. Music's explanatory copy says it includes everything except speech.
- [ ] Mute sets exactly 0%; Restore returns to the previous level. Dragging the slider away from 0 synchronizes the mute control.
- [ ] Meter responds to actual stem/output level and shows silence as −∞ dBFS.
- [ ] Balanced, Dialogue, Music and Lecture presets update real engine gains; Custom reflects manual edits.
- [ ] Master, Reset, A/B, Starting/Loading/Separating/Too slow/Unavailable/Error states work.
- [ ] Click Enable/Disable repeatedly; error messaging and original-audio fallback remain clear.
- [ ] Capture and separation remain after navigating within YouTube; UI is reattached once, not duplicated.

## Phase D: recognition (requires an authorized user-managed AudD token)

- [ ] Configure a token; verify it is stored locally and Remove deletes it.
- [ ] Open consent: provider, destination, exact excerpt length/source, upload and local metadata are clear. Cancel; verify no recording or request begins.
- [ ] Accept on a music-containing segment: playback continues, only the isolated Music stem is captured, and no more than eight seconds is sent.
- [ ] Verify successful match, no-match, invalid token, network failure and provider rate limit. Failure must not interrupt playback or create a fake result.
- [ ] Successful result displays real provider metadata; video URL/time saved locally; Seek jumps to the saved video time.
- [ ] Remove one history item and clear all; verify both work after reload.
- [ ] Confirm the clip is not retained by MixPilot after request; review AudD's current privacy/terms separately.
- [ ] Confirm actual Chrome MediaRecorder WebM/Opus is accepted by AudD before release.

## Phase E: profiles, store and permissions

- [ ] Save global, channel and video profiles. Verify video > channel > global precedence when navigating across sample videos/channels.
- [ ] Change mix and save; reload the video and extension; profile applies only to matching scope. Clear an override and verify fallback.
- [ ] YouTube SPA navigation does not duplicate controls; processing stops when leaving YouTube.
- [ ] Review `docs/PRIVACY_POLICY_DRAFT.md` and every item in `docs/STORE_READINESS.md`; the project is not release-ready until all blockers are resolved.
- [ ] Review permissions, CSP, bundled JS/WASM, model/dependency licenses, zip contents, icons and screenshots.
