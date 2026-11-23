/**
 * Stereo-linked lookahead peak limiter (pure DSP, no Web Audio dependency, unit-tested).
 *
 * Unity gain below the ceiling: unlike DynamicsCompressorNode there is no make-up gain,
 * so signals that don't reach the ceiling pass through bit-exactly (just delayed).
 *
 * Gain computer per sample:
 *   required  = ceiling / peak  (or 1 if under the ceiling)
 *   held      = min(required) over the next `lookahead` samples   (sliding-window minimum)
 *   released  = instant attack down to `held`, exponential release back up
 *   smoothed  = box filter of length `lookahead` over `released`
 * Audio is delayed by `lookahead` samples, so the smoothed gain reaches the required value
 * by the time the peak is output. A box filter over a window-min of the same length never
 * exceeds the window-min at the peak position, which is what guarantees the ceiling.
 */
export interface LimiterOptions {
  sampleRate: number;
  channels: number;
  ceilingDb?: number;
  lookaheadMs?: number;
  releaseMs?: number;
}

export class LookaheadLimiter {
  readonly latencySamples: number;
  private readonly ceiling: number;
  private readonly releaseCoef: number;
  private readonly delay: Float32Array[];
  private readonly reqRing: Float64Array; // required gains for the window-min
  private readonly minDeque: Int32Array; // indices into absolute sample counter (mod ring)
  private dqHead = 0;
  private dqTail = 0;
  private readonly boxRing: Float64Array;
  private boxSum: number;
  private released = 1;
  private n = 0; // absolute sample counter
  private writeIdx = 0;
  /** Lowest gain applied since the last read (for a gain-reduction meter). */
  private minGainSinceRead = 1;

  constructor(opts: LimiterOptions) {
    const L = Math.max(1, Math.round(((opts.lookaheadMs ?? 1.5) / 1000) * opts.sampleRate));
    this.latencySamples = L;
    this.ceiling = 10 ** ((opts.ceilingDb ?? -1) / 20);
    this.releaseCoef = 1 - Math.exp(-1 / (((opts.releaseMs ?? 80) / 1000) * opts.sampleRate));
    this.delay = Array.from({ length: opts.channels }, () => new Float32Array(L));
    this.reqRing = new Float64Array(L + 1);
    this.minDeque = new Int32Array(L + 2);
    this.boxRing = new Float64Array(L).fill(1);
    this.boxSum = L;
  }

  /** In-place processing of planar channel buffers of equal length. */
  process(channels: Float32Array[]): void {
    const L = this.latencySamples;
    const nCh = channels.length;
    const len = channels[0]?.length ?? 0;
    const cap = this.minDeque.length;
    for (let i = 0; i < len; i++) {
      // 1. peak across channels -> required gain
      let peak = 0;
      for (let c = 0; c < nCh; c++) {
        const a = Math.abs(channels[c]![i]!);
        if (a > peak) peak = a;
      }
      const req = peak > this.ceiling ? this.ceiling / peak : 1;

      // 2. sliding-window minimum over the last L+1 required gains (monotonic deque)
      const slot = this.n % (L + 1);
      this.reqRing[slot] = req;
      while (this.dqTail !== this.dqHead) {
        const lastIdx = this.minDeque[(this.dqTail - 1 + cap) % cap]!;
        if (this.reqRing[lastIdx % (L + 1)]! >= req) this.dqTail = (this.dqTail - 1 + cap) % cap;
        else break;
      }
      this.minDeque[this.dqTail] = this.n;
      this.dqTail = (this.dqTail + 1) % cap;
      while (this.minDeque[this.dqHead]! <= this.n - (L + 1)) this.dqHead = (this.dqHead + 1) % cap;
      const held = this.reqRing[this.minDeque[this.dqHead]! % (L + 1)]!;

      // 3. instant attack, exponential release
      this.released = held < this.released ? held : this.released + (held - this.released) * this.releaseCoef;

      // 4. box filter of length L
      const bi = this.n % L;
      this.boxSum += this.released - this.boxRing[bi]!;
      this.boxRing[bi] = this.released;
      if (bi === 0) {
        // periodic exact recompute to stop floating-point drift
        let s = 0;
        for (let k = 0; k < L; k++) s += this.boxRing[k]!;
        this.boxSum = s;
      }
      const gain = Math.min(1, this.boxSum / L);
      if (gain < this.minGainSinceRead) this.minGainSinceRead = gain;

      // 5. delayed audio * gain
      for (let c = 0; c < nCh; c++) {
        const d = this.delay[c]!;
        const x = channels[c]![i]!;
        const y = d[this.writeIdx]!;
        d[this.writeIdx] = x;
        channels[c]![i] = gain === 1 ? y : y * gain;
      }
      this.writeIdx = (this.writeIdx + 1) % L;
      this.n++;
    }
  }

  /** Gain reduction in dB since the previous call (0 = untouched). */
  takeGainReductionDb(): number {
    const g = this.minGainSinceRead;
    this.minGainSinceRead = 1;
    return g >= 1 ? 0 : 20 * Math.log10(g);
  }
}
