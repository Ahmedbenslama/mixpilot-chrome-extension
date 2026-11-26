# Speech/music separator review — 2026-11-26

## User-reported failure

With Speech gain at 0%, speech remains audible. This does **not** mean the Speech gain is leaking: the gain node is exactly zero. The current model only estimates a speech stem; the Music output is `mixture - estimated speech`. Any under-estimated speech is necessarily present in that residual, and the two stems are deliberately kept reconstruction-exact. The shipped benchmark's weakest case is music louder than speech; its residual music stem improves by only about 5.2 dB at −5 dB speech-to-music ratio. Therefore, zeroing the estimate cannot guarantee silence in the residual.

This is an inherent quality limit of the selected enhancement model and its residual-stem design. The current mitigation adds a speech-activity lookahead gate when Speech gain is exactly 0: it ducks the residual Music output around detected dialogue. The extra jitter buffer gives the gate about 86 ms of lookahead while keeping reported processing delay at 149.5 ms. This can also duck the background soundtrack during dialogue, and quiet/missed speech may still leak. It is not a model improvement or a guarantee of zero speech.

No speech/music model can honestly promise mathematically zero speech leakage across arbitrary YouTube audio without representative testing. If an absolute guarantee is mandatory, the only safe behavior with the current outputs is to mute the Music path too, which also mutes the music.

## Candidates reviewed

| Candidate | Relevant evidence | Fit and concerns |
|---|---|---|
| **DeepFilterNet3 streaming (current)** — [upstream](https://github.com/Rikorose/DeepFilterNet) | The project benchmark tested it on 28 known speech+music mixtures and in Chrome. Mean SI-SDR improvement: 7.7 dB Speech / 9.9 dB residual Music; the earlier 70 ms engine configuration was measured in Chrome. The current 149.5 ms setting/gate has unit coverage but not a new Chrome measurement. | Best available **measured** choice for this browser's low-latency budget, but trained for speech enhancement, not dialogue/music separation. Leakage is expected. |
| **GTCRN streaming** — [official model](https://github.com/Xiaobin-Rong/gtcrn), [browser WASM build](https://github.com/sapphi-red/gtcrn-wasm) | Already tested in the repository on the same synthetic mixtures: 5.2 / 6.4 dB mean SI-SDR improvement; 16 kHz model, lower compute. | Also speech enhancement, and the measured speech/music quality was worse than DFN3. Not a responsible replacement for this complaint. |
| **UL-UNAS streaming ONNX** — [official repo](https://github.com/Xiaobin-Rong/ul-unas) | Newly available small streaming ONNX model, MIT-licensed, with released DNS3-trained weights. It runs at 16 kHz and uses frame/cache state. | Worth a future benchmark, but its documented task/training is speech enhancement, not speech-vs-music separation. No speech/music mixture results are available in this repo, so there is no evidence it reduces music-residual voice leakage. Switching requires a new resampler/STFT/iSTFT path and latency/stability validation. |
| **H-GTCRN** — [official repo](https://github.com/Max1Wz/H-GTCRN) | Focuses on low-SNR speech enhancement and has released checkpoints. | Its IVA/masking pipeline is not a drop-in streaming ONNX system for our mono 70 ms path; no comparable browser measurement or speech/music benchmark is available here. |
| **MossFormer2 speech separation / Spleeter / Demucs** — [ClearerVoice-Studio](https://github.com/modelscope/ClearerVoice-Studio), [Spleeter](https://github.com/deezer/spleeter) | Speech separation generally means splitting concurrent speakers; music models target sung vocals. The project's previous Spleeter test used ~11.9 s windows. | Wrong target or unacceptable lookahead for synchronized YouTube playback. A user could hear severe audio/video desync. |

## Exploratory UL-UNAS smoke test

A local, non-release experiment used the two 10-second clean speech examples published in UL-UNAS's repo (0119 and 0174), mixed with a generated six-sine chord/pulsed-tone signal at +5, 0 and −5 dB speech-to-background ratios. We ran both the official streaming UL-UNAS ONNX and shipped DFN3 ONNX in Python ONNX Runtime, then compared SI-SDR improvement after aligning each model's output. This is **synthetic tonal background, not real music**, only two speech clips, not Chrome, and not a human listening test. Treat the figures as a smoke test of integration/behavior only:

| Model | Mean Speech SI-SDRi | Mean residual SI-SDRi | Measured CPU RTF in this Python run |
|---|---:|---:|---:|
| UL-UNAS | 6.65 dB | 6.69 dB | 0.09 |
| DFN3 | 3.70 dB | 3.77 dB | 0.30 |

The candidate is promising enough to benchmark properly, but these synthetic tones do not establish that it removes dialogue better under real music. Its 16 kHz STFT/cache pipeline would also require a new 48→16 kHz streaming resampler, STFT/iSTFT overlap-add, 16→48 kHz output path, and full Chrome latency/overload validation. The timing above excludes model load, browser scheduling and the extension audio graph.

## Decision

**No production model was swapped in this change.** The smoke test makes UL-UNAS a priority candidate, not a validated replacement. GTCRN remains objectively worse on the project's original real-music benchmark; H-GTCRN and the speaker/music models are not drop-in live replacements. Because the symptom is speech leakage in the residual, choosing by denoising quality or small-model speed alone is insufficient. Shipping a new audio path based on two artificial-tone examples would risk introducing worse artifacts and lip-sync errors.

Next, benchmark UL-UNAS on the same licensed real speech-over-music set (including music louder than speech), conduct listening tests on the residual with headphones, then implement it behind tests and measure its end-to-end latency/CPU in Chrome. A replacement should reduce residual speech leakage **and** keep lip sync acceptable. No current test proves that any available live model guarantees absolutely inaudible speech while music remains; the present engine cannot promise that. If that is mandatory, we need a purpose-trained dialogue/music separator and must validate it on real clips before claiming success.
