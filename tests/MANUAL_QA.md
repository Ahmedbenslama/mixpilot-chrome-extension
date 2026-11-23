# Manual QA — MixPilot

Automated coverage: `npm run check` (unit) and `npm run test:e2e` (capture, signal flow, gain accuracy, mute and cleanup, measured numerically in Chrome). The items below need a human: listening, real interactions, and permission dialogs.

## Phase A: passthrough (record the date, Chrome version and machine)

- [ ] Load `dist/` unpacked; open a YouTube video; click the MixPilot icon → **Enable**.
- [ ] Audio stays audible, with **no doubling or echo** and no audible delay against the picture.
- [ ] Compare by ear with MixPilot off: the level at 100% master sounds the same as off.
- [ ] Move master through 0 → 50 → 100 → 150 → 200%: smooth, no clicks or zipper noise.
- [ ] At 150–200% on a loud scene: no harsh clipping (the limiter should hold peaks below −1 dBFS).
- [ ] Disable: playback returns to normal immediately.
- [ ] Close the popup while active: audio continues; reopening shows "Active".
- [ ] Non-YouTube tab → Enable shows a clear error and changes nothing.
- [ ] Reload the extension in `chrome://extensions` while active → tab audio returns to normal; the popup shows Inactive.
- [ ] 30-minute session: no drift, crackle, or growing delay.

## Phase B onward: source separation (template; fill in once the engine lands)

Use `bench/listening/` for offline stems, then real YouTube content:

- [ ] Dialogue with quiet background music.
- [ ] Dialogue with music louder than the voice.
- [ ] Music-only intro/outro (Speech stem should be near silent).
- [ ] Speech-only section (Music stem should be near silent).
- [ ] Sung vocals under dialogue (singing should land in Music).
- [ ] Two people speaking at once; different accents.
- [ ] Strong bass/percussion music.
- [ ] Outdoor noise, room echo, crowd.
- [ ] Quiet speech followed by a loud effect.
- [ ] Long session (≥ 30 min): memory, CPU, latency stable.
- [ ] Record end-to-end latency, CPU %, memory, underruns, intelligibility and music artefacts.

## Recognition (Phase D)

- [ ] Identify a clean instrumental section, and one with dialogue over the music.
- [ ] Handle no-match and network failure without affecting playback.
- [ ] Consent sheet shows exactly what is sent and to whom, before anything is sent.
- [ ] Timestamp and video URL saved; clicking seeks back.
- [ ] No raw audio retained; delete-one and delete-all both work.
