/** RMS and peak of a block, in dBFS. Silence returns -Infinity. */
export function blockLevelsDb(samples: Float32Array): { rmsDb: number; peakDb: number } {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    sum += s * s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
  }
  const rms = samples.length ? Math.sqrt(sum / samples.length) : 0;
  const toDb = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
  return { rmsDb: toDb(rms), peakDb: toDb(peak) };
}
