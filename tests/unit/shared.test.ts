import { describe, expect, it } from "vitest";
import { clampGain, gainToDb, gainToPercent, percentToGain } from "../../src/shared/gain";
import { createSerialQueue } from "../../src/shared/serial";
import { reconcileSession, shouldStopForTabEvent } from "../../src/shared/session";
import { isSupportedYouTubeUrl } from "../../src/shared/youtube";

describe("clampGain", () => {
  it("clamps into [0, max]", () => {
    expect(clampGain(-1, 2)).toBe(0);
    expect(clampGain(0.5, 2)).toBe(0.5);
    expect(clampGain(5, 2)).toBe(2);
    expect(clampGain("1.5", 2)).toBe(1.5);
  });
  it("rejects non-finite input instead of coercing it", () => {
    expect(clampGain(NaN, 2)).toBeNull();
    expect(clampGain("abc", 2)).toBeNull();
    expect(clampGain(Infinity, 2)).toBeNull();
    expect(clampGain(undefined, 2)).toBeNull();
  });
  it("converts between percent, gain and dB", () => {
    expect(gainToPercent(1.234)).toBe(123);
    expect(percentToGain(150)).toBe(1.5);
    expect(gainToDb(1)).toBe(0);
    expect(gainToDb(0)).toBe(-Infinity);
    expect(gainToDb(2)).toBeCloseTo(6.02, 2);
  });
});

describe("isSupportedYouTubeUrl", () => {
  it.each([
    ["https://www.youtube.com/watch?v=abc", true],
    ["https://youtube.com/watch?v=abc", true],
    ["https://m.youtube.com/watch?v=abc", true],
    ["https://music.youtube.com/", true],
    ["https://youtube.com.evil.example/watch", false],
    ["https://notyoutube.com/", false],
    ["https://evil.example/?u=youtube.com", false],
    ["chrome://extensions", false],
    ["file:///C:/youtube.com/x.html", false],
    ["", false],
    [undefined, false],
    ["not a url", false],
  ])("%s -> %s", (url, ok) => {
    expect(isSupportedYouTubeUrl(url as string | undefined)).toBe(ok);
  });
});

describe("reconcileSession", () => {
  it("drops a stale active session when the offscreen document is gone (extension reload/restart)", () => {
    expect(reconcileSession({ active: true, activeTabId: 7, bypass: false }, false)).toEqual({ active: false, activeTabId: null, bypass: false });
  });
  it("keeps a live session", () => {
    const s = { active: true, activeTabId: 7, bypass: false };
    expect(reconcileSession(s, true)).toBe(s);
  });
  it("drops an active session with no tab id", () => {
    expect(reconcileSession({ active: true, activeTabId: null, bypass: false }, true).active).toBe(false);
  });
  it("leaves an inactive session alone", () => {
    const s = { active: false, activeTabId: null, bypass: false };
    expect(reconcileSession(s, true)).toBe(s);
  });
});

describe("shouldStopForTabEvent", () => {
  const live = { active: true, activeTabId: 3, bypass: false };
  it("stops when the captured tab closes", () => {
    expect(shouldStopForTabEvent(live, 3, { removed: true })).toBe(true);
  });
  it("ignores other tabs", () => {
    expect(shouldStopForTabEvent(live, 4, { removed: true })).toBe(false);
  });
  it("stops when the captured tab leaves YouTube, not on YouTube SPA navigation", () => {
    expect(shouldStopForTabEvent(live, 3, { newUrl: "https://example.com", isYouTube: false })).toBe(true);
    expect(shouldStopForTabEvent(live, 3, { newUrl: "https://www.youtube.com/watch?v=b", isYouTube: true })).toBe(false);
  });
  it("does nothing when inactive", () => {
    expect(shouldStopForTabEvent({ active: false, activeTabId: null, bypass: false }, 3, { removed: true })).toBe(false);
  });
});

describe("createSerialQueue", () => {
  it("runs tasks one at a time in order", async () => {
    const q = createSerialQueue();
    const log: string[] = [];
    const task = (name: string, ms: number) => () =>
      new Promise<string>((r) => {
        log.push(`start ${name}`);
        setTimeout(() => {
          log.push(`end ${name}`);
          r(name);
        }, ms);
      });
    const results = await Promise.all([q(task("a", 20)), q(task("b", 1)), q(task("c", 5))]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });
  it("continues after a failing task", async () => {
    const q = createSerialQueue();
    const failed = q(() => Promise.reject(new Error("boom")));
    const next = q(async () => "ok");
    await expect(failed).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });
});

import { blockLevelsDb } from "../../src/shared/levels";
describe("blockLevelsDb", () => {
  it("measures a full-scale sine at about -3 dBFS RMS and 0 dBFS peak", () => {
    const n = 4800;
    const x = new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * 1000 * i) / 48000));
    const { rmsDb, peakDb } = blockLevelsDb(x);
    expect(rmsDb).toBeCloseTo(-3.01, 1);
    expect(peakDb).toBeCloseTo(0, 2);
  });
  it("returns -Infinity for silence", () => {
    expect(blockLevelsDb(new Float32Array(128))).toEqual({ rmsDb: -Infinity, peakDb: -Infinity });
  });
});
