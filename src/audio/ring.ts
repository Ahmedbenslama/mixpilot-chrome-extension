/**
 * Single-producer / single-consumer float ring addressed by ABSOLUTE sample index
 * (32-bit, wrapping). Slot = index & (capacity - 1). Works over a plain ArrayBuffer (used inside
 * one thread, e.g. the AudioWorklet) or a SharedArrayBuffer (cross-thread, if ever available:
 * Chrome refuses tab capture in cross-origin-isolated documents, so the extension uses plain buffers).
 *
 * All index comparisons use wrapping differences `(a - b) | 0`, so the counters can run
 * forever (they wrap every 2^32 samples ≈ 24.8 h at 48 kHz without breaking).
 *
 * The reader may move AHEAD of the writer (after an underrun it skips samples that never
 * arrived); the writer then sees `lag() > 0` and can skip input to catch up. This keeps
 * input index == output index for the separation path, so stems never drift out of sync.
 */
const W = 0; // header slot: write index (next index to be written)
const R = 1; // header slot: read index (next index the reader wants)
const HEADER_BYTES = 16;

export class FloatRing {
  readonly capacity: number;
  private readonly mask: number;
  private readonly header: Int32Array;
  private readonly data: Float32Array;

  constructor(readonly sab: ArrayBuffer | SharedArrayBuffer) {
    this.header = new Int32Array(sab, 0, 4);
    this.data = new Float32Array(sab, HEADER_BYTES);
    this.capacity = this.data.length;
    if ((this.capacity & (this.capacity - 1)) !== 0) throw new Error("capacity must be a power of two");
    this.mask = this.capacity - 1;
  }

  static create(capacity: number, shared = false): FloatRing {
    if (capacity <= 0 || (capacity & (capacity - 1)) !== 0) throw new Error("capacity must be a power of two");
    const bytes = HEADER_BYTES + capacity * 4;
    return new FloatRing(shared ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes));
  }

  get writeIndex(): number { return Atomics.load(this.header, W); }
  get readIndex(): number { return Atomics.load(this.header, R); }

  /** Samples written but not yet consumed (0 if the reader is ahead). */
  available(): number {
    const d = (this.writeIndex - this.readIndex) | 0;
    return d > 0 ? d : 0;
  }

  /** How far the reader is ahead of the writer (> 0 means the writer is behind). */
  lag(): number {
    const d = (this.readIndex - this.writeIndex) | 0;
    return d > 0 ? d : 0;
  }

  /** Free space for the writer without overwriting unread samples. */
  free(): number {
    return this.capacity - this.available();
  }

  /** Append samples at the write index. Returns false (writes nothing) if there is not enough room. */
  write(src: Float32Array): boolean {
    const n = src.length;
    if (n > this.free()) return false;
    const w = this.writeIndex;
    const start = w & this.mask;
    const first = Math.min(n, this.capacity - start);
    this.data.set(first === n ? src : src.subarray(0, first), start);
    if (first < n) this.data.set(src.subarray(first), 0);
    Atomics.store(this.header, W, (w + n) | 0);
    return true;
  }

  /** Advance the write index without writing (writer skipping indices the reader already passed). */
  skipWrite(n: number): void {
    Atomics.store(this.header, W, (this.writeIndex + n) | 0);
  }

  /** Copy the next `dst.length` samples and consume them. Returns false if not enough are available. */
  read(dst: Float32Array): boolean {
    const n = dst.length;
    if (n > this.available()) return false;
    const r = this.readIndex;
    const start = r & this.mask;
    const first = Math.min(n, this.capacity - start);
    dst.set(this.data.subarray(start, start + first), 0);
    if (first < n) dst.set(this.data.subarray(0, n - first), first);
    Atomics.store(this.header, R, (r + n) | 0);
    return true;
  }

  /** Drop up to n unread samples. Returns how many were dropped. */
  skipRead(n: number): number {
    const k = Math.min(n, this.available());
    Atomics.store(this.header, R, (this.readIndex + k) | 0);
    return k;
  }

  /** Is absolute index `i` written and still in the buffer? */
  has(i: number): boolean {
    const d = (this.writeIndex - i) | 0;
    return d > 0 && d <= this.capacity;
  }

  /** Read the sample at absolute index `i` (caller checks `has(i)`). Does not move the read index. */
  at(i: number): number {
    return this.data[i & this.mask]!;
  }

  /** Reader declares it has finished with everything before `i` (may move ahead of the writer). */
  setReadIndex(i: number): void {
    Atomics.store(this.header, R, i | 0);
  }

}
