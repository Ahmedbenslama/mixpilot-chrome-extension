/**
 * Inference worker: runs the DeepFilterNet3 streaming graph (bundled ONNX Runtime Web, WASM, 1 thread)
 * on 10 ms hops received from the AudioWorklet over a direct MessagePort, and sends each hop back
 * with the speech estimate written into the same (transferred) buffer.
 */
import * as ort from "onnxruntime-web/wasm";
import { HopQueue, percentile, type HopMessage, type HopReturn } from "../audio/hop-bridge";
import { DFN3, type WorkerInbound, type WorkerOutbound } from "./protocol";

const MAX_BACKLOG_HOPS = 12; // 120 ms; beyond this the oldest hops are dropped

let link: MessagePort | null = null;
let run: ((frame: Float32Array) => Promise<Float32Array>) | null = null;
const queue = new HopQueue(DFN3.hop, MAX_BACKLOG_HOPS);
const runMs: number[] = [];
let hops = 0;
let busy = false;
let lastStats = 0;

function post(msg: WorkerOutbound): void {
  (self as unknown as Worker).postMessage(msg);
}

function sendBack(m: HopMessage, dropped: boolean): void {
  const ret: HopReturn = { i: m.i, buf: m.buf, dropped };
  link?.postMessage(ret, [m.buf.buffer]);
}

async function createModel(modelUrl: string, wasmUrl: string) {
  ort.env.wasm.numThreads = 1; // measured: threads add sync overhead for this small per-hop graph
  ort.env.wasm.proxy = false;
  ort.env.wasm.wasmPaths = { wasm: wasmUrl };
  ort.env.logLevel = "error";
  const t0 = performance.now();
  const session = await ort.InferenceSession.create(modelUrl, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  const loadMs = performance.now() - t0;
  const zeroState = () => new ort.Tensor("float32", new Float32Array(DFN3.stateSize), [DFN3.stateSize]);
  let states: ort.Tensor = zeroState();
  const atten = new ort.Tensor("float32", new Float32Array([0]), []);
  const runFrame = async (frame: Float32Array): Promise<Float32Array> => {
    const out = await session.run({ input_frame: new ort.Tensor("float32", frame, [DFN3.hop]), states, atten_lim_db: atten });
    states = out.out_states as ort.Tensor;
    return (out.enhanced_audio_frame as ort.Tensor).data as Float32Array;
  };
  for (let i = 0; i < 5; i++) await runFrame(new Float32Array(DFN3.hop)); // warm-up
  states = zeroState();
  return { runFrame, loadMs };
}

async function drain(): Promise<void> {
  if (busy || !run) return;
  busy = true;
  try {
    for (;;) {
      const { run: next, drop } = queue.next();
      for (const d of drop) sendBack(d, true);
      if (!next) break;
      const t0 = performance.now();
      const y = await run(next.buf);
      runMs.push(performance.now() - t0);
      if (runMs.length > 1000) runMs.splice(0, runMs.length - 1000);
      next.buf.set(y);
      sendBack(next, false);
      hops++;
    }
  } catch (e) {
    post({ type: "error", message: `Inference failed: ${e instanceof Error ? e.message : String(e)}` });
    run = null;
  } finally {
    busy = false;
  }
  const now = performance.now();
  if (now - lastStats > 500) {
    lastStats = now;
    post({
      type: "stats", hops, droppedHops: queue.droppedHops,
      runMsP50: percentile(runMs, 0.5), runMsP95: percentile(runMs, 0.95),
      runMsMax: runMs.length ? Math.max(...runMs) : NaN, queued: queue.length,
    });
  }
}

self.onmessage = async (e: MessageEvent<WorkerInbound>) => {
  const msg = e.data;
  if (msg.type === "init") {
    link = msg.port;
    // Until the model is ready, hand buffers straight back as dropped (the worklet plays the original).
    link.onmessage = (ev: MessageEvent<HopMessage>) => {
      if (!run) { sendBack(ev.data, true); return; }
      queue.push(ev.data);
      void drain();
    };
    try {
      const model = await createModel(msg.modelUrl, msg.wasmUrl);
      run = model.runFrame;
      post({ type: "ready", loadMs: model.loadMs });
    } catch (err) {
      post({ type: "error", message: `Model failed to load: ${err instanceof Error ? err.message : String(err)}` });
    }
  } else if (msg.type === "stop") {
    run = null;
    link?.close();
    close();
  }
};
