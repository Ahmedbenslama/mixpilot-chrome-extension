# MixPilot Privacy Policy — Draft

**Status:** Draft for review; not legal advice. Replace the project-owner/contact details and have the final policy reviewed before distribution.

## Summary

MixPilot processes captured YouTube tab audio locally in your browser to separate speech from other sounds and apply your mix controls. It does not send audio anywhere for ordinary playback or separation. Optional music recognition sends a short excerpt to AudD only after you choose Identify music and accept the disclosure.

## Information processed

### Local processing and settings

- Captured audio is processed in the extension's offscreen document and is not intentionally stored.
- Mix controls and profile settings are stored in Chrome extension local storage.
- If you configure AudD, its API token is stored in Chrome extension local storage. Remove it from Recognition setup at any time. Do not use a token you are not authorized to use.

### Optional music recognition

Only after an explicit user action and per-request consent, MixPilot records an eight-second excerpt from its separated Music output and sends the excerpt and your AudD token to AudD's API (`api.audd.io`) for identification. AudD's own privacy policy, terms and retention practices apply to that request; consult them before consenting. MixPilot does not control the provider's handling of uploaded audio.

A successful match may be stored locally with its title, artist, optional album/release date/link, YouTube video URL, playback timestamp and the time it was recognized. Recognition history is capped at 100 records and can be deleted one entry at a time or cleared in full. MixPilot does not intentionally retain the audio excerpt after the request.

## Sharing

MixPilot does not include analytics or telemetry. It does not transmit data to the project author. The only intended third-party transmission in the current implementation is the user-requested recognition request to AudD described above. Chrome and YouTube may separately process data under their own policies.

## Permissions

- `activeTab` and `tabCapture`: user-initiated capture of the current tab's audio.
- `offscreen`: run Web Audio processing outside the service worker.
- `storage`: save settings, profiles, the optional user token and recognition metadata locally.
- YouTube host access: recognize supported YouTube pages and stop capture when leaving YouTube.
- `https://api.audd.io/*`: send a user-consented recognition excerpt to AudD.

## Retention and deletion

Settings, profiles, token and recognition metadata remain in Chrome extension local storage until removed by the user or the extension is uninstalled. Recognition history can be removed from the in-player Recognition setup section. Remove the token separately there. This does not delete information already sent to AudD; use AudD's own contact and deletion process for provider-held data.

## Security and children

The extension does not include a project-operated server for audio or credentials. Local browser storage is not a password vault; protect access to your browser profile. The extension is not designed for children.

## Changes and contact

Before public distribution, identify the project operator and provide a working privacy contact. Update this policy when the implementation or providers change. Current version is an implementation draft and must not be represented as a final legal policy.
