/**
 * MixEngine: the audio graph that lives in the offscreen document.
 *
 *  source ─┬─> [separation worklet] ─ out0 speech ──> speechGain ─┐
 *          │                         ─ out1 music  ──> musicGain  ─┼─> processed ─┐
 *          │                         ─ out3 fallback (unity) ──────┘              ├─> master ─> limiter ─> destination
 *          │                         ─ out2 original (latency-matched) ─> original ┘
 *          └─> direct (no delay; used only when separation is unavailable)
 *
 * The worker runs the model; the worklet assembles stems and handles late inference. They exchange
 * 10 ms hops over a direct MessageChannel (no SharedArrayBuffer: Chrome won't start tab capture in a
 * cross-origin-isolated document, and SAB needs isolation).
 * Speech and Music gains act on separate model outputs, never on EQ bands.
 */
import { blockLevelsDb } from "../shared/levels";
import { SeparationState, Stat } from "../audio/stem-mixer";
import {
  DFN3, LATENCY_PRESETS, type LatencyPreset, type SeparationWorkletOptions, type WorkerOutbound, type WorkletStats,
} from "./protocol";

export type SeparationStatus = "loading" | "priming" | "running" | "overloaded" | "unavailable" | "error";

export interface MixSettings {
  speechGain: number;
  musicGain: number;
  masterGain: number;
  bypass: boolean;
}

export interface EngineSnapshot {
  status: SeparationStatus;
  statusDetail: string | null;
  contextState: AudioContextState;
  sampleRate: number;
  /** Processing delay added by MixPilot (model + jitter buffer + limiter lookahead). */
  processingLatencyMs: number;
  outputLatencyMs: number;
  inference: { p50Ms: number; p95Ms: number; maxMs: number; hops: number; droppedMs: number; loadMs: number } | null;
  underrunMs: number;
  overloadEvents: number;
  headroomMs: number;
  minHeadroomMs: number;
  /** referenceDb = latency-matched original (what bypass plays), for level-matching checks. */
  levels: { inputDb: number; referenceDb: number; speechDb: number; musicDb: number; outputDb: number; outputPeakDb: number };
}

const RAMP_S = 0.03;
const LIMITER_LOOKAHEAD = 72; // samples, see LookaheadLimiter

function ramp(ctx: BaseAudioContext, p: AudioParam, v: number, t = RAMP_S): void {
  const now = ctx.currentTime;
  p.cancelScheduledValues(now);
  p.setValueAtTime(p.value, now);
  p.linearRampToValueAtTime(v, now + t);
}

function analyser(ctx: BaseAudioContext): AnalyserNode {
  const a = ctx.createAnalyser();
  a.fftSize = 2048;
  return a;
}

export class MixEngine {
  private worker: Worker | null = null;
  private sep: AudioWorkletNode | null = null;
  private workletStats: WorkletStats | null = null;
  private status: SeparationStatus = "loading";
  private statusDetail: string | null = null;
  private workerStats: Extract<WorkerOutbound, { type: "stats" }> | null = null;
  private loadMs = NaN;
  private readonly nodes: AudioNode[] = [];
  private readonly jitter: number;

  readonly speechGain: GainNode;
  readonly musicGain: GainNode;
  private readonly processed: GainNode;
  private readonly original: GainNode;
  private readonly direct: GainNode;
  readonly master: GainNode;
  private limiter: AudioWorkletNode | null = null;
  private readonly aIn: AnalyserNode;
  private readonly aRef: AnalyserNode;
  private readonly aSpeech: AnalyserNode;
  private readonly aMusic: AnalyserNode;
  private readonly aOut: AnalyserNode;
  private settings: MixSettings;

  constructor(
    private readonly ctx: AudioContext,
    private readonly source: AudioNode,
    initial: MixSettings,
    latency: LatencyPreset = "balanced",
    private readonly urls: { base: string } = { base: "" },
  ) {
    this.settings = { ...initial };
    this.jitter = LATENCY_PRESETS[latency];
    const g = (v: number) => { const n = ctx.createGain(); n.gain.value = v; this.nodes.push(n); return n; };
    this.speechGain = g(initial.speechGain);
    this.musicGain = g(initial.musicGain);
    this.processed = g(initial.bypass ? 0 : 1);
    this.original = g(initial.bypass ? 1 : 0);
    this.direct = g(0);
    this.master = g(initial.masterGain);
    this.aIn = analyser(ctx);
    this.aRef = analyser(ctx);
    this.aSpeech = analyser(ctx);
    this.aMusic = analyser(ctx);
    this.aOut = analyser(ctx);
    this.nodes.push(this.aIn, this.aRef, this.aSpeech, this.aMusic, this.aOut);
  }

  private url(path: string): string {
    return new URL(path, this.urls.base || globalThis.location.href).href;
  }

  /** Builds the graph. Audio plays (latency-matched original) while the model loads. */
  async start(): Promise<void> {
    const { ctx, source } = this;
    await ctx.audioWorklet.addModule(this.url("limiter.worklet.js"));
    this.limiter = new AudioWorkletNode(ctx, "mixpilot-limiter", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit",
    });
    this.nodes.push(this.limiter);
    this.master.connect(this.limiter).connect(ctx.destination);
    this.limiter.connect(this.aOut);
    source.connect(this.aIn);
    source.connect(this.direct).connect(this.master);
    this.processed.connect(this.master);
    this.original.connect(this.master);

    if (ctx.sampleRate !== DFN3.sampleRate) {
      this.fail("unavailable", `Audio runs at ${ctx.sampleRate} Hz; the model needs ${DFN3.sampleRate} Hz. Playing original audio.`);
      return;
    }

    await ctx.audioWorklet.addModule(this.url("separation.worklet.js"));
    const opts: SeparationWorkletOptions = { modelDelay: DFN3.modelDelay, jitterAllowance: this.jitter };
    this.sep = new AudioWorkletNode(ctx, "mixpilot-separation", {
      numberOfInputs: 1, numberOfOutputs: 4, outputChannelCount: [2, 2, 2, 2],
      channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers",
      processorOptions: opts,
    });
    this.nodes.push(this.sep);
    source.connect(this.sep);
    this.sep.connect(this.speechGain, 0).connect(this.processed);
    this.sep.connect(this.musicGain, 1).connect(this.processed);
    this.sep.connect(this.original, 2);
    this.sep.connect(this.aRef, 2);
    this.sep.connect(this.processed, 3);
    this.speechGain.connect(this.aSpeech);
    this.musicGain.connect(this.aMusic);
    this.sep.port.onmessage = (e: MessageEvent<WorkletStats>) => { if (e.data?.type === "stats") this.workletStats = e.data; };

    // Direct worklet <-> worker channel: audio hops never pass through this (main) thread.
    const channel = new MessageChannel();
    this.sep.port.postMessage({ type: "connect", port: channel.port1 }, [channel.port1]);
    this.sep.port.postMessage({ type: "enabled", on: true });
    this.worker = new Worker(this.url("separation.worker.js"), { type: "module" });
    this.worker.onmessage = (e: MessageEvent<WorkerOutbound>) => this.onWorker(e.data);
    this.worker.onerror = (e) => this.fail("error", `Separation worker crashed: ${e.message || "unknown error"}. Playing original audio.`);
    this.worker.postMessage(
      { type: "init", port: channel.port2, modelUrl: this.url(DFN3.modelPath), wasmUrl: this.url(DFN3.wasmPath) },
      [channel.port2],
    );
  }

  private onWorker(m: WorkerOutbound): void {
    if (m.type === "ready") {
      this.loadMs = m.loadMs;
      this.sep?.port.postMessage({ type: "ready", on: true });
    } else if (m.type === "stats") {
      this.workerStats = m;
    } else if (m.type === "error") {
      this.fail("error", `${m.message}. Playing original audio.`);
    }
  }

  /** Separation can't run: switch to the zero-latency direct path (no stems, original audio). */
  private fail(status: "unavailable" | "error", detail: string): void {
    this.status = status;
    this.statusDetail = detail;
    this.sep?.port.postMessage({ type: "enabled", on: false });
    this.worker?.terminate();
    this.worker = null;
    ramp(this.ctx, this.processed.gain, 0);
    ramp(this.ctx, this.original.gain, 0);
    ramp(this.ctx, this.direct.gain, 1);
  }

  get separationAvailable(): boolean {
    return this.status !== "unavailable" && this.status !== "error";
  }

  setMix(next: Partial<Omit<MixSettings, "bypass">>): void {
    this.settings = { ...this.settings, ...next };
    if (next.speechGain !== undefined) ramp(this.ctx, this.speechGain.gain, next.speechGain);
    if (next.musicGain !== undefined) ramp(this.ctx, this.musicGain.gain, next.musicGain);
    if (next.masterGain !== undefined) ramp(this.ctx, this.master.gain, next.masterGain);
  }

  /** A/B: original and processed paths share the same latency, so switching never jumps in time. */
  setBypass(on: boolean): void {
    this.settings.bypass = on;
    if (!this.separationAvailable) return;
    ramp(this.ctx, this.processed.gain, on ? 0 : 1);
    ramp(this.ctx, this.original.gain, on ? 1 : 0);
  }

  snapshot(): EngineSnapshot {
    const sr = this.ctx.sampleRate;
    const ms = (samples: number) => (samples / sr) * 1000;
    const st = this.workletStats?.stats ?? [];
    const stat = (i: number) => st[i] ?? 0;
    if (this.separationAvailable) {
      const s = stat(Stat.State) as SeparationState;
      this.status = Number.isNaN(this.loadMs) ? "loading"
        : s === SeparationState.Running ? "running"
        : s === SeparationState.Overloaded ? "overloaded"
        : "priming";
      this.statusDetail = this.status === "overloaded" ? "This device is not keeping up; playing original audio until it recovers." : null;
    }
    const minHead = stat(Stat.MinHeadroomSamples);
    const lvl = (a: AnalyserNode) => {
      const b = new Float32Array(a.fftSize);
      a.getFloatTimeDomainData(b);
      return blockLevelsDb(b);
    };
    const out = lvl(this.aOut);
    const ws = this.workerStats;
    return {
      status: this.status,
      statusDetail: this.statusDetail,
      contextState: this.ctx.state,
      sampleRate: sr,
      processingLatencyMs: ms((this.separationAvailable ? DFN3.modelDelay + this.jitter : 0) + LIMITER_LOOKAHEAD),
      outputLatencyMs: (this.ctx.outputLatency || 0) * 1000,
      inference: ws ? {
        p50Ms: ws.runMsP50, p95Ms: ws.runMsP95, maxMs: ws.runMsMax, hops: ws.hops,
        droppedMs: ms((ws.droppedHops + (this.workletStats?.droppedLocalHops ?? 0)) * DFN3.hop), loadMs: this.loadMs,
      } : null,
      underrunMs: ms(stat(Stat.UnderrunSamples)),
      overloadEvents: stat(Stat.OverloadEvents),
      headroomMs: ms(stat(Stat.HeadroomSamples)),
      minHeadroomMs: minHead === 0x7fffffff || !this.workletStats ? NaN : ms(minHead),
      levels: {
        inputDb: lvl(this.aIn).rmsDb,
        referenceDb: (this.sep && this.separationAvailable ? lvl(this.aRef) : lvl(this.aIn)).rmsDb,
        speechDb: lvl(this.aSpeech).rmsDb,
        musicDb: lvl(this.aMusic).rmsDb,
        outputDb: out.rmsDb,
        outputPeakDb: out.peakDb,
      },
    };
  }

  async stop(): Promise<void> {
    this.worker?.postMessage({ type: "stop" });
    this.worker?.terminate();
    this.worker = null;
    this.sep?.port.close();
    this.limiter?.port.close();
    for (const n of this.nodes) {
      try { n.disconnect(); } catch { /* already disconnected */ }
    }
    try { this.source.disconnect(); } catch { /* already disconnected */ }
  }
}
