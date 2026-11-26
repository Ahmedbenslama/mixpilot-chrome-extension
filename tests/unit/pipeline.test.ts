import { describe, expect, it } from "vitest";
import { HopQueue, HopSender, type HopMessage, type HopReturn } from "../../src/audio/hop-bridge";
import { FloatRing } from "../../src/audio/ring";
import { createStats, SeparationState, Stat, StemMixer } from "../../src/audio/stem-mixer";

const SR = 48000;
const HOP = 480;
const M = 1440; // model delay (DFN3)
const BLOCK = 128;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * 2 - 1;
}

describe("FloatRing", () => {
  it("writes and reads across the wrap point", () => {
    const r = FloatRing.create(8);
    expect(r.write(Float32Array.from([1, 2, 3, 4, 5, 6]))).toBe(true);
    const a = new Float32Array(4);
    expect(r.read(a)).toBe(true);
    expect(Array.from(a)).toEqual([1, 2, 3, 4]);
    expect(r.write(Float32Array.from([7, 8, 9, 10, 11, 12]))).toBe(true);
    expect(r.write(Float32Array.from([13]))).toBe(false);
    const b = new Float32Array(8);
    expect(r.read(b)).toBe(true);
    expect(Array.from(b)).toEqual([5, 6, 7, 8, 9, 10, 11, 12]);
    expect(r.available()).toBe(0);
  });

  it("supports absolute-index access and a reader that runs ahead of the writer", () => {
    const r = FloatRing.create(16);
    r.write(Float32Array.from([10, 11, 12]));
    expect(r.has(0) && r.has(2)).toBe(true);
    expect(r.has(3)).toBe(false);
    expect(r.at(1)).toBe(11);
    r.setReadIndex(10);
    expect(r.lag()).toBe(7);
    expect(r.available()).toBe(0);
    r.skipWrite(7);
    expect(r.lag()).toBe(0);
    expect(r.writeIndex).toBe(10);
  });

  it("keeps working when 32-bit indices wrap around", () => {
    const r = FloatRing.create(8);
    const hdr = new Int32Array(r.sab, 0, 4);
    hdr[0] = 0x7ffffffc;
    hdr[1] = 0x7ffffffc;
    r.write(Float32Array.from([1, 2, 3, 4, 5, 6]));
    const i = (0x7ffffffc + 5) | 0;
    expect(i).toBeLessThan(0);
    expect(r.has(i)).toBe(true);
    expect(r.at(i)).toBe(6);
    const out = new Float32Array(6);
    expect(r.read(out)).toBe(true);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("rejects non power-of-two capacities", () => {
    expect(() => FloatRing.create(100)).toThrow();
  });
});

/**
 * Full real-time pipeline simulation: StemMixer + HopSender (worklet) <-> HopQueue + oracle model (worker).
 * The oracle returns the true speech delayed by M, i.e. a perfect DFN3. `workerHops(block)` controls
 * how many hops the worker manages per render quantum (simulates speed/stalls); messages arrive
 * after `transitBlocks` quanta (simulates postMessage latency).
 */
function makePipeline(n: number, jitter: number, seed = 1, transitBlocks = 1) {
  const r = rng(seed);
  const speech = new Float32Array(n).map((_, i) => 0.3 * Math.sin(i * 0.013) * (r() * 0.5 + 0.5));
  const musL = new Float32Array(n).map(() => 0.2 * r());
  const musR = new Float32Array(n).map(() => 0.2 * r());
  const L = speech.map((s, i) => s + musL[i]!);
  const R = speech.map((s, i) => s + musR[i]!);
  const inRing = FloatRing.create(1 << 15);
  const outRing = FloatRing.create(1 << 15);
  const stats = createStats();
  const mixer = new StemMixer({ sampleRate: SR, modelDelay: M, jitterAllowance: jitter, inRing, outRing, stats, crossfadeMs: 5 });
  const toWorker: { at: number; m: HopMessage }[] = [];
  const toWorklet: { at: number; m: HopReturn }[] = [];
  let block = 0;
  const sender = new HopSender(inRing, outRing, HOP, (m) => toWorker.push({ at: block + transitBlocks, m }));
  const queue = new HopQueue(HOP, 30);
  const oracle = (m: HopMessage) => {
    for (let j = 0; j < HOP; j++) {
      const src = m.i + j - M;
      m.buf[j] = src >= 0 && src < n ? speech[src]! : 0;
    }
  };
  const outs = {
    speech: [new Float32Array(n), new Float32Array(n)],
    music: [new Float32Array(n), new Float32Array(n)],
    original: [new Float32Array(n), new Float32Array(n)],
    fallback: [new Float32Array(n), new Float32Array(n)],
  };
  async function run(workerHops: (block: number) => number) {
    for (let i = 0; i < n; block++, i += BLOCK) {
      while (toWorklet.length && toWorklet[0]!.at <= block) sender.receive(toWorklet.shift()!.m);
      const f = Math.min(BLOCK, n - i);
      const sub = (a: Float32Array[]) => a.map((x) => x.subarray(i, i + f));
      mixer.process(L.subarray(i, i + f), R.subarray(i, i + f),
        { speech: sub(outs.speech), music: sub(outs.music), original: sub(outs.original), fallback: sub(outs.fallback) }, f);
      sender.pump();
      while (toWorker.length && toWorker[0]!.at <= block) queue.push(toWorker.shift()!.m);
      for (let k = workerHops(block); k > 0; k--) {
        const { run, drop } = queue.next();
        for (const d of drop) toWorklet.push({ at: block + transitBlocks, m: { i: d.i, buf: d.buf, dropped: true } });
        if (!run) break;
        oracle(run);
        toWorklet.push({ at: block + transitBlocks, m: { i: run.i, buf: run.buf, dropped: false } });
      }
    }
  }
  return { speech, musL, musR, L, R, mixer, sender, queue, stats, outs, run, D: M + jitter };
}

describe("StemMixer + HopSender/HopQueue (oracle model, message transport)", () => {
  it("reproduces ground-truth stems sample-exactly at latency D once primed", async () => {
    const n = SR * 2;
    const p = makePipeline(n, 1920);
    p.mixer.setEnabled(true);
    p.mixer.setReady(true);
    await p.run(() => 2);
    const { D } = p;
    const settle = D + 4 * BLOCK + Math.round(0.005 * SR);
    let maxErr = 0;
    for (let t = settle; t < n; t++) {
      maxErr = Math.max(maxErr,
        Math.abs(p.outs.speech[0]![t]! - p.speech[t - D]!),
        Math.abs(p.outs.speech[1]![t]! - p.speech[t - D]!),
        Math.abs(p.outs.music[0]![t]! - p.musL[t - D]!),
        Math.abs(p.outs.music[1]![t]! - p.musR[t - D]!),
        Math.abs(p.outs.original[0]![t]! - p.L[t - D]!));
    }
    expect(maxErr).toBeLessThan(1e-6);
    expect(p.mixer.getState()).toBe(SeparationState.Running);
    expect(p.stats[Stat.UnderrunSamples]).toBe(0);
    expect(p.mixer.latencySamples).toBe(D);
    expect(p.sender.allocated).toBe(16); // buffer pool never had to grow: no audio-thread allocation
  });

  it("ducks the residual Music stem to silence around detected speech when Speech is muted", async () => {
    const n = SR * 2;
    const p = makePipeline(n, 5664);
    p.mixer.setEnabled(true);
    p.mixer.setReady(true);
    p.mixer.setSpeechMuted(true);
    await p.run(() => 2);
    let sumSq = 0;
    let count = 0;
    for (let t = Math.round(1.2 * SR); t < Math.round(1.8 * SR); t++) {
      sumSq += p.outs.music[0]![t]! ** 2;
      count++;
    }
    expect(Math.sqrt(sumSq / count)).toBeLessThan(0.001);
    expect(p.mixer.latencySamples).toBe(1440 + 5664);
  });

  it("at unity gains, speech + music + fallback always equals the latency-matched original (any w)", async () => {
    const n = SR;
    const p = makePipeline(n, 960, 5);
    p.mixer.setEnabled(true);
    p.mixer.setReady(true);
    const r = rng(9);
    await p.run(() => (r() > 0.4 ? 2 : 0)); // erratic worker -> many fallback transitions
    let maxErr = 0;
    for (let t = 0; t < n; t++) {
      for (let c = 0; c < 2; c++) {
        const sum = p.outs.speech[c]![t]! + p.outs.music[c]![t]! + p.outs.fallback[c]![t]!;
        maxErr = Math.max(maxErr, Math.abs(sum - p.outs.original[c]![t]!));
      }
    }
    expect(maxErr).toBeLessThan(1e-6);
  });

  it("falls back on a worker stall, drops stale hops, and is sample-exact again after recovery", async () => {
    const stallFrom = Math.round((1.0 * SR) / BLOCK);
    const stallTo = Math.round((1.3 * SR) / BLOCK); // 300 ms stall
    const q = makePipeline(SR * 7, 1920, 4);
    q.mixer.setEnabled(true);
    q.mixer.setReady(true);
    await q.run((b) => (b < stallFrom || b >= stallTo ? 2 : 0));
    expect(q.stats[Stat.UnderrunSamples]).toBeGreaterThan(0);
    expect(q.stats[Stat.OverloadEvents]).toBeGreaterThanOrEqual(1);
    expect(q.queue.droppedHops).toBeGreaterThan(0);
    expect(q.mixer.getState()).toBe(SeparationState.Running);
    const D = q.D;
    let maxErr = 0;
    for (let t = Math.round(5.5 * SR); t < SR * 7; t++) {
      maxErr = Math.max(maxErr, Math.abs(q.outs.speech[0]![t]! - q.speech[t - D]!), Math.abs(q.outs.music[1]![t]! - q.musR[t - D]!));
    }
    expect(maxErr).toBeLessThan(1e-6);
    expect(q.sender.allocated).toBe(16);
  });

  it("tolerates message transit delay within the jitter allowance", async () => {
    const n = SR * 2;
    const p = makePipeline(n, 1920, 6, /* transitBlocks */ 4); // ~10.7 ms each way
    p.mixer.setEnabled(true);
    p.mixer.setReady(true);
    await p.run(() => 2);
    expect(p.stats[Stat.UnderrunSamples]).toBe(0);
    expect(p.mixer.getState()).toBe(SeparationState.Running);
  });

  it("outputs only the latency-matched original while the model is loading", async () => {
    const n = SR / 2;
    const p = makePipeline(n, 960, 7);
    p.mixer.setEnabled(true);
    p.mixer.setReady(false);
    await p.run(() => 2);
    for (let t = 0; t < n; t++) {
      expect(Math.abs(p.outs.speech[0]![t]!)).toBe(0);
      expect(Math.abs(p.outs.music[0]![t]!)).toBe(0);
      expect(p.outs.fallback[0]![t]).toBe(p.outs.original[0]![t]);
    }
    expect(p.mixer.getState()).toBe(SeparationState.Off);
  });
});

describe("HopQueue", () => {
  const msg = (i: number, reader = 0): HopMessage => ({ i, buf: new Float32Array(HOP), reader });
  it("runs hops in order", () => {
    const q = new HopQueue(HOP, 10);
    q.push(msg(0)); q.push(msg(480));
    expect(q.next().run?.i).toBe(0);
    expect(q.next().run?.i).toBe(480);
    expect(q.next().run).toBeNull();
  });
  it("drops hops the worklet has already read past", () => {
    const q = new HopQueue(HOP, 10);
    q.push(msg(0)); q.push(msg(480)); q.push(msg(960, 960));
    const { run, drop } = q.next();
    expect(drop.map((d) => d.i)).toEqual([0, 480]);
    expect(run?.i).toBe(960);
  });
  it("bounds the backlog by dropping the oldest hops", () => {
    const q = new HopQueue(HOP, 3);
    for (let k = 0; k < 6; k++) q.push(msg(k * HOP));
    const { run, drop } = q.next();
    expect(drop.length).toBe(3);
    expect(run?.i).toBe(3 * HOP);
  });
});

describe("HopSender", () => {
  it("fills gaps left by dropped hops so later hops land at their own index", () => {
    const inRing = FloatRing.create(4096);
    const outRing = FloatRing.create(4096);
    const sent: HopMessage[] = [];
    const s = new HopSender(inRing, outRing, HOP, (m) => sent.push(m), 4);
    inRing.write(new Float32Array(3 * HOP));
    s.pump();
    expect(sent.map((m) => m.i)).toEqual([0, 480, 960]);
    s.receive({ i: 0, buf: sent[0]!.buf.fill(1), dropped: false });
    s.receive({ i: 480, buf: sent[1]!.buf, dropped: true });
    s.receive({ i: 960, buf: sent[2]!.buf.fill(3), dropped: false });
    expect(outRing.at(0)).toBe(1);
    expect(outRing.at(960)).toBe(3);
    expect(outRing.writeIndex).toBe(1440);
    expect(s.poolSize).toBe(4);
  });
});
