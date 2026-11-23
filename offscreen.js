let mediaStream = null;
let audioContext = null;
let sourceNode = null;
let masterGainNode = null;
let limiterNode = null;

async function startCapture(streamId, initialGain = 1) {
  await stopCapture();

  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: "tab",
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  audioContext = new AudioContext({ latencyHint: "interactive" });
  sourceNode = audioContext.createMediaStreamSource(mediaStream);
  masterGainNode = audioContext.createGain();
  limiterNode = audioContext.createDynamicsCompressor();

  masterGainNode.gain.value = Math.min(2, Math.max(0, Number(initialGain) || 0));
  limiterNode.threshold.value = -2;
  limiterNode.knee.value = 0;
  limiterNode.ratio.value = 20;
  limiterNode.attack.value = 0.003;
  limiterNode.release.value = 0.12;

  // Captured tab audio is routed back to the user's speakers through this graph.
  sourceNode.connect(masterGainNode);
  masterGainNode.connect(limiterNode);
  limiterNode.connect(audioContext.destination);
  await audioContext.resume();

  return { ok: true };
}

async function stopCapture() {
  try { sourceNode?.disconnect(); } catch { /* already disconnected */ }
  try { masterGainNode?.disconnect(); } catch { /* already disconnected */ }
  try { limiterNode?.disconnect(); } catch { /* already disconnected */ }

  if (mediaStream) {
    for (const track of mediaStream.getTracks()) track.stop();
  }

  if (audioContext && audioContext.state !== "closed") {
    await audioContext.close();
  }

  mediaStream = null;
  audioContext = null;
  sourceNode = null;
  masterGainNode = null;
  limiterNode = null;

  return { ok: true };
}

function setMasterGain(value) {
  if (!masterGainNode || !audioContext) {
    return { ok: false, error: "Audio is not active." };
  }

  const gain = Math.min(2, Math.max(0, Number(value)));
  if (!Number.isFinite(gain)) {
    return { ok: false, error: "Invalid volume value." };
  }

  masterGainNode.gain.setTargetAtTime(gain, audioContext.currentTime, 0.025);
  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "OFFSCREEN_START_CAPTURE") {
    startCapture(message.streamId, message.masterGain)
      .then(sendResponse)
      .catch(async (error) => {
        await stopCapture();
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message?.type === "OFFSCREEN_STOP_CAPTURE") {
    stopCapture()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "OFFSCREEN_SET_MASTER_GAIN") {
    sendResponse(setMasterGain(message.value));
    return false;
  }
});
