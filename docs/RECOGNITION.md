# Music recognition: implementation and release gates

## What is implemented

- The provider boundary is `src/recognition/provider.ts` (`RecognitionProvider`); the first adapter is `AudDProvider`.
- A recognition action is explicit and displays a consent dialog before recording or uploading anything.
- The offscreen engine captures an eight-second WebM/Opus clip from the post-separation Music gain node, submits the clip and a user-supplied token to `https://api.audd.io/`, then releases the recorder, stream and clip references.
- The original mixture is not sent by this code path. Normal playback and separation remain on-device.
- Successful metadata (title, artist, optional album/release date/provider link), the YouTube URL, playback time and local creation time are stored in `chrome.storage.local`. History is capped at 100 entries; individual entries or all history can be deleted.
- No provider token or result is bundled. The user manages one AudD token in the in-player recognition settings. It is stored in local Chrome extension storage and can be removed there.

## AudD versus ACRCloud: decision status

AudD is the first implementation because its documented API accepts a media file with a user API token and returns normalized track metadata, which suits the small user-triggered excerpt flow. The code isolates it behind an adapter so a second provider can be added without changing audio capture or history.

This is **not a completed commercial/provider evaluation**. Pricing, request limits, geographic availability, supported WebM/Opus inputs, data retention, commercial-use terms and accuracy must be checked against current official AudD and ACRCloud documentation before a public release. ACRCloud is not integrated; its signing/credential flow and exact endpoint requirements have not been validated here. No price, retention promise or accuracy claim is made in this repository. Do not treat this feature as production-ready until those checks and a real-key test pass.

## User-facing disclosure

Before every request, the consent sheet identifies AudD and `api.audd.io`, the eight-second isolated Music excerpt, the fact of upload, and the local video URL/timestamp history. Declining closes the sheet without recording. A token is optional and remains user-managed. The extension has a narrow `https://api.audd.io/*` host permission; no general web host access is added.

## Validation still needed

- Obtain a user-managed test token and verify real AudD success, no-match, invalid-token, rate-limit and network-failure responses.
- Confirm the provider accepts Chrome's actual WebM/Opus MediaRecorder output for this duration and the response matches expected metadata.
- Test consent, cancellation, one-entry deletion, clear-all, seek-back and capture/playback continuity in Chrome.
- Review provider terms, privacy/data processing and any applicable commercial restrictions before release.
