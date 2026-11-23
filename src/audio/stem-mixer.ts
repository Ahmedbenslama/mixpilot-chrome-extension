/**
 * Real-time stem assembly (runs inside the AudioWorklet; pure logic so it is unit-testable).
 *
 * Timeline (all indices are absolute input-sample counts n):
 *   - input mid[n] = (L+R)/2 is pushed to `inRing` for the inference worker;
 *   - the worker writes speechModel[i] to `outRing` at the SAME index i, where the model's
 *     output at i is the speech estimate for input i - modelDelay;
 *   - at time n we output stems for input n - D, where D = modelDelay + jitterAllowance:
 *         s        = outRing[n - jitterAllowance]
 *         original = stereo input delayed by D (local delay line)
 *         speech   = [s, s]
 *         music    = original - speech            -> speech + music == original exactly
 *
 * If the sample needed is missing (inference late), the separation weight w ramps to 0 and the
 * latency-matched original is output instead; a governor declares "overloaded" when late
 * samples are frequent and only re-engages after a stable period.
 *
 * Outputs (each stereo): speech*w, music*w, original (A/B tap), original*(1-w) (fallback).
 */
import type { FloatRing } from "./ring";

export const enum SeparationState {
  Off = 0, // separation disabled or model not ready
  Priming = 1, // waiting for the first model output to reach the read point
  Running = 2,
  Overloaded = 3, // inference too slow: latency-matched original is playing
}

/** Indices into the shared Int32 stats block. */
export const Stat = {
  State: 0,
  UnderrunSamples: 1,
  OverflowSamples: 2,
  WeightMilli: 3,
  HeadroomSamples: 4, // how far ahead of the read point the worker currently is
  MinHeadroomSamples: 5, // minimum headroom since last reset by the reader
  OverloadEvents: 6,
  Length: 8,
} as const;

export interface StemMixerOptions {
  sampleRate: number;
  modelDelay: number; // samples between model input and its output alignment (DFN3: 1440)
  jitterAllowance: number; // extra buffering (samples) to absorb inference timing spikes
  inRing: FloatRing;
  outRing: FloatRing;
  stats?: Int32Array;
  crossfadeMs?: number;
  /** Fraction of late samples in a 0.5 s window that triggers overload. */
  overloadThreshold?: number;
  /** Time to stay in fallback after overload before retrying. */
  overloadHoldMs?: number;
}

export interface StemOutputs {
  speech: Float32Array[];
  music: Float32Array[];
  original: Float32Array[];
  fallback: Float32Array[];
}

export class StemMixer {
  readonly latencySamples: number;
  private readonly A: number;
  private readonly delayL: Float32Array;
  private readonly delayR: Float32Array;
  private delayPos = 0;
  private n = 0; // absolute input index of the next sample
  private w = 0;
  private readonly wStep: number;
  private enabled = false;
  private ready = false;
  private state: SeparationState = SeparationState.Off;
  private mid: Float32Array;
  // governor
  private readonly windowLen: number;
  private windowPos = 0;
  private windowLate = 0;
  private readonly overloadThreshold: number;
  private readonly holdSamples: number;
  private holdUntil = 0;
  private minHeadroom = Number.MAX_SAFE_INTEGER;

  constructor(private readonly o: StemMixerOptions) {
    this.A = Math.max(0, Math.round(o.jitterAllowance));
    this.latencySamples = o.modelDelay + this.A;
    this.delayL = new Float32Array(Math.max(1, this.latencySamples));
    this.delayR = new Float32Array(Math.max(1, this.latencySamples));
    this.wStep = 1 / Math.max(1, Math.round(((o.crossfadeMs ?? 10) / 1000) * o.sampleRate));
    this.mid = new Float32Array(128);
    this.windowLen = Math.round(0.5 * o.sampleRate);
    this.overloadThreshold = o.overloadThreshold ?? 0.002;
    this.holdSamples = Math.round(((o.overloadHoldMs ?? 3000) / 1000) * o.sampleRate);
  }

  setEnabled(on: boolean): void { this.enabled = on; }
  setReady(on: boolean): void { this.ready = on; }
  getState(): SeparationState { return this.state; }
  getWeight(): number { return this.w; }

  process(inL: Float32Array, inR: Float32Array | undefined, out: StemOutputs, frames: number): void {
    const R = inR ?? inL;
    const { inRing, outRing } = this.o;
    const D = this.latencySamples;

    // 1. feed the model (mid channel). Overflow means the worker is stalled: drop and count.
    if (this.mid.length < frames) this.mid = new Float32Array(frames);
    const mid = this.mid.subarray(0, frames);
    for (let i = 0; i < frames; i++) mid[i] = 0.5 * (inL[i]! + R[i]!);
    if (!inRing.write(mid)) this.bump(Stat.OverflowSamples, frames);

    const [sL, sR] = out.speech;
    const [mL, mR] = out.music;
    const [oL, oR] = out.original;
    const [fL, fR] = out.fallback;
    let late = 0;

    for (let i = 0; i < frames; i++, this.n = (this.n + 1) | 0) {
      // 2. latency-matched original
      let origL: number;
      let origR: number;
      if (D > 0) {
        origL = this.delayL[this.delayPos]!;
        origR = this.delayR[this.delayPos]!;
        this.delayL[this.delayPos] = inL[i]!;
        this.delayR[this.delayPos] = R[i]!;
        this.delayPos = this.delayPos + 1 === D ? 0 : this.delayPos + 1;
      } else {
        origL = inL[i]!;
        origR = R[i]!;
      }

      // 3. speech sample for this output time
      const k = (this.n - this.A) | 0;
      let s = 0;
      let have = false;
      if (outRing.has(k)) {
        s = outRing.at(k);
        have = true;
      } else if (this.state === SeparationState.Running) {
        late++;
      }

      // 4. target weight and smoothing
      const wanted = this.enabled && this.ready && this.n - this.holdUntil >= 0;
      const target = wanted && have ? 1 : 0;
      if (this.w < target) this.w = Math.min(target, this.w + this.wStep);
      else if (this.w > target) this.w = Math.max(target, this.w - this.wStep);
      if (!have) s = 0;
      const w = this.w;

      sL![i] = w * s;
      sR![i] = w * s;
      mL![i] = w * (origL - s);
      mR![i] = w * (origR - s);
      oL![i] = origL;
      oR![i] = origR;
      fL![i] = (1 - w) * origL;
      fR![i] = (1 - w) * origR;
    }

    // 5. reader position + headroom (how far the worker is ahead of where we read)
    const nextK = (this.n - this.A) | 0;
    outRing.setReadIndex(nextK);
    const headroom = (outRing.writeIndex - nextK) | 0;
    if (headroom < this.minHeadroom) this.minHeadroom = headroom;

    // 6. governor
    this.windowLate += late;
    this.windowPos += frames;
    if (late > 0) this.bump(Stat.UnderrunSamples, late);
    if (this.windowPos >= this.windowLen) {
      if (this.windowLate / this.windowPos > this.overloadThreshold && this.enabled && this.ready) {
        this.holdUntil = (this.n + this.holdSamples) | 0;
        this.bump(Stat.OverloadEvents, 1);
      }
      this.windowPos = 0;
      this.windowLate = 0;
    }

    // 7. state for the UI
    const inHold = this.n - this.holdUntil < 0;
    if (!this.enabled || !this.ready) this.state = SeparationState.Off;
    else if (inHold) this.state = SeparationState.Overloaded;
    else if (this.w >= 1) this.state = SeparationState.Running;
    else if (this.state !== SeparationState.Running) this.state = SeparationState.Priming;

    const st = this.o.stats;
    if (st) {
      Atomics.store(st, Stat.State, this.state);
      Atomics.store(st, Stat.WeightMilli, Math.round(this.w * 1000));
      Atomics.store(st, Stat.HeadroomSamples, headroom);
      const prevMin = Atomics.load(st, Stat.MinHeadroomSamples);
      if (prevMin === 0x7fffffff || headroom < prevMin) Atomics.store(st, Stat.MinHeadroomSamples, headroom);
    }
  }

  private bump(i: number, by: number): void {
    if (this.o.stats) Atomics.add(this.o.stats, i, by);
  }
}

/** Fresh stats block (min-headroom starts at "unset"). */
export function createStats(): Int32Array {
  const st = new Int32Array(Stat.Length);
  st[Stat.MinHeadroomSamples] = 0x7fffffff;
  return st;
}
