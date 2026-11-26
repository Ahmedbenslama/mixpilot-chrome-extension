import type { Preferences } from "./messages";

export type ProfileScope = "global" | "channel" | "video";
export type MixProfile = Pick<Preferences, "speechGain" | "musicGain" | "masterGain">;
export type ProfileMap = Record<string, MixProfile>;

export function videoProfileKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)youtube\.com$/i.test(parsed.hostname)) return null;
    const id = parsed.pathname === "/watch" ? parsed.searchParams.get("v") : null;
    return id ? `video:${id}` : null;
  } catch { return null; }
}
export function channelProfileKey(channelUrl: string | null): string | null {
  if (!channelUrl) return null;
  try {
    const url = new URL(channelUrl, "https://www.youtube.com");
    if (!/(^|\.)youtube\.com$/i.test(url.hostname)) return null;
    const path = url.pathname.replace(/\/$/, "");
    if (!/^\/(channel\/UC[\w-]+|@[^/]+|user\/[^/]+|c\/[^/]+)$/.test(path)) return null;
    return `channel:${path.toLowerCase()}`;
  } catch { return null; }
}
export function resolveProfile(profiles: ProfileMap, videoKey: string | null, channelKey: string | null): { key: string; mix: MixProfile } | null {
  for (const key of [videoKey, channelKey, "global"]) {
    if (key && profiles[key]) return { key, mix: profiles[key]! };
  }
  return null;
}
