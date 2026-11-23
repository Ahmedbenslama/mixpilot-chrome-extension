import { DEFAULT_SESSION, type SessionState } from "./messages";

/**
 * The stored session claims capture is active, but capture lives in the offscreen document.
 * If that document is gone (extension reload, crash, browser restart), the claim is stale.
 */
export function reconcileSession(stored: SessionState, offscreenExists: boolean): SessionState {
  if (stored.active && !offscreenExists) return { ...DEFAULT_SESSION };
  if (stored.active && stored.activeTabId == null) return { ...DEFAULT_SESSION };
  return stored;
}

/** Should a tab event end the capture? */
export function shouldStopForTabEvent(
  session: SessionState,
  tabId: number,
  event: { removed: true } | { newUrl: string; isYouTube: boolean },
): boolean {
  if (!session.active || session.activeTabId !== tabId) return false;
  if ("removed" in event) return true;
  return !event.isYouTube;
}
