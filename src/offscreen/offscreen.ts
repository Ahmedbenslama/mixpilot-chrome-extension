/**
 * Offscreen document: owns the captured MediaStream and the AudioContext.
 * Phase A graph (passthrough): source -> master gain -> lookahead limiter (worklet) -> destination.
 * Routing to the destination is what keeps the tab audible after tabCapture.
 */
import { clampGain, MASTER_GAIN_MAX } from "../shared/gain";
import { blockLevelsDb } from "../shared/levels";
import type { EngineStats, OffscreenEvent, OffscreenRequest, OffscreenResponse } from "../shared/messages";

interface Graph {
  stream: MediaStream;
  ctx: AudioContext;
  source: MediaStreamAudioSourceNode;
  master: GainNode;
  limiter: AudioWorkletNode;
  analyser: AnalyserNode;
  inputAnalyser: AnalyserNode;
}

let graph: Graph | null = null;

async function startCapture(streamId: string, masterGain: number): Promise<OffscreenResponse> {
  await stopCapture();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } } as MediaTrackConstraints,
    video: false,
  });
  try {
    const ctx = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
    const source = ctx.createMediaStreamSource(stream);
    const master = ctx.createGain();
    master.gain.value = clampGain(masterGain, MASTER_GAIN_MAX) ?? 1;
    // Peak protection: unity gain below -1 dBFS (no make-up gain), 1.5 ms lookahead.
    await ctx.audioWorklet.addModule(chrome.runtime.getURL("limiter.worklet.js"));
    const limiter = new AudioWorkletNode(ctx, "mixpilot-limiter", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(master).connect(limiter).connect(ctx.destination);
    limiter.connect(analyser); // metering taps only; not connected onward
    const inputAnalyser = ctx.createAnalyser();
    inputAnalyser.fftSize = 2048;
    source.connect(inputAnalyser);
    await ctx.resume();
    graph = { stream, ctx, source, master, limiter, analyser, inputAnalyser };

    for (const track of stream.getAudioTracks()) {
      track.addEventListener("ended", () => notifyEnded("Chrome ended the tab capture."), { once: true });
    }
    return { ok: true };
  } catch (e) {
    for (const t of stream.getTracks()) t.stop();
    throw e;
  }
}

async function stopCapture(): Promise<OffscreenResponse> {
  const g = graph;
  graph = null;
  if (!g) return { ok: true };
  for (const node of [g.source, g.master, g.limiter, g.analyser, g.inputAnalyser]) {
    try {
      node.disconnect();
    } catch {
      /* already disconnected */
    }
  }
  g.limiter.port.close();
  for (const t of g.stream.getTracks()) t.stop();
  if (g.ctx.state !== "closed") await g.ctx.close();
  return { ok: true };
}

function setMasterGain(value: unknown): OffscreenResponse {
  if (!graph) return { ok: false, error: "Audio is not active." };
  const gain = clampGain(value, MASTER_GAIN_MAX);
  if (gain === null) return { ok: false, error: "Invalid volume value." };
  graph.master.gain.setTargetAtTime(gain, graph.ctx.currentTime, 0.025);
  return { ok: true };
}

function getStats(): OffscreenResponse {
  if (!graph) return { ok: false, error: "Audio is not active." };
  // Both taps are read in the same task, so they cover the same render window.
  const out = new Float32Array(graph.analyser.fftSize);
  const inp = new Float32Array(graph.inputAnalyser.fftSize);
  graph.analyser.getFloatTimeDomainData(out);
  graph.inputAnalyser.getFloatTimeDomainData(inp);
  const { rmsDb, peakDb } = blockLevelsDb(out);
  const stats: EngineStats = {
    contextState: graph.ctx.state,
    sampleRate: graph.ctx.sampleRate,
    baseLatencyMs: graph.ctx.baseLatency * 1000,
    outputLatencyMs: (graph.ctx.outputLatency || 0) * 1000,
    inputRmsDb: blockLevelsDb(inp).rmsDb,
    outputRmsDb: rmsDb,
    outputPeakDb: peakDb,
  };
  return { ok: true, stats };
}

function notifyEnded(reason: string): void {
  if (!graph) return;
  stopCapture().finally(() => {
    chrome.runtime.sendMessage({ target: "background", type: "CAPTURE_ENDED", reason } satisfies OffscreenEvent).catch(() => undefined);
  });
}

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  const msg = raw as OffscreenRequest;
  if (msg?.target !== "offscreen") return false;
  switch (msg.type) {
    case "OFFSCREEN_START_CAPTURE":
      startCapture(msg.streamId, msg.masterGain).then(sendResponse, async (e) => {
        await stopCapture();
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) } satisfies OffscreenResponse);
      });
      return true;
    case "OFFSCREEN_STOP_CAPTURE":
      stopCapture().then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    case "OFFSCREEN_SET_MASTER_GAIN":
      sendResponse(setMasterGain(msg.value));
      return false;
    case "OFFSCREEN_GET_STATS":
      sendResponse(getStats());
      return false;
  }
  return false;
});
