/**
 * Offscreen document: owns the captured MediaStream, the AudioContext and the MixEngine.
 * Routing the engine to ctx.destination is what keeps the tab audible after tabCapture.
 */
import { MixEngine } from "../engine/engine";
import { clampGain, MASTER_GAIN_MAX, STEM_GAIN_MAX } from "../shared/gain";
import type { MixUpdate, OffscreenEvent, OffscreenRequest, OffscreenResponse, Preferences } from "../shared/messages";

interface Session {
  stream: MediaStream;
  ctx: AudioContext;
  engine: MixEngine;
}

let session: Session | null = null;

function sanitizeMix(mix: MixUpdate): MixUpdate {
  const out: MixUpdate = {};
  const s = clampGain(mix.speechGain, STEM_GAIN_MAX);
  const m = clampGain(mix.musicGain, STEM_GAIN_MAX);
  const g = clampGain(mix.masterGain, MASTER_GAIN_MAX);
  if (mix.speechGain !== undefined && s !== null) out.speechGain = s;
  if (mix.musicGain !== undefined && m !== null) out.musicGain = m;
  if (mix.masterGain !== undefined && g !== null) out.masterGain = g;
  return out;
}

async function startCapture(streamId: string, prefs: Preferences, bypass: boolean): Promise<OffscreenResponse> {
  await stopCapture();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } } as MediaTrackConstraints,
    video: false,
  });
  let ctx: AudioContext | null = null;
  try {
    // 48 kHz to match the model; Chrome resamples the tab stream if needed.
    ctx = new AudioContext({ latencyHint: "interactive", sampleRate: 48000 });
    const source = ctx.createMediaStreamSource(stream);
    const engine = new MixEngine(ctx, source, {
      speechGain: prefs.speechGain, musicGain: prefs.musicGain, masterGain: prefs.masterGain, bypass,
    }, prefs.latency, { base: chrome.runtime.getURL("/") });
    await engine.start();
    await ctx.resume();
    session = { stream, ctx, engine };
    for (const track of stream.getAudioTracks()) {
      track.addEventListener("ended", () => notifyEnded("Chrome ended the tab capture."), { once: true });
    }
    return { ok: true };
  } catch (e) {
    for (const t of stream.getTracks()) t.stop();
    if (ctx && ctx.state !== "closed") await ctx.close();
    throw e;
  }
}

async function stopCapture(): Promise<OffscreenResponse> {
  const s = session;
  session = null;
  if (!s) return { ok: true };
  await s.engine.stop();
  for (const t of s.stream.getTracks()) t.stop();
  if (s.ctx.state !== "closed") await s.ctx.close();
  return { ok: true };
}

function notifyEnded(reason: string): void {
  if (!session) return;
  stopCapture().finally(() => {
    chrome.runtime.sendMessage({ target: "background", type: "CAPTURE_ENDED", reason } satisfies OffscreenEvent).catch(() => undefined);
  });
}

const inactive: OffscreenResponse = { ok: false, error: "Audio is not active." };

chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
  const msg = raw as OffscreenRequest;
  if (msg?.target !== "offscreen") return false;
  switch (msg.type) {
    case "OFFSCREEN_START_CAPTURE":
      startCapture(msg.streamId, msg.prefs, msg.bypass).then(sendResponse, async (e) => {
        await stopCapture();
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) } satisfies OffscreenResponse);
      });
      return true;
    case "OFFSCREEN_STOP_CAPTURE":
      stopCapture().then(sendResponse, (e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    case "OFFSCREEN_SET_MIX":
      if (!session) sendResponse(inactive);
      else { session.engine.setMix(sanitizeMix(msg.mix)); sendResponse({ ok: true }); }
      return false;
    case "OFFSCREEN_SET_BYPASS":
      if (!session) sendResponse(inactive);
      else { session.engine.setBypass(Boolean(msg.on)); sendResponse({ ok: true }); }
      return false;
    case "OFFSCREEN_GET_STATS":
      sendResponse(session ? { ok: true, stats: session.engine.snapshot() } : inactive);
      return false;
    case "OFFSCREEN_IDENTIFY_MUSIC":
      if (!session) { sendResponse(inactive); return false; }
      session.engine.identifyMusic(msg.token).then(
        (result) => sendResponse({ ok: true, result }),
        (error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
      );
      return true;
  }
  return false;
});
