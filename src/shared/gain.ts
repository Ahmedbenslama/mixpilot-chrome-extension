/** Gain helpers shared by the UI and the audio engine. Linear gain: 1 = original level. */

export const STEM_GAIN_MAX = 2;
export const MASTER_GAIN_MAX = 2;

/** Clamp to [0, max]. Non-finite input is rejected (returns null) rather than silently coerced. */
export function clampGain(value: unknown, max: number): number | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(0, n));
}

export function gainToPercent(gain: number): number {
  return Math.round(gain * 100);
}

export function percentToGain(percent: number): number {
  return percent / 100;
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}
