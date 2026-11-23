/// <reference path="./worklet-globals.d.ts" />
/** AudioWorklet wrapper around LookaheadLimiter. Registered as "mixpilot-limiter". */
import { LookaheadLimiter } from "./limiter";

class LimiterProcessor extends AudioWorkletProcessor {
  private limiter: LookaheadLimiter | null = null;
  private channels = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent) => {
      if (e.data?.type === "getGainReduction") {
        this.port.postMessage({
          type: "gainReduction",
          db: this.limiter?.takeGainReductionDb() ?? 0,
          latencySamples: this.limiter?.latencySamples ?? 0,
        });
      }
    };
  }

  override process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    if (output.length === 0) return true;
    if (!this.limiter || this.channels !== output.length) {
      this.channels = output.length;
      this.limiter = new LookaheadLimiter({ sampleRate, channels: output.length });
    }
    for (let c = 0; c < output.length; c++) {
      const src = input[c] ?? input[0];
      if (src) output[c]!.set(src);
      else output[c]!.fill(0);
    }
    this.limiter.process(output);
    return true;
  }
}

registerProcessor("mixpilot-limiter", LimiterProcessor);
