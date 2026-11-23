const OFFSCREEN_DOCUMENT = "offscreen.html";
const DEFAULT_STATE = {
  active: false,
  activeTabId: null,
  masterGain: 1
};

async function getState() {
  const stored = await chrome.storage.local.get(DEFAULT_STATE);
  return { ...DEFAULT_STATE, ...stored };
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ["OFFSCREEN_DOCUMENT"],
    documentUrls: [offscreenUrl]
  });

  if (contexts.length > 0) return;

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_DOCUMENT,
    reasons: ["USER_MEDIA"],
    justification: "Route the user-authorized YouTube tab audio through a local Web Audio pipeline so the user can control playback volume."
  });
}

function isSupportedYouTubeUrl(urlString) {
  try {
    const hostname = new URL(urlString).hostname;
    return hostname === "youtube.com" ||
      hostname.endsWith(".youtube.com");
  } catch {
    return false;
  }
}

async function startCapture() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id || !tab.url || !isSupportedYouTubeUrl(tab.url)) {
    throw new Error("Open a YouTube video before enabling MixPilot.");
  }

  const state = await getState();
  if (state.active && state.activeTabId === tab.id) {
    return { ok: true, state, message: "MixPilot is already active on this tab." };
  }

  if (state.active) {
    await stopCapture();
  }

  await ensureOffscreenDocument();

  // tabCapture must be initiated from an explicit extension user action.
  const streamId = await chrome.tabCapture.getMediaStreamId({
    targetTabId: tab.id
  });

  const offscreenResult = await chrome.runtime.sendMessage({
    type: "OFFSCREEN_START_CAPTURE",
    streamId,
    masterGain: state.masterGain
  });

  if (!offscreenResult?.ok) {
    throw new Error(offscreenResult?.error || "Could not start the audio pipeline.");
  }

  const nextState = {
    active: true,
    activeTabId: tab.id,
    masterGain: state.masterGain
  };
  await chrome.storage.local.set(nextState);

  return { ok: true, state: nextState, message: "Audio controls are active." };
}

async function stopCapture() {
  try {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_DOCUMENT)]
    });

    if (contexts.length > 0) {
      await chrome.runtime.sendMessage({ type: "OFFSCREEN_STOP_CAPTURE" });
    }
  } finally {
    const state = await getState();
    await chrome.storage.local.set({
      active: false,
      activeTabId: null,
      masterGain: state.masterGain
    });
  }

  return { ok: true, state: await getState() };
}

async function setMasterGain(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    throw new Error("Master volume must be a valid number.");
  }

  const gain = Math.min(2, Math.max(0, numericValue));
  const state = await getState();
  await chrome.storage.local.set({ masterGain: gain });

  if (state.active) {
    await chrome.runtime.sendMessage({
      type: "OFFSCREEN_SET_MASTER_GAIN",
      value: gain
    });
  }

  return { ok: true, state: { ...state, masterGain: gain } };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "START_CAPTURE") {
    startCapture()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "STOP_CAPTURE") {
    stopCapture()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "SET_MASTER_GAIN") {
    setMasterGain(message.value)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "GET_STATE") {
    getState()
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const state = await getState();
  if (state.active && state.activeTabId === tabId) {
    await stopCapture();
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (!changeInfo.url) return;
  const state = await getState();
  if (state.active && state.activeTabId === tabId && !isSupportedYouTubeUrl(changeInfo.url)) {
    await stopCapture();
  }
});
