/// <reference path="./worklet-globals.d.ts" />
/**
 * AudioWorklet "mixpilot-separation": 1 stereo input, 4 stereo outputs
 *   0 speech stem (× separation weight)    1 music stem (× weight)
 *   2 latency-matched original (A/B tap)   3 original × (1 − weight) (fallback while loading/overloaded)
 * Stem logic lives in StemMixer, transport in HopSender (both unit-tested); this file adapts them.
 */
import type { SeparationWorkletOptions, WorkletInbound, WorkletStats } from "../engine/protocol";
import { HopSender, type HopMessage, type HopReturn } from "./hop-bridge";
import { FloatRing } from "./ring";
import { createStats, StemMixer } from "./stem-mixer";

const HOP = 480;
const STATS_EVERY_FRAMES = 9600; // ~200 ms

class SeparationProcessor extends AudioWorkletProcessor {
  private readonly mixer: StemMixer;
  private readonly sender: HopSender;
  private readonly stats = createStats();
  private link: MessagePort | null = null;
  private silent = new Float32Array(128);
  private framesSinceStats = 0;

  constructor(options?: unknown) {
    super();
    const o = (options as { processorOptions: SeparationWorkletOptions }).processorOptions;
    const inRing = FloatRing.create(1 << 14); // 341 ms of pending input
    const outRing = FloatRing.create(1 << 16); // 1.36 s of speech
    this.mixer = new StemMixer({
      sampleRate,
      modelDelay: o.modelDelay,
      jitterAllowance: o.jitterAllowance,
      inRing,
      outRing,
      stats: this.stats,
    });
    this.sender = new HopSender(inRing, outRing, HOP, (m: HopMessage) => {
      this.link?.postMessage(m, [m.buf.buffer]); // pump() only runs once connected
    });
    this.port.onmessage = (e: MessageEvent<WorkletInbound>) => {
      const m = e.data;
      if (m.type === "connect") {
        this.link = m.port;
        this.link.onmessage = (ev: MessageEvent<HopReturn>) => this.sender.receive(ev.data);
      } else if (m.type === "enabled") this.mixer.setEnabled(m.on);
      else if (m.type === "ready") this.mixer.setReady(m.on);
      else if (m.type === "speechMuted") this.mixer.setSpeechMuted(m.on);
    };
  }

  override process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0] ?? [];
    const frames = outputs[0]?.[0]?.length ?? 128;
    if (this.silent.length < frames) this.silent = new Float32Array(frames);
    const L = input[0] ?? this.silent.subarray(0, frames);
    const R = input[1] ?? L;
    const pick = (o: Float32Array[] | undefined) => [o![0]!, o![1] ?? o![0]!];
    this.mixer.process(L, R, {
      speech: pick(outputs[0]),
      music: pick(outputs[1]),
      original: pick(outputs[2]),
      fallback: pick(outputs[3]),
    }, frames);
    if (this.link) this.sender.pump();

    this.framesSinceStats += frames;
    if (this.framesSinceStats >= STATS_EVERY_FRAMES) {
      this.framesSinceStats = 0;
      const msg: WorkletStats = {
        type: "stats",
        stats: Array.from(this.stats),
        droppedLocalHops: this.sender.droppedLocal,
        staleHops: this.sender.stale,
      };
      this.port.postMessage(msg);
      this.stats[5] = 0x7fffffff; // reset min headroom window (Stat.MinHeadroomSamples)
    }
    return true;
  }
}

registerProcessor("mixpilot-separation", SeparationProcessor);
