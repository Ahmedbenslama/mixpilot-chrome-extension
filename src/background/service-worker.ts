/**
 * Service worker: event routing, tab validation, session lifecycle. No audio processing here.
 * Capture lives in the offscreen document, which this worker creates on demand and closes on stop.
 */
import { clampGain, MASTER_GAIN_MAX, STEM_GAIN_MAX } from "../shared/gain";
import {
  type EngineSnapshot,
  type MixUpdate,
  DEFAULT_PREFERENCES,
  DEFAULT_SESSION,
  type OffscreenEvent,
  type OffscreenRequest,
  type OffscreenResponse,
  type PopupRequest,
  type Preferences,
  type PublicState,
  type Response,
  type SessionState,
} from "../shared/messages";
import { createSerialQueue } from "../shared/serial";
import { reconcileSession, shouldStopForTabEvent } from "../shared/session";
import { isSupportedYouTubeUrl } from "../shared/youtube";

const OFFSCREEN_PATH = "offscreen.html";
const YOUTUBE_TAB_PATTERN = "https://*.youtube.com/*";
const serial = createSerialQueue();

// ---------------------------------------------------------------- storage

async function getSession(): Promise<SessionState> {
  const s = (await chrome.storage.session.get(DEFAULT_SESSION)) as SessionState;
  const reconciled = reconcileSession(s, await offscreenExists());
  if (reconciled !== s) await chrome.storage.session.set(reconciled);
  return reconciled;
}

async function getPreferences(): Promise<Preferences> {
  return { ...DEFAULT_PREFERENCES, ...((await chrome.storage.local.get(DEFAULT_PREFERENCES)) as Preferences) };
}

async function getPublicState(): Promise<PublicState> {
  const [session, prefs] = await Promise.all([getSession(), getPreferences()]);
  return { ...session, ...prefs };
}

// ---------------------------------------------------------------- offscreen document

async function offscreenExists(): Promise<boolean> {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function ensureOffscreen(): Promise<void> {
  if (await offscreenExists()) return;
  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: "Process the user-authorized YouTube tab audio locally and play it back with the user's mix settings.",
  });
}

async function closeOffscreen(): Promise<void> {
  if (await offscreenExists()) {
    try {
      await chrome.offscreen.closeDocument();
    } catch {
      /* already closing */
    }
  }
}

type WithoutTarget<T> = T extends unknown ? Omit<T, "target"> : never;

function toOffscreen(msg: WithoutTarget<OffscreenRequest>): Promise<OffscreenResponse> {
  return chrome.runtime.sendMessage({ target: "offscreen", ...msg } as OffscreenRequest);
}

// ---------------------------------------------------------------- UI sync (page sliders + toolbar badge)

/** Push the current state to every YouTube tab (the sliders under the player) and mirror it on the toolbar badge. */
async function broadcastState(): Promise<void> {
  const state = await getPublicState();
  chrome.action.setBadgeText({ text: state.active ? "ON" : "" }).catch(() => undefined);
  const tabs = await chrome.tabs.query({ url: YOUTUBE_TAB_PATTERN });
  for (const t of tabs) {
    if (t.id != null) chrome.tabs.sendMessage(t.id, { type: "MIXPILOT_STATE", state }).catch(() => undefined);
  }
}

function notifyTab(tabId: number | undefined, text: string): void {
  if (tabId == null) return;
  chrome.tabs.sendMessage(tabId, { type: "MIXPILOT_NOTICE", text }).catch(() => undefined);
}

// ---------------------------------------------------------------- lifecycle

/** `clicked` is the tab whose toolbar icon was clicked; without it, the active tab of the current window is used. */
async function startCapture(clicked?: chrome.tabs.Tab): Promise<Response> {
  const tab = clicked ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (!tab?.id || !isSupportedYouTubeUrl(tab.url)) {
    return { ok: false, error: "Open a YouTube video in this tab, then enable MixPilot.", state: await getPublicState() };
  }

  const session = await getSession();
  if (session.active && session.activeTabId === tab.id) {
    return { ok: true, state: await getPublicState(), message: "MixPilot is already active on this tab." };
  }
  if (session.active) await stopCaptureInternal();

  const prefs = await getPreferences();
  let streamId: string;
  try {
    // Valid because the user explicitly invoked the extension on this tab (toolbar click) and so granted activeTab.
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  } catch (e) {
    await closeOffscreen();
    return { ok: false, error: `Chrome did not allow tab audio capture (${errorText(e).replace(/\.$/, "")}). Playback is unchanged.` };
  }

  try {
    await ensureOffscreen();
    const res = await toOffscreen({ type: "OFFSCREEN_START_CAPTURE", streamId, prefs, bypass: false });
    if (!res?.ok) throw new Error(res?.error || "The audio engine did not start.");
  } catch (e) {
    // The offscreen side already stops its tracks on failure; closing the document guarantees it.
    // Once the capture stream is stopped, Chrome returns the tab to its normal audio output.
    await stopCaptureInternal();
    return {
      ok: false,
      error: `Could not start audio processing (${errorText(e).replace(/\.$/, "")}). Capture was stopped, so normal playback should resume. If the tab stays silent, reload it.`,
      state: await getPublicState(),
    };
  }

  await chrome.storage.session.set({ active: true, activeTabId: tab.id, bypass: false } satisfies SessionState);
  return { ok: true, state: await getPublicState(), message: "MixPilot is processing this tab's audio." };
}

async function stopCaptureInternal(): Promise<void> {
  try {
    if (await offscreenExists()) await toOffscreen({ type: "OFFSCREEN_STOP_CAPTURE" });
  } catch {
    /* document may already be gone; closing below stops any remaining tracks */
  } finally {
    await closeOffscreen();
    await chrome.storage.session.set(DEFAULT_SESSION);
  }
}

async function stopCapture(): Promise<Response> {
  await stopCaptureInternal();
  return { ok: true, state: await getPublicState(), message: "MixPilot is off. Original audio restored." };
}

async function setMix(mix: MixUpdate | undefined): Promise<Response> {
  if (!mix || typeof mix !== "object") return { ok: false, error: "Invalid mix update." };
  const next: Partial<Preferences> = {};
  const fields: [keyof MixUpdate, number][] = [["speechGain", STEM_GAIN_MAX], ["musicGain", STEM_GAIN_MAX], ["masterGain", MASTER_GAIN_MAX]];
  for (const [key, max] of fields) {
    if (mix[key] === undefined) continue;
    const v = clampGain(mix[key], max);
    if (v === null) return { ok: false, error: "Volume values must be numbers." };
    next[key] = v;
  }
  await chrome.storage.local.set(next);
  if ((await getSession()).active) {
    const res = await toOffscreen({ type: "OFFSCREEN_SET_MIX", mix: next });
    if (!res?.ok) return { ok: false, error: res.error, state: await getPublicState() };
  }
  return { ok: true, state: await getPublicState() };
}

async function setBypass(on: boolean): Promise<Response> {
  const session = await getSession();
  if (!session.active) return { ok: false, error: "MixPilot is not active.", state: await getPublicState() };
  const res = await toOffscreen({ type: "OFFSCREEN_SET_BYPASS", on: Boolean(on) });
  if (!res?.ok) return { ok: false, error: res.error, state: await getPublicState() };
  await chrome.storage.session.set({ bypass: Boolean(on) } satisfies Partial<SessionState>);
  return { ok: true, state: await getPublicState() };
}

async function getEngineStats(): Promise<Response<EngineSnapshot | null>> {
  if (!(await getSession()).active) return { ok: true, state: null };
  const res = await toOffscreen({ type: "OFFSCREEN_GET_STATS" });
  return res.ok ? { ok: true, state: res.stats ?? null } : { ok: false, error: res.error };
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------- events (registered synchronously at top level)

// With no popup, clicking the toolbar icon toggles processing on the current tab. This click is also what
// grants Chrome's activeTab permission, which tab capture requires. The grant lasts for the tab's lifetime
// on the page, so it keeps working across YouTube's in-page video navigation.
chrome.action.onClicked.addListener((tab) => {
  serial(async () => {
    const session = await getSession();
    const res = session.active && session.activeTabId === tab.id ? await stopCapture() : await startCapture(tab);
    if (!res.ok) {
      notifyTab(tab.id, res.error);
      chrome.action.setBadgeText({ text: "!" }).catch(() => undefined);
      setTimeout(() => void broadcastState().catch(() => undefined), 3000);
    }
  }).catch(() => undefined);
});

// Any state change (capture started/stopped, slider values) is mirrored to the sliders on YouTube tabs.
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === "session" || area === "local") broadcastState().catch(() => undefined);
});

chrome.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  const msg = raw as PopupRequest | OffscreenEvent | OffscreenRequest;
  if ("target" in msg && msg.target === "offscreen") return false; // not for us

  if ("target" in msg && msg.target === "background" && msg.type === "CAPTURE_ENDED") {
    serial(stopCaptureInternal).catch(() => undefined);
    return false;
  }

  let work: Promise<Response<unknown>>;
  switch ((msg as PopupRequest).type) {
    case "GET_STATE":
      work = getPublicState().then((state) => ({ ok: true, state }));
      break;
    case "START_CAPTURE":
      work = serial(() => startCapture());
      break;
    case "STOP_CAPTURE":
      work = serial(stopCapture);
      break;
    case "GET_ENGINE_STATS":
      work = getEngineStats();
      break;
    case "SET_MIX":
      work = setMix((msg as Extract<PopupRequest, { type: "SET_MIX" }>).mix);
      break;
    case "SET_BYPASS":
      work = setBypass((msg as Extract<PopupRequest, { type: "SET_BYPASS" }>).on);
      break;
    default:
      return false;
  }
  work.then(sendResponse, (e) => sendResponse({ ok: false, error: errorText(e) } satisfies Response));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  serial(async () => {
    if (shouldStopForTabEvent(await getSession(), tabId, { removed: true })) await stopCaptureInternal();
  }).catch(() => undefined);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url && changeInfo.status !== "loading") return;
  serial(async () => {
    const session = await getSession();
    if (!session.active || session.activeTabId !== tabId) return;
    // With host permission limited to youtube.com, tab.url is only readable while the tab is on YouTube.
    // An unreadable URL therefore means the tab left YouTube.
    const url = changeInfo.url ?? tab.url;
    if (shouldStopForTabEvent(session, tabId, { newUrl: url ?? "", isYouTube: isSupportedYouTubeUrl(url) })) {
      await stopCaptureInternal();
    }
  }).catch(() => undefined);
});

// A fresh service worker after an extension update/reload: no capture can be alive.
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.session.set(DEFAULT_SESSION).catch(() => undefined);
});
chrome.runtime.onStartup.addListener(() => {
  chrome.storage.session.set(DEFAULT_SESSION).catch(() => undefined);
});
