/**
 * Service worker: event routing, tab validation, session lifecycle. No audio processing here.
 * Capture lives in the offscreen document, which this worker creates on demand and closes on stop.
 */
import { clampGain, MASTER_GAIN_MAX } from "../shared/gain";
import {
  type EngineStats,
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

// ---------------------------------------------------------------- lifecycle

async function startCapture(): Promise<Response> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
    // Valid because the popup (an explicit user action on the extension) initiated this request.
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
  } catch (e) {
    await closeOffscreen();
    return { ok: false, error: `Chrome did not allow tab audio capture (${errorText(e).replace(/\.$/, "")}). Playback is unchanged.` };
  }

  try {
    await ensureOffscreen();
    const res = await toOffscreen({ type: "OFFSCREEN_START_CAPTURE", streamId, masterGain: prefs.masterGain });
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

  await chrome.storage.session.set({ active: true, activeTabId: tab.id } satisfies SessionState);
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

async function setMasterGain(value: unknown): Promise<Response> {
  const gain = clampGain(value, MASTER_GAIN_MAX);
  if (gain === null) return { ok: false, error: "Master volume must be a number." };
  await chrome.storage.local.set({ masterGain: gain } satisfies Partial<Preferences>);
  const session = await getSession();
  if (session.active) {
    const res = await toOffscreen({ type: "OFFSCREEN_SET_MASTER_GAIN", value: gain });
    if (!res?.ok) return { ok: false, error: res.error, state: await getPublicState() };
  }
  return { ok: true, state: await getPublicState() };
}

async function getEngineStats(): Promise<Response<EngineStats | null>> {
  if (!(await getSession()).active) return { ok: true, state: null };
  const res = await toOffscreen({ type: "OFFSCREEN_GET_STATS" });
  return res.ok ? { ok: true, state: res.stats ?? null } : { ok: false, error: res.error };
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------- events (registered synchronously at top level)

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
      work = serial(startCapture);
      break;
    case "STOP_CAPTURE":
      work = serial(stopCapture);
      break;
    case "GET_ENGINE_STATS":
      work = getEngineStats();
      break;
    case "SET_MASTER_GAIN":
      work = setMasterGain((msg as Extract<PopupRequest, { type: "SET_MASTER_GAIN" }>).value);
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
