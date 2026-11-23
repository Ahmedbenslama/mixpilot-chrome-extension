// Ground-truth harness: plays a benchmark mixture through the REAL MixEngine (worklet + message
// transport + worker + onnxruntime-web + DFN3) in real time, records the speech and music stems,
// and scores them against the known references with SI-SDR.
// Served by bench/web/serve.mjs; engine assets come from /dist (run `npm run build` first).
import { MixEngine } from "../../src/engine/engine";
import { DFN3, LATENCY_PRESETS } from "../../src/engine/protocol";

declare global {
  interface Window { runClip: (id: string) => Promise<unknown>; harnessReady: boolean }
}

const RECORDER = `
class Rec extends AudioWorkletProcessor {
  process(inputs) { const ch = inputs[0] && inputs[0][0]; this.port.postMessage(ch ? ch.slice() : new Float32Array(128)); return true; }
}
registerProcessor("rec", Rec);`;

async function loadWav(url: string): Promise<Float32Array> {
  const buf = await (await fetch(url)).arrayBuffer();
  const dv = new DataView(buf);
  let p = 12;
  let fmt = 0;
  while (p < dv.byteLength) {
    const id = String.fromCharCode(dv.getUint8(p), dv.getUint8(p + 1), dv.getUint8(p + 2), dv.getUint8(p + 3));
    const size = dv.getUint32(p + 4, true);
    if (id === "fmt ") fmt = dv.getUint16(p + 8, true);
    if (id === "data") {
      if (fmt !== 3) throw new Error("expected float32 WAV");
      return new Float32Array(buf.slice(p + 8, p + 8 + size));
    }
    p += 8 + size + (size & 1);
  }
  throw new Error("no data chunk");
}

function siSdr(est: Float32Array, ref: Float32Array): number {
  const n = Math.min(est.length, ref.length);
  let me = 0, mr = 0;
  for (let i = 0; i < n; i++) { me += est[i]!; mr += ref[i]!; }
  me /= n; mr /= n;
  let dot = 0, rr = 0;
  for (let i = 0; i < n; i++) { dot += (est[i]! - me) * (ref[i]! - mr); rr += (ref[i]! - mr) ** 2; }
  const a = dot / (rr + 1e-12);
  let tt = 0, ee = 0;
  for (let i = 0; i < n; i++) { const t = a * (ref[i]! - mr); const e = est[i]! - me - t; tt += t * t; ee += e * e; }
  return 10 * Math.log10((tt + 1e-12) / (ee + 1e-12));
}

function bestLag(sig: Float32Array, ref: Float32Array, maxLag: number): number {
  let best = 0, bestV = -Infinity;
  const n = Math.min(ref.length, sig.length - maxLag) - 1;
  for (let lag = 0; lag < maxLag; lag += 1) {
    let v = 0;
    for (let i = 0; i < n; i += 4) v += sig[i + lag]! * ref[i]!;
    if (v > bestV) { bestV = v; best = lag; }
  }
  return best;
}

window.runClip = async (id: string) => {
  const base = `/bench/audio/mix/${id}`;
  const [mix, speech, music] = await Promise.all([loadWav(`${base}/mix.wav`), loadWav(`${base}/speech.wav`), loadWav(`${base}/music.wav`)]);
  // sinkId "none": render in real time without playing through the speakers.
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive", sinkId: { type: "none" } } as AudioContextOptions);
  await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([RECORDER], { type: "text/javascript" })));
  const gate = ctx.createGain(); // input bus; the clip starts once separation is running
  const engine = new MixEngine(ctx, gate, { speechGain: 1, musicGain: 1, masterGain: 1, bypass: false }, "balanced", { base: `${location.origin}/dist/` });
  await engine.start();
  await ctx.resume();
  const t0 = performance.now();
  while (engine.snapshot().status !== "running") {
    if (performance.now() - t0 > 15000) throw new Error(`engine not running: ${engine.snapshot().status} ${engine.snapshot().statusDetail}`);
    await new Promise((r) => setTimeout(r, 50));
  }
  const rec = (node: AudioNode) => {
    const r = new AudioWorkletNode(ctx, "rec", { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1, channelCountMode: "explicit" });
    const chunks: Float32Array[] = [];
    r.port.onmessage = (e) => chunks.push(e.data);
    node.connect(r);
    return { chunks, stop: () => { node.disconnect(r); r.port.onmessage = null; } };
  };
  const recSpeech = rec(engine.speechGain);
  const recMusic = rec(engine.musicGain);
  const recInput = rec(gate);
  const buf = ctx.createBuffer(2, mix.length, 48000);
  buf.copyToChannel(mix as Float32Array<ArrayBuffer>, 0);
  buf.copyToChannel(mix as Float32Array<ArrayBuffer>, 1);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(gate);
  src.start();
  const D = DFN3.modelDelay + LATENCY_PRESETS.balanced;
  await new Promise((r) => setTimeout(r, (mix.length / 48000) * 1000 + 600));
  const snap = engine.snapshot();
  recSpeech.stop(); recMusic.stop(); recInput.stop();
  await engine.stop();
  await ctx.close();
  const cat = (cs: Float32Array[]) => { const n = cs.reduce((a, c) => a + c.length, 0); const o = new Float32Array(n); let p = 0; for (const c of cs) { o.set(c, p); p += c.length; } return o; };
  const inRec = cat(recInput.chunks), sRec = cat(recSpeech.chunks), mRec = cat(recMusic.chunks);
  // Clip start within the recordings (recorders started before the source).
  const start = bestLag(inRec, mix, 48000);
  const stemLagVsInput = bestLag(sRec.subarray(start), speech, 6000);
  const seg = (x: Float32Array, off: number) => x.subarray(off, off + mix.length);
  const s = seg(sRec, start + D), m = seg(mRec, start + D);
  return {
    id,
    measuredStemDelaySamples: stemLagVsInput,
    expectedDelaySamples: D,
    speechSiSdr: +siSdr(s, speech).toFixed(2),
    musicSiSdr: +siSdr(m, music).toFixed(2),
    mixSpeechSiSdr: +siSdr(mix, speech).toFixed(2),
    mixMusicSiSdr: +siSdr(mix, music).toFixed(2),
    underrunMs: snap.underrunMs,
    inferenceP95Ms: snap.inference?.p95Ms,
  };
};
window.harnessReady = true;
