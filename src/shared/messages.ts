/** Message protocol between popup, service worker and offscreen document. */

/** Lives in chrome.storage.session: cleared on browser restart, never outlives the capture it describes. */
export interface SessionState {
  active: boolean;
  activeTabId: number | null;
}

/** Lives in chrome.storage.local: user preferences that should persist. */
export interface Preferences {
  masterGain: number;
}

export interface PublicState extends SessionState, Preferences {}

export const DEFAULT_SESSION: SessionState = { active: false, activeTabId: null };
export const DEFAULT_PREFERENCES: Preferences = { masterGain: 1 };

// popup -> service worker
export type PopupRequest =
  | { type: "GET_STATE" }
  | { type: "START_CAPTURE" }
  | { type: "STOP_CAPTURE" }
  | { type: "SET_MASTER_GAIN"; value: number }
  | { type: "GET_ENGINE_STATS" };

/** Live engine diagnostics; levels are measured on the final output. */
export interface EngineStats {
  contextState: AudioContextState;
  sampleRate: number;
  baseLatencyMs: number;
  outputLatencyMs: number;
  /** Captured tab audio before any processing. */
  inputRmsDb: number;
  outputRmsDb: number;
  outputPeakDb: number;
}

export type Response<T = PublicState> =
  | { ok: true; state: T; message?: string }
  | { ok: false; error: string; state?: T };

// service worker -> offscreen
export type OffscreenRequest =
  | { target: "offscreen"; type: "OFFSCREEN_START_CAPTURE"; streamId: string; masterGain: number }
  | { target: "offscreen"; type: "OFFSCREEN_STOP_CAPTURE" }
  | { target: "offscreen"; type: "OFFSCREEN_SET_MASTER_GAIN"; value: number }
  | { target: "offscreen"; type: "OFFSCREEN_GET_STATS" };

// offscreen -> service worker (unsolicited events)
export type OffscreenEvent = { target: "background"; type: "CAPTURE_ENDED"; reason: string };

export type OffscreenResponse = { ok: true; stats?: EngineStats } | { ok: false; error: string };
