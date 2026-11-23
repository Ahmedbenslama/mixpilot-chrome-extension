/** Constants and messages shared by the engine, its worker and its worklet. */

export const DFN3 = {
  sampleRate: 48000,
  hop: 480, // 10 ms
  stateSize: 45304,
  modelDelay: 1440, // measured: 30 ms between model input and aligned output (docs/MODEL_BENCHMARK.md)
  modelPath: "models/dfn3_stream.onnx",
  wasmPath: "ort/ort-wasm-simd-threaded.wasm",
} as const;

/** main -> worker */
export type WorkerInbound =
  | { type: "init"; port: MessagePort; modelUrl: string; wasmUrl: string }
  | { type: "stop" };

/** worker -> main */
export type WorkerOutbound =
  | { type: "ready"; loadMs: number }
  | { type: "error"; message: string }
  | {
      type: "stats";
      hops: number;
      droppedHops: number;
      runMsP50: number;
      runMsP95: number;
      runMsMax: number;
      queued: number;
    };

/** main -> separation worklet (over node.port) */
export type WorkletInbound =
  | { type: "connect"; port: MessagePort } // direct channel to the worker
  | { type: "enabled"; on: boolean }
  | { type: "ready"; on: boolean };

/** separation worklet -> main (over node.port), ~5 times per second */
export interface WorkletStats {
  type: "stats";
  stats: number[]; // StemMixer Stat block
  droppedLocalHops: number;
  staleHops: number;
}

export interface SeparationWorkletOptions {
  modelDelay: number;
  jitterAllowance: number;
}

/** Latency presets: extra buffering on top of the model's 30 ms, trading lip-sync for robustness. */
export const LATENCY_PRESETS = {
  low: 960, // +20 ms  -> 50 ms total processing delay
  balanced: 1920, // +40 ms -> 70 ms
  safe: 3840, // +80 ms -> 110 ms
} as const;
export type LatencyPreset = keyof typeof LATENCY_PRESETS;
