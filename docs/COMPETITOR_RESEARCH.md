# MixPilot — Initial Competitor Research

**Research date:** 23 November 2026. Chrome Web Store listings and capabilities can change; re-check before launch.

## Products found

| Product | Publicly described capability | Implication for MixPilot |
|---|---|---|
| UnTube | On-device real-time speech isolation from background noise/music; the listing showed version 1.0.11, updated 23 Oct 2026. | Speech-first filtering already exists. Compete with two independently controllable stems and integrated music discovery. |
| AudioX | Voice/background separation with a voice-to-music slider; listing describes YouTube and other audio sites. | A slider that balances voice and music is not enough differentiation. Aim for independent speech and music gains, recognition of the music stem, and timestamped history. |
| MusicMute | On-device background-music removal with adjustable strength; listing updated 16 Nov 2026. | Local music reduction exists. Differentiate with music-preserving and music-enhancement workflows, not only removal. |
| AI Voice Booster | Voice enhancement, background reduction, and loud-scene leveling. | Loudness normalization/voice clarity should be supporting features rather than the main differentiator. |
| tuneOut | Music recognition for sound playing in the current browser tab, with track history and links. | Track identification is already available as a standalone browser workflow. Integrate it with the isolated music stem and video timestamps. |
| asil-sound-finder (open source) | Browser-tab song identification using a Shazam unofficial endpoint with AudD as a possible backup. | Useful architecture reference, but do not rely on an undocumented Shazam endpoint for a product. |

## Direct source links

- UnTube: https://chromewebstore.google.com/detail/untube/dnpjndgmbnibmfemfmbkbkpgkflcmgdp
- AudioX: https://chromewebstore.google.com/detail/audiox/gkojglaciampglgadognfilgejbkmkke
- MusicMute: https://chromewebstore.google.com/detail/musicmute/leokbjinoegmfgageoaljhfbmepndbik
- AI Voice Booster: https://chromewebstore.google.com/detail/ai-voice-booster/hjgdcheabocdciemeofgcgmkknaenekb
- tuneOut: https://chromewebstore.google.com/detail/tuneout/hagdjoimpggpplpndobmfemanoolgpoa
- asil-sound-finder: https://github.com/asiltares/asil-sound-finder

## What is not a defensible differentiator by itself

- A volume slider.
- A basic equalizer.
- A speech-only toggle.
- A music-removal toggle.
- Song identification from a tab's unsplit audio.
- Generic presets without a distinctive audio engine.

## Better differentiation

1. **True independent stem mixer:** separately adjust speech and accompaniment, not merely move one blend slider.
2. **Music-stem identification:** identify the isolated soundtrack, even when dialogue is over it.
3. **Timestamped track map:** save multiple songs with the exact video moments where they appear.
4. **Mix memory:** save separate channel/video presets and restore them automatically.
5. **Local-first source separation:** ordinary playback processing remains on device; only user-selected recognition snippets go to the chosen provider.
6. **A/B mix comparison:** compare original and processed audio without losing position.

## Platform constraints

### Chrome tab audio

Chrome's `chrome.tabCapture` API provides a `MediaStream` for the active tab and can only be invoked after an explicit extension action/user invocation. Capturing the tab changes its playback routing: the captured stream must be connected to a new `AudioContext` destination to remain audible. The `tabCapture` permission is sensitive and triggers a permission warning.

Official docs:
- https://developer.chrome.com/docs/extensions/reference/api/tabCapture
- https://developer.chrome.com/docs/extensions/reference/api/offscreen

### Manifest V3 code packaging

Manifest V3 requires extension executable logic to be bundled in the package. Remotely hosted JavaScript or WASM is not allowed by Chrome Web Store policy. Model weights are data, but must be handled with integrity checks, license review, and clear disclosure; do not fetch code or runtimes remotely.

Official docs:
- https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code
- https://developer.chrome.com/docs/webstore/program-policies/policies

### Music recognition

Apple's ShazamKit overview lists Apple platform support and an Android SDK. It should not be presented as a supported general Chrome extension API without further official documentation. A documented recognition provider such as AudD or ACRCloud should be evaluated instead.

Official/vendor references:
- https://developer.apple.com/shazamkit/
- https://docs.audd.io/
- https://www.acrcloud.com/music-recognition/

## Conclusion

The idea is not a new category, but an integrated product can still be differentiated. The technically meaningful moat is the quality and speed of a two-stem speech/music separation engine. The product moat is the combination of independent mix control, isolated-stem recognition, timestamped soundtrack history, and remembered listening preferences.
