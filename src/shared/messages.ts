/** Message protocol between popup, service worker and offscreen document. */
import type { EngineSnapshot } from "../engine/engine";
import type { LatencyPreset } from "../engine/protocol";

export type { EngineSnapshot };

/** Lives in chrome.storage.session: cleared on browser restart, never outlives the capture it describes. */
export interface SessionState {
  active: boolean;
  activeTabId: number | null;
  /** A/B: listening to the original instead of the mix. Not persisted across sessions. */
  bypass: boolean;
}

/** Lives in chrome.storage.local: user preferences that should persist. */
export interface Preferences {
  speechGain: number;
  musicGain: number;
  masterGain: number;
  latency: LatencyPreset;
}

export interface PublicState extends SessionState, Preferences {}

export interface RecognitionResult {
  title: string;
  artist: string;
  album?: string;
  releaseDate?: string;
  songUrl?: string;
  provider: "AudD";
}
export interface RecognitionHistoryEntry extends RecognitionResult {
  id: string;
  videoUrl: string;
  timestamp: number;
  createdAt: number;
}

export const DEFAULT_SESSION: SessionState = { active: false, activeTabId: null, bypass: false };
export const DEFAULT_PREFERENCES: Preferences = { speechGain: 1, musicGain: 1, masterGain: 1, latency: "balanced" };

export interface MixUpdate {
  speechGain?: number;
  musicGain?: number;
  masterGain?: number;
}

// popup -> service worker
export type PopupRequest =
  | { type: "GET_STATE" }
  | { type: "START_CAPTURE" }
  | { type: "STOP_CAPTURE" }
  | { type: "SET_MIX"; mix: MixUpdate }
  | { type: "SET_RUNTIME_MIX"; mix: MixUpdate }
  | { type: "SET_BYPASS"; on: boolean }
  | { type: "GET_ENGINE_STATS" }
  | { type: "IDENTIFY_MUSIC"; videoUrl: string; timestamp: number }
  | { type: "GET_RECOGNITION_HISTORY" }
  | { type: "DELETE_RECOGNITION_HISTORY"; id?: string };

export type Response<T = PublicState> =
  | { ok: true; state: T; message?: string }
  | { ok: false; error: string; state?: T };

// service worker -> offscreen
export type OffscreenRequest =
  | { target: "offscreen"; type: "OFFSCREEN_START_CAPTURE"; streamId: string; prefs: Preferences; bypass: boolean }
  | { target: "offscreen"; type: "OFFSCREEN_STOP_CAPTURE" }
  | { target: "offscreen"; type: "OFFSCREEN_SET_MIX"; mix: MixUpdate }
  | { target: "offscreen"; type: "OFFSCREEN_SET_BYPASS"; on: boolean }
  | { target: "offscreen"; type: "OFFSCREEN_GET_STATS" }
  | { target: "offscreen"; type: "OFFSCREEN_IDENTIFY_MUSIC"; token: string };

// offscreen -> service worker (unsolicited events)
export type OffscreenEvent = { target: "background"; type: "CAPTURE_ENDED"; reason: string };

export type OffscreenResponse = { ok: true; stats?: EngineSnapshot; result?: RecognitionResult } | { ok: false; error: string };
