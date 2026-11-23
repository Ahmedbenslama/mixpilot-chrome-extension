import { describe, expect, it } from "vitest";
import { LookaheadLimiter } from "../../src/audio/limiter";

const SR = 48000;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
}

function runBlocks(lim: LookaheadLimiter, chans: Float32Array[], block = 128) {
  const out = chans.map((c) => new Float32Array(c));
  for (let i = 0; i < out[0]!.length; i += block) {
    lim.process(out.map((c) => c.subarray(i, Math.min(i + block, c.length))));
  }
  return out;
}

describe("LookaheadLimiter", () => {
  it("passes signals below the ceiling bit-exactly, delayed by the lookahead (no make-up gain)", () => {
    const lim = new LookaheadLimiter({ sampleRate: SR, channels: 2, ceilingDb: -1 });
    const r = rng(1);
    const x = [new Float32Array(4800).map(() => 0.5 * r()), new Float32Array(4800).map(() => 0.5 * r())];
    const y = runBlocks(lim, x);
    const L = lim.latencySamples;
    expect(L).toBe(72); // 1.5 ms @ 48 kHz
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < L; i++) expect(y[c]![i]).toBe(0);
      for (let i = L; i < 4800; i++) expect(y[c]![i]).toBe(x[c]![i - L]);
    }
    expect(lim.takeGainReductionDb()).toBe(0);
  });

  it("never exceeds the ceiling on loud noise with sudden transients", () => {
    const ceilingDb = -1;
    const ceiling = 10 ** (ceilingDb / 20);
    const lim = new LookaheadLimiter({ sampleRate: SR, channels: 2, ceilingDb });
    const r = rng(7);
    const n = SR * 2;
    const x = [new Float32Array(n), new Float32Array(n)];
    for (let i = 0; i < n; i++) {
      const burst = i % 9600 < 30 ? 6 : 1; // 30-sample spikes, +15.6 dB
      x[0]![i] = 1.8 * r() * burst;
      x[1]![i] = 0.3 * r();
    }
    const y = runBlocks(lim, x, 128);
    let maxAbs = 0;
    for (const ch of y) for (const v of ch) maxAbs = Math.max(maxAbs, Math.abs(v));
    expect(maxAbs).toBeLessThanOrEqual(ceiling * (1 + 1e-6));
    expect(lim.takeGainReductionDb()).toBeLessThan(-10);
  });

  it("is stereo-linked: the quiet channel is reduced by the same gain as the loud one", () => {
    const lim = new LookaheadLimiter({ sampleRate: SR, channels: 2, ceilingDb: -6 });
    const n = 4800;
    const x = [new Float32Array(n).fill(1), new Float32Array(n).fill(0.25)];
    const y = runBlocks(lim, x);
    const i = n - 1;
    expect(y[1]![i]! / y[0]![i]!).toBeCloseTo(0.25, 6);
    expect(y[0]![i]).toBeCloseTo(10 ** (-6 / 20), 4);
  });

  it("releases back to unity after a loud passage ends", () => {
    const lim = new LookaheadLimiter({ sampleRate: SR, channels: 1, ceilingDb: -1, releaseMs: 50 });
    const loud = new Float32Array(SR / 2).fill(2);
    const quiet = new Float32Array(SR).fill(0.1);
    runBlocks(lim, [loud]);
    lim.takeGainReductionDb();
    const y = runBlocks(lim, [quiet]);
    expect(y[0]![SR - 1]).toBeCloseTo(0.1, 4);
  });

  it("output is invariant to block size", () => {
    const r = rng(3);
    const x = [new Float32Array(9000).map(() => 1.5 * r())];
    const a = runBlocks(new LookaheadLimiter({ sampleRate: SR, channels: 1 }), x, 128);
    const b = runBlocks(new LookaheadLimiter({ sampleRate: SR, channels: 1 }), x, 37);
    expect(Array.from(a[0]!)).toEqual(Array.from(b[0]!));
  });
});
