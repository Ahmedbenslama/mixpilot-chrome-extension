# MixPilot — Technical Architecture

## 1. Chrome extension foundation

Use Chrome Extensions Manifest V3. The starter uses:

- `background.js`: short-lived service worker for tab selection, user-initiated capture setup, and lifecycle events.
- `offscreen.html` / `offscreen.js`: hidden extension document hosting `getUserMedia`, `AudioContext`, and long-running audio processing.
- `popup.html` / `popup.js` / `popup.css`: compact controls.
- `chrome.tabCapture`: access the current tab's audio only after explicit user invocation.
- `chrome.storage.local`: persistent settings and lightweight metadata.

Chrome's `tabCapture` API captures the active tab's audio stream. Once captured, the original tab audio is no longer played directly, so the extension must create a media-stream source and route it to an `AudioContext` destination to preserve audible playback. The API requires a user gesture such as invoking the extension action. See the official Chrome documentation linked in `COMPETITOR_RESEARCH.md`.

## 2. Audio graph

### Starter passthrough graph

```text
YouTube tab audio
      |
      v
MediaStreamAudioSourceNode
      |
      v
Master GainNode
      |
      v
DynamicsCompressorNode (basic peak protection)
      |
      v
AudioContext.destination
```

### Target separated-stem graph

```text
Captured tab audio
      |
      v
Input conditioning / resampling / chunk buffer
      |
      v
Source separation inference (ONNX Runtime Web or another bundled runtime)
      |
      +-------------------------------+
      |                               |
      v                               v
Speech stem                     Music stem
      |                               |
Speech GainNode                Music GainNode
      |                               |
      +---------------+---------------+
                      |
                      v
              Stem sum / master gain
                      |
                      v
             Peak limiter / output
                      |
                      v
           AudioContext.destination
```

The model must genuinely output separate stems. An EQ filter, voice-frequency boost, voice activity detector, or compressor is not a substitute for source separation.

## 3. Model/inference requirements

Claude Code must research and evaluate candidate models rather than selecting one based only on benchmark claims. Evaluate:

- Whether the model separates speech/vocals from accompaniment/music, not only vocals from a full song.
- Model size and redistribution license.
- Browser compatibility and ONNX export availability.
- Quantization support and quality loss.
- Latency, real-time factor, memory use, and CPU/GPU usage on representative Windows laptops.
- Streaming/chunked inference and overlap-add requirements.
- Whether a lower-quality CPU fallback is viable.

A reasonable starting approach is a compact, quantized ONNX source-separation model executed locally with ONNX Runtime Web. Package the inference runtime's JavaScript/WASM files with the extension. If model weights are downloaded on demand, treat them strictly as model data (not executable JS/WASM), verify integrity, document their source and license, and make clear that the first download is required. Prefer a model bundled with the extension if practical and permitted.

Do not assume a desktop/server Demucs checkpoint will be fast enough for browser real-time use. Benchmark before committing to it.

## 4. Streaming and latency

Real-time separation is the highest technical risk. The implementation should:

1. Capture audio into bounded chunks.
2. Resample to the model's required rate without blocking the UI thread.
3. Use chunk overlap and a suitable window to avoid clicks at chunk boundaries.
4. Preserve strict ordering and timestamps.
5. Maintain a bounded queue; if inference falls behind, apply an explicit fallback rather than allowing unbounded latency.
6. Run heavy inference off the main UI thread, preferably in a dedicated worker or AudioWorklet-compatible architecture.
7. Use `AudioWorklet` for deterministic low-latency audio scheduling where the model integration permits it.
8. Keep speech and music stems sample-aligned.
9. Ensure stop/restart/navigation releases all media tracks, workers, buffers, and audio nodes.
10. Provide a low-CPU mode or disable separation gracefully on unsupported machines.

Do not run long inference tasks in the Manifest V3 service worker. Chrome service workers are event-driven and can be terminated after inactivity. The offscreen document is the appropriate DOM/Web Audio context; a worker/worklet can handle the heavy model computation.

## 5. Audio capture lifecycle

1. Popup click initiates `START_CAPTURE`.
2. Service worker validates the active tab is YouTube.
3. Service worker creates the offscreen document if missing.
4. Service worker calls `chrome.tabCapture.getMediaStreamId({ targetTabId })` in response to the user action.
5. Stream ID is sent to the offscreen document and consumed immediately by `getUserMedia`.
6. Offscreen document builds the processing graph and acknowledges success.
7. Service worker persists only lightweight session state (active tab ID and gains).
8. On stop, close the graph and stop all tracks.
9. On tab close or navigation away from YouTube, stop the graph.
10. On any error, attempt to stop partial capture and clearly report whether normal playback is restored.

Test this lifecycle across reloads, SPA navigation, tab switching, popup closure, browser restart, and extension reload.

## 6. YouTube UI integration

Start with the extension popup. A YouTube in-player overlay is a later enhancement and should be implemented only after the audio engine is stable.

If added:
- Use a narrow content script limited to YouTube host pages.
- Observe YouTube's SPA route/player changes safely.
- Avoid brittle selectors where possible and keep DOM interactions isolated from the audio engine.
- Do not modify, download, or extract the YouTube media stream directly; rely on the supported tab audio capture path.
- Keep controls accessible and avoid interfering with the native player.

## 7. Music recognition architecture

Use a provider adapter interface, for example:

```ts
interface MusicRecognitionProvider {
  identify(input: {
    audio: Blob;
    mimeType: string;
    timestampSeconds: number;
    videoUrl: string;
  }): Promise<RecognitionResult>;
}
```

`RecognitionResult` should normalize provider responses into:
- `trackTitle`
- `artistName`
- optional `albumTitle`
- optional `artworkUrl`
- optional `releaseDate`
- optional `confidence`
- `provider`
- optional outbound links

Important decisions:
- Do not build around an undocumented/unofficial Shazam endpoint. It can break without notice and may have unclear terms.
- Apple's ShazamKit official overview lists support for Apple platforms and Android, not a general Chrome extension SDK/API. Verify current vendor documentation before claiming ShazamKit support.
- Evaluate a documented provider such as AudD or ACRCloud. Check pricing, allowed usage, request limits, data handling, and supported audio formats.
- Never ship a private recognition API secret in extension JavaScript. Use a small backend proxy with secret storage and rate limiting, or a clear user-managed key flow if provider terms allow it.
- Send audio only after the user clicks Identify and sees a clear disclosure. Send the isolated music stem if possible. Never continuously upload live tab audio.
- Audio recognition is optional; it must not block or interrupt playback.

## 8. Data model

Suggested local settings:

```ts
interface MixProfile {
  id: string;
  scope: "global" | "channel" | "video";
  scopeKey: string;
  speechGain: number;
  musicGain: number;
  masterGain: number;
  presetId: string;
  updatedAt: number;
}
```

Suggested recognition history:

```ts
interface RecognizedTrack {
  id: string;
  videoUrl: string;
  videoTitle?: string;
  timestampSeconds: number;
  trackTitle: string;
  artistName: string;
  albumTitle?: string;
  artworkUrl?: string;
  provider: string;
  recognizedAt: number;
  outboundLinks?: Record<string, string>;
}
```

Store in `chrome.storage.local` for small data. Use IndexedDB for larger model cache or history if needed. Never store raw tab audio by default.

## 9. Permissions and privacy

Request only necessary permissions. The current starter declares `activeTab`, `tabCapture`, `offscreen`, and `storage`. Avoid broad `<all_urls>` host permissions. Keep YouTube support narrow.

- Explain why tab capture is required before first use.
- Start capture only after an explicit user action.
- Do not request microphone access.
- Keep separation on-device.
- Disclose the recognition provider and exact excerpt transfer before sending.
- Do not include analytics by default.
- Provide clear history/settings deletion.
- Avoid remote executable JavaScript/WASM because Manifest V3 Chrome Web Store policy disallows remotely hosted code. Bundle all executable logic and inference runtimes.

## 10. Testing strategy

Automated tests should cover:
- Gain clamping and conversion.
- Message protocol and state transitions.
- Profile precedence and storage migration.
- Recognition response normalization.
- Chunk ordering, buffer bounds, and error fallback where feasible.

Manual audio test set should include:
- Speaker with low-volume music.
- Speaker with loud music.
- Music-only opening/transition.
- Speech-only section.
- Singing/vocal music overlapping speech.
- Multiple speakers and accents.
- Outdoor noise and room echo.
- Quiet audio followed by loud effects.
- Live stream / high bitrate / variable sample rate.

Record latency, CPU, memory, audio glitches, and subjective speech/music quality on a low-tier and mid-tier Windows machine. Never claim real-time support until measured.
