import { describe, expect, it } from "vitest";
import { channelProfileKey, resolveProfile, videoProfileKey, type ProfileMap } from "../../src/shared/profiles";

describe("profile precedence and YouTube keys", () => {
  it("builds stable video and channel keys", () => {
    expect(videoProfileKey("https://www.youtube.com/watch?v=abc123&t=9" )).toBe("video:abc123");
    expect(channelProfileKey("/@mixpilot" )).toBe("channel:/@mixpilot");
    expect(videoProfileKey("https://example.com/watch?v=abc")).toBeNull();
    expect(channelProfileKey("https://example.com/@mixpilot")).toBeNull();
  });
  it("prefers video, then channel, then global profile", () => {
    const profiles: ProfileMap = {
      global: { speechGain: 1, musicGain: 1, masterGain: 1 },
      "channel:/@mixpilot": { speechGain: 1.3, musicGain: 0.7, masterGain: 1 },
      "video:abc": { speechGain: 1.6, musicGain: 0.4, masterGain: 1.1 },
    };
    expect(resolveProfile(profiles, "video:abc", "channel:/@mixpilot")?.key).toBe("video:abc");
    expect(resolveProfile(profiles, null, "channel:/@mixpilot")?.key).toBe("channel:/@mixpilot");
    expect(resolveProfile(profiles, null, null)?.key).toBe("global");
  });
});
