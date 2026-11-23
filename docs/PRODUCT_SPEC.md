# MixPilot — Product Specification

## 1. Product summary

MixPilot is a Chrome extension that lets a viewer adjust the mix of a YouTube video while it plays. Instead of accepting a creator's final audio mix, the viewer can choose how prominent dialogue and background music should be.

**One-line value proposition:** Make every YouTube video sound the way you want to hear it.

**Primary users:**
- People watching videos where background music competes with speech.
- Students watching lectures/tutorials who want dialogue to be clearer.
- Viewers who like a video's soundtrack and want to identify it without losing the dialogue.
- People who find large changes in loudness distracting.

## 2. Product principles

1. **Real separation, not fake sliders.** Independent voice/music controls must operate on separated audio stems, not merely EQ bands.
2. **Low-friction.** The core workflow should take one click to enable, then one intuitive mixer adjustment.
3. **Privacy by default.** Source separation runs locally. Music recognition is a separate, explicit user action.
4. **Fast and stable.** Avoid audible gaps, excessive latency, audio glitches, and excessive CPU use.
5. **Reversible.** A bypass control instantly returns the original tab audio path, and the user can compare processed/original audio.
6. **Honest UI.** Disable or label any capability that is not actually available; never simulate successful separation or recognition.

## 3. Core experience

### 3.1 Enable audio processing

- User opens a YouTube video.
- User clicks the extension action and explicitly enables MixPilot.
- The extension obtains permission to capture that tab's audio.
- Audio is routed through the extension's processing graph and back to the same tab output.
- If capture cannot start, preserve/restore normal playback and show a human-readable error.

### 3.2 Mix controls

The primary mixer has two independent channels:

| Channel | Range | Expected behavior |
|---|---:|---|
| Speech | 0–200% | Gain applied only to the speech stem |
| Music | 0–200% | Gain applied only to the music/accompaniment stem |
| Master | 0–150% or 0–200% | Final output gain after summing the stems, with peak protection |

Requirements:
- Smooth gain changes without clicks or pops.
- Mute is exactly 0% and can be restored without losing the prior value.
- Add reset-to-original and bypass controls.
- Show the current channel balance in a compact visual meter.
- Do not imply the two channels are independent until the model really emits separate stems.

### 3.3 Presets

Provide these initial presets:
- **Balanced:** speech and music at their original perceived levels.
- **Dialogue:** speech prioritized, music reduced.
- **Music:** music prioritized, speech reduced (do not hard-mute speech unless the user selects that explicitly).
- **Lecture:** strong dialogue priority with conservative processing.
- **Custom:** preserve user settings.

Presets are starting points, not a replacement for manual controls.

### 3.4 Music identification

- User can choose **Identify music** while MixPilot is active.
- Prefer the isolated music stem as the source for recognition; use the mixed original only as a clearly labelled fallback.
- Capture a short excerpt (provider limits permitting), create a fingerprint or recognition payload, and send it only after the user requests identification.
- Present title, artist, album/artwork where available, confidence/match status, and outbound listening/search links.
- Record the YouTube video timestamp at which the excerpt was captured.
- Save identified tracks locally as a history with video title, video URL, timestamp, recognition date, and result metadata.
- Allow deletion of individual history entries and all history.
- Never claim official Shazam integration unless a supported official interface is actually used. Apple's ShazamKit documentation lists Apple platforms and Android; do not assume it provides a general browser-extension API.

### 3.5 Soundtrack timeline

For each recognized track:
- Store the playback timestamp and track metadata.
- Let the user click the result to seek back to the relevant timestamp in the YouTube video.
- Support multiple tracks in one video.
- Keep this metadata local unless the user explicitly exports or syncs it.

### 3.6 Loudness and clarity

After the core stem mixer works:
- Optional loudness normalization / dynamic-range control.
- Conservative peak limiter after the stem sum.
- Optional speech clarity EQ, noise reduction, and room-noise suppression.
- A/B toggle between original and processed audio.
- Clearly separate source separation from EQ, compression, and noise reduction in both code and UI.

### 3.7 Profiles

Allow settings to be remembered by:
- Video (default behavior should be opt-in or easy to clear).
- Channel (opt-in).
- Global default.

Define precedence clearly: video override > channel override > global default. Provide a reset and a way to disable saving preferences.

## 4. Differentiation

The market already contains tools that isolate speech, reduce music, control voice/music balance, normalize loudness, or identify browser-tab audio individually. MixPilot should differentiate through the integrated workflow:

1. True two-stem mix controls, not just voice isolation.
2. Music recognition using the isolated music stem.
3. Timestamp-linked soundtrack history.
4. Per-video/channel mix memory.
5. Transparent local-first processing and explicit recognition consent.
6. A strong YouTube-native interaction that does not require leaving the video.

Do not spend MVP time copying generic equalizer presets or making a generic cross-site audio dashboard.

## 5. MVP priorities

### P0 — must work
- Chrome Manifest V3 extension.
- YouTube-only activation with clear user action.
- Robust tab audio capture and passthrough.
- A real source-separation engine producing synchronized speech/music stems.
- Independent speech, music, and master gains.
- Mute, bypass, reset, and safe failure recovery.
- No audio upload for ordinary separation.
- No false/placeholder functionality.

### P1 — next
- Music recognition from the music stem, user-triggered.
- Timestamped identification history.
- Balanced / Dialogue / Music presets.
- Per-video preferences.

### P2 — later
- Channel profiles.
- Auto-ducking based on speech activity.
- Additional audio clarity controls.
- In-player YouTube control overlay.
- Optional import/export of profiles.

## 6. Non-goals for the first release

- Editing or downloading YouTube videos.
- Replacing YouTube's player or bypassing its restrictions.
- Capturing microphone audio.
- Background recording or continuous song recognition without user action.
- Uploading full playback audio to a server.
- Promising studio-quality source separation on every device.
- Supporting every streaming site before YouTube works reliably.

## 7. UX requirements

- Dark, restrained, polished interface; strong typography and clear hierarchy.
- Main view shows status, Speech slider, Music slider, Master slider, preset, and bypass.
- The two main channel controls must be visually equal in importance.
- Identify Music is a clear secondary action.
- Show a small processing status (Starting / Ready / Model loading / CPU fallback / Error).
- Explain the first-time audio-capture permission in plain language.
- Never silently enable tab capture.
- Do not hide failure states behind disabled controls.
- All sliders must support keyboard input and accessible labels.
- Popup remains compact; a full options page may hold history and advanced settings.

## 8. Acceptance criteria

### Audio routing
- Activating MixPilot does not permanently mute or duplicate tab audio.
- Audio continues through the extension with no runaway feedback loop.
- Disabling or closing the captured tab releases tracks and AudioContext resources.
- Navigation away from YouTube stops processing or asks the user what to do.
- If model loading or inference fails, user can restore original audio immediately.

### Separation
- Speech and music outputs are time-aligned and have matching sample rate/channel layout.
- Speech gain changes do not directly change the music stem and vice versa.
- Bypass is level-matched as reasonably as possible.
- Test with speech over music, music-only passages, speech-only passages, overlapping vocals, silence, and noisy recordings.
- Do not mark this feature complete until real listening tests show meaningful separation on representative material.

### Recognition
- Recognition is only run after explicit user action.
- Recognition payload is as short as provider support allows.
- UI identifies the third-party provider and states that the excerpt is sent for matching.
- API credentials are never hardcoded in the extension package.
- Recognition failure leaves the audio experience unaffected.

### Privacy/security
- Ordinary source separation is local.
- No analytics or telemetry by default.
- No persistent recording of raw audio.
- Settings and history can be cleared.
- All executable JS/WASM code is packaged with the MV3 extension; do not load remotely hosted executable code.

## 9. Success measures

Measure with opt-in, privacy-preserving local diagnostics or controlled tests:
- Time from enable click to audible processed audio.
- Audio underruns/glitches per hour.
- End-to-end processing latency.
- CPU and memory use on low-, mid-, and high-tier machines.
- User-rated speech intelligibility and music quality across a test set.
- Source-separation failure rate.
- Music recognition match rate on music-only and mixed clips.
- Percentage of sessions that use independent controls rather than only presets.

Do not collect raw audio or identifiable viewing history for these metrics.
