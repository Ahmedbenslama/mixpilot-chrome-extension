// In-browser timing benchmark for streaming separation candidates.
// Query params: ?frames=1500&configs=wasm1,wasm4,webgpu
import * as ort from "/node_modules/onnxruntime-web/dist/ort.all.min.mjs";

const logEl = document.getElementById("log");
const lines = [];
const log = (s) => { lines.push(s); logEl.textContent = lines.join("\n"); console.log(s); };

const params = new URLSearchParams(location.search);
const FRAMES = Number(params.get("frames") || 1500);
const CONFIGS = (params.get("configs") || "wasm1,wasm2,wasm4,webgpu").split(",");

ort.env.wasm.wasmPaths = "/node_modules/onnxruntime-web/dist/";
ort.env.logLevel = "error";

const MODELS = {
  dfn3_stream: {
    url: "/bench/models/dfn3_stream/dfn3_stream.onnx",
    hopMs: 10,
    feeds(state) {
      const frame = new Float32Array(480);
      for (let i = 0; i < 480; i++) frame[i] = 0.1 * Math.sin(state.t++ * 0.05) + 0.02 * (Math.random() - 0.5);
      return {
        input_frame: new ort.Tensor("float32", frame, [480]),
        states: state.states ?? new ort.Tensor("float32", new Float32Array(45304), [45304]),
        atten_lim_db: new ort.Tensor("float32", new Float32Array([0]), []),
      };
    },
    carry(state, out) { state.states = out.out_states; },
  },
  gtcrn: {
    url: "/bench/models/gtcrn/gtcrn_simple.onnx",
    hopMs: 16,
    feeds(state) {
      const mix = new Float32Array(257 * 2).map(() => Math.random() - 0.5);
      return {
        mix: new ort.Tensor("float32", mix, [1, 257, 1, 2]),
        conv_cache: state.conv ?? new ort.Tensor("float32", new Float32Array(2 * 16 * 16 * 33), [2, 1, 16, 16, 33]),
        tra_cache: state.tra ?? new ort.Tensor("float32", new Float32Array(2 * 3 * 16), [2, 3, 1, 1, 16]),
        inter_cache: state.inter ?? new ort.Tensor("float32", new Float32Array(2 * 33 * 16), [2, 1, 33, 16]),
      };
    },
    carry(state, out) { state.conv = out.conv_cache_out; state.tra = out.tra_cache_out; state.inter = out.inter_cache_out; },
  },
};

function pct(a, p) { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }

async function bench(modelName, config) {
  const m = MODELS[modelName];
  const opts = { graphOptimizationLevel: "all" };
  if (config.startsWith("wasm")) {
    ort.env.wasm.numThreads = Number(config.slice(4));
    opts.executionProviders = ["wasm"];
  } else {
    opts.executionProviders = ["webgpu"];
  }
  const t0 = performance.now();
  let sess;
  try {
    sess = await ort.InferenceSession.create(m.url, opts);
  } catch (e) {
    return { modelName, config, error: String(e).slice(0, 200) };
  }
  const createMs = performance.now() - t0;
  const state = { t: 0 };
  const times = [];
  const warm = 50;
  for (let i = 0; i < FRAMES + warm; i++) {
    const feeds = m.feeds(state);
    const a = performance.now();
    const out = await sess.run(feeds);
    const dt = performance.now() - a;
    m.carry(state, out);
    if (i >= warm) times.push(dt);
  }
  await sess.release();
  const med = pct(times, 0.5), p95 = pct(times, 0.95), p99 = pct(times, 0.99), max = Math.max(...times);
  return { modelName, config, createMs: +createMs.toFixed(0), medMs: +med.toFixed(3), p95Ms: +p95.toFixed(3),
           p99Ms: +p99.toFixed(3), maxMs: +max.toFixed(2), rtf: +(med / m.hopMs).toFixed(3), rtfP99: +(p99 / m.hopMs).toFixed(3) };
}

(async () => {
  log(`UA: ${navigator.userAgent}`);
  log(`crossOriginIsolated=${self.crossOriginIsolated} hardwareConcurrency=${navigator.hardwareConcurrency} webgpu=${!!navigator.gpu}`);
  log(`ort ${ort.env.versions?.web ?? "?"}; frames=${FRAMES}`);
  const results = [];
  for (const model of Object.keys(MODELS)) {
    for (const cfg of CONFIGS) {
      // threads can only be configured before the first wasm init -> reload per wasm thread count
      const r = await bench(model, cfg);
      results.push(r);
      log(JSON.stringify(r));
    }
  }
  window.__benchResults = results;
  log("DONE");
})();
