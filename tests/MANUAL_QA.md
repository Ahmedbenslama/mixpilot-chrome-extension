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

- [ ] Speech 0%, Music 100%: residual Music is ducked around detected speech using the 149.5 ms processing path; listen for any remaining voice/echo, missed soft speech, and soundtrack pumping. The gate may lower music while dialogue is detected.
- [ ] Speech 100%, Music 0%: mostly clean dialogue; note music bleed, choppy words or robotic tone.
- [ ] Speech 150%, Music 30%: dialogue is easier to follow than the original.
- [ ] Both at 100%: sounds like the original. Toggle A/B; no jump in time or level.
- [ ] Sliders are smooth; test lip sync at the default reported 149.5 ms processing delay and compare with passthrough; document whether that is acceptable on this device.
- [ ] Test dialogue with quiet/loud music, music-only, speech-only, sung vocals under dialogue, overlapping speakers, bass/percussion, noise/reverb, and effects.
- [ ] Long session (≥ 30 min): memory, CPU and latency stay stable.
- [ ] Record intelligibility, music artifacts, CPU/memory, latency and underruns. Do not mark separation complete until these human results are reviewed.

## Phase C: minimalist mixer UI

- [ ] Panel uses monochrome black/white/gray only: no colored accents, icons, meters, cards or decorative animation; no border frame or extension name.
- [ ] Three bold, high-contrast sliders with circular handles (Speech, Music/other, Master) are visible and keyboard operable; values update correctly.
- [ ] Running status reports no more than 150 ms processing delay; inspect lip-sync and compare against the original.
- [ ] Restore returns all slider values to 100% and leaves the player on the processed balanced mix.
- [ ] Inactive status clearly tells the user to click the MixPilot toolbar icon; clicking the page panel cannot grant `activeTab`.
- [ ] Clicking the toolbar icon on a YouTube watch page enables capture; clicking it again disables capture.
- [ ] Status/error text remains legible without colored styling, and the controls stay attached exactly once during YouTube SPA navigation.

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
