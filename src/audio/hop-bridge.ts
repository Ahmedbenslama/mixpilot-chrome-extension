/**
 * Message transport between the AudioWorklet and the inference worker (pure logic, unit-tested).
 *
 * Why messages and not SharedArrayBuffer: Chrome refuses to start tab capture in a
 * cross-origin-isolated document, and SharedArrayBuffer requires cross-origin isolation.
 *
 * Flow (over a dedicated MessageChannel; the main thread is not involved):
 *   worklet  HopSender.pump()     -> { i, buf, reader }   hop of mid-channel input starting at index i
 *   worker   HopQueue.next()      -> runs model, writes speech into the same buffer
 *   worker                        -> { i, buf, dropped }  buffer returned (transfer) to the worklet
 *   worklet  HopSender.receive()  -> speech written into the local output ring at index i
 *
 * Buffers circulate in a fixed pool, so the audio thread does not allocate in steady state.
 * Index i is carried end-to-end, so the speech sample at index i always pairs with input index i.
 */
import type { FloatRing } from "./ring";

export interface HopMessage {
  i: number; // absolute input index of the first sample
  buf: Float32Array; // hop samples (input on the way out, speech on the way back)
  reader: number; // worklet's current output read index (lets the worker skip hops that are already too late)
}

export interface HopReturn {
  i: number;
  buf: Float32Array;
  dropped: boolean; // worker skipped this hop (too late / backlog); buf carries no speech
}

/** Worklet side. */
export class HopSender {
  private readonly pool: Float32Array[] = [];
  allocated = 0;
  received = 0;
  stale = 0;
  /** Hops not sent because every pooled buffer was in flight (worker stalled). */
  droppedLocal = 0;

  constructor(
    private readonly inRing: FloatRing,
    private readonly outRing: FloatRing,
    private readonly hop: number,
    private readonly post: (m: HopMessage) => void,
    poolSize = 16,
  ) {
    for (let k = 0; k < poolSize; k++) this.pool.push(new Float32Array(hop));
    this.allocated = poolSize;
  }

  /**
   * Send every complete hop of buffered input. Call after each render quantum.
   * If every pooled buffer is in flight (worker stalled), the hop is dropped here instead of
   * allocating on the audio thread; that also caps the worker backlog at the pool size.
   */
  pump(): void {
    while (this.inRing.available() >= this.hop) {
      const buf = this.pool.pop();
      if (!buf) {
        this.inRing.skipRead(this.hop);
        this.droppedLocal++;
        continue;
      }
      const i = this.inRing.readIndex;
      this.inRing.read(buf);
      this.post({ i, buf, reader: this.outRing.readIndex });
    }
  }

  /** Accept a hop back from the worker. */
  receive(m: HopReturn): void {
    this.received++;
    if (!m.dropped) {
      const w = this.outRing.writeIndex;
      const ahead = (m.i - w) | 0;
      if (ahead < 0) {
        this.stale++; // older than what we already have: ignore
      } else {
        if (ahead > 0) this.outRing.skipWrite(ahead); // hops the worker dropped: leave a gap
        if (!this.outRing.write(m.buf)) this.stale++;
      }
    }
    if (m.buf.length === this.hop) this.pool.push(m.buf);
  }

  get poolSize(): number {
    return this.pool.length;
  }
}

/** Worker side: ordered queue with a drop policy so latency can never grow without bound. */
export class HopQueue {
  private readonly q: HopMessage[] = [];
  private reader = 0;
  droppedHops = 0;

  constructor(
    private readonly hop: number,
    private readonly maxBacklogHops: number,
  ) {}

  push(m: HopMessage): void {
    this.q.push(m);
    this.reader = m.reader;
  }

  get length(): number {
    return this.q.length;
  }

  /**
   * Next hop worth running, plus hops to return as dropped:
   *  - hops whose output the worklet has already read past (useless now),
   *  - the oldest hops beyond the backlog limit.
   */
  next(): { run: HopMessage | null; drop: HopMessage[] } {
    const drop: HopMessage[] = [];
    while (this.q.length > this.maxBacklogHops) drop.push(this.q.shift()!);
    while (this.q.length && (((this.q[0]!.i + this.hop) - this.reader) | 0) <= 0) drop.push(this.q.shift()!);
    this.droppedHops += drop.length;
    return { run: this.q.shift() ?? null, drop };
  }
}

export function percentile(xs: number[], p: number): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
}
