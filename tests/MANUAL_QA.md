# Manual QA — MixPilot Starter

## Starter passthrough checks

- [ ] Load unpacked extension from the repository root.
- [ ] Open a standard YouTube watch page and start playback.
- [ ] Click MixPilot and enable capture.
- [ ] Confirm audio remains audible and is not duplicated.
- [ ] Move master volume to 50%, 100%, 150%, 200%, and 0%.
- [ ] Confirm gain changes are smooth and do not cause clicks.
- [ ] Disable MixPilot and confirm playback returns to its ordinary path.
- [ ] Repeat enable/disable at least five times.
- [ ] Close the captured tab and confirm the session is cleaned up.
- [ ] Navigate the captured tab away from YouTube and confirm capture stops.
- [ ] Try a non-YouTube tab and confirm a clear error is shown.
- [ ] Deny capture permission and confirm the extension reports the failure.
- [ ] Reload the extension while capture is active and check that audio can be recovered.

## Future source-separation checks

- [ ] Dialogue with quiet background music.
- [ ] Dialogue with music louder than the voice.
- [ ] Music-only intro/outro.
- [ ] Speech-only section.
- [ ] Singing or vocal music overlapping dialogue.
- [ ] Two people speaking at once.
- [ ] Music with strong bass and percussion.
- [ ] Outdoor background noise and room echo.
- [ ] Long session (at least 30 minutes) to find memory leaks and queue growth.
- [ ] Compare original, speech-only, music-only, and balanced outputs.
- [ ] Measure latency, CPU, memory, and dropped/underrun audio blocks.

## Future recognition checks

- [ ] Identify a clean instrumental section.
- [ ] Identify music while dialogue overlaps it.
- [ ] Handle no-match and network failure.
- [ ] Confirm explicit consent appears before audio is sent.
- [ ] Confirm the timestamp and video URL are saved with the result.
- [ ] Confirm raw audio is not retained after recognition.
- [ ] Confirm deleting one history item and clearing all history work.
