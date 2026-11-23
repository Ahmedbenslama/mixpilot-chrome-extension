// Phase B end-to-end: live separation on a real YouTube video.
//   npm run build && node tests/e2e/separation.e2e.mjs [--seconds=60]
// Video: "Tears of Steel" (Blender Foundation, CC BY 3.0): dialogue + score + effects.
// Measures model load, inference timing, underruns, CPU (renderer process) and memory, and checks
// that the stem gains act independently and that unity/bypass are level-matched.
// It cannot judge audible quality — see tests/MANUAL_QA.md.
import { DIST, launch, sleep } from "./harness.mjs";

const VIDEO = process.env.MIXPILOT_E2E_VIDEO || "https://www.youtube.com/watch?v=R6MlUcmOul8";
const SECONDS = Number(process.argv.find((a) => a.startsWith("--seconds="))?.split("=")[1] ?? 45);
const h = await launch();
const { c, ev, attach, pages, tabTargets, check } = h;
const report = {};

try {
  const ID = await h.loadExtension(DIST);
  const ctl = (await c.send("Target.createTarget", { url: `chrome-extension://${ID}/popup.html`, background: true })).result.targetId;
  const controlPages = new Set([ctl]);
  await sleep(1000);
  const C = await attach(ctl);
  const msg = (m) => ev(C, `chrome.runtime.sendMessage(${JSON.stringify(m)})`);
  const stats = async () => (await msg({ type: "GET_ENGINE_STATS" }))?.state;

  const ytId = (await c.send("Target.createTarget", { url: VIDEO })).result.targetId;
  await sleep(7000);
  let Y = await attach(ytId);
  if (String(await ev(Y, "location.href")).includes("consent.")) {
    await ev(Y, `[...document.querySelectorAll('button')].find(b=>/reject all/i.test(b.innerText))?.click()`, true);
    await sleep(6000);
    Y = await attach(ytId);
  }
  const play = () => ev(Y, `(async()=>{const v=document.querySelector('video'); if(!v) return 'no-video'; v.muted=false; v.volume=1; if (v.currentTime < 60) v.currentTime = 60; await v.play().catch(()=>{}); await new Promise(r=>setTimeout(r,800)); return {paused:v.paused,t:+v.currentTime.toFixed(1)}})()`, true);
  const videoOk = () => ev(Y, `(()=>{const v=document.querySelector('video'); const p=document.querySelector('#movie_player'); return !!v && !v.paused && !p?.classList.contains('ad-showing')})()`);
  console.log("video:", JSON.stringify(await play()));

  // CPU of all renderer + utility (audio service) processes, before enabling
  const cpuTotals = async () => {
    const r = await c.send("SystemInfo.getProcessInfo");
    const t = {};
    for (const p of r.result?.processInfo ?? []) t[p.type] = (t[p.type] ?? 0) + p.cpuTime;
    return t;
  };
  const cpuOver = async (ms) => {
    const a = await cpuTotals(); await sleep(ms); const b = await cpuTotals();
    const out = {};
    for (const k of Object.keys(b)) out[k] = +(((b[k] - (a[k] ?? 0)) / (ms / 1000)) * 100).toFixed(1);
    return out; // % of one core
  };
  report.cpuPlaybackOnly = await cpuOver(8000);

  // Enable via the real toolbar action
  await c.send("Target.activateTarget", { targetId: ytId });
  const tabT = (await tabTargets()).find((t) => t.url.includes("youtube.com/watch"));
  await c.send("Extensions.triggerAction", { id: ID, targetId: tabT.targetId });
  await sleep(800);
  const popT = (await pages()).find((t) => t.url === `chrome-extension://${ID}/popup.html` && !controlPages.has(t.targetId));
  const t0 = Date.now();
  const r1 = await ev(await attach(popT.targetId), `chrome.runtime.sendMessage({type:"START_CAPTURE"})`, true);
  check("enable starts capture", r1?.ok === true, r1?.error ?? r1?.message);
  await play();

  let s = await stats();
  const statusTrail = [];
  while (Date.now() - t0 < 20000 && s?.status !== "running") {
    if (statusTrail.at(-1) !== s?.status) statusTrail.push(s?.status);
    await sleep(200);
    s = await stats();
  }
  statusTrail.push(s?.status);
  const toRunningMs = Date.now() - t0;
  check("separation reaches 'running' (model loaded in the worker, stems flowing)", s?.status === "running",
    { statusTrail, toRunningMs, modelLoadMs: Math.round(s?.inference?.loadMs ?? NaN), detail: s?.statusDetail });
  report.processingLatencyMs = s?.processingLatencyMs;
  report.outputLatencyMs = s?.outputLatencyMs;

  // Memory: JS heap + ArrayBuffer/WASM backing stores of the offscreen document and its worker (CDP)
  async function memoryMB() {
    const out = {};
    const off = (await pages()).find((t) => t.url === `chrome-extension://${ID}/offscreen.html`);
    if (!off) return out;
    const O = await attach(off.targetId);
    const heap = async (sess) => {
      const u = (await c.send("Runtime.getHeapUsage", {}, sess)).result ?? {};
      return { jsHeapMB: +((u.usedSize ?? 0) / 1048576).toFixed(1), backingStoreMB: +((u.backingStorageSize ?? 0) / 1048576).toFixed(1) };
    };
    out.offscreen = await heap(O);
    // Dedicated workers are only reachable through auto-attach on their parent document.
    const mark = c.events.length;
    await c.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, O);
    await sleep(500);
    const att = c.events.slice(mark).find((e) => e.method === "Target.attachedToTarget" && e.params.targetInfo.type === "worker");
    if (att) {
      await c.send("Runtime.enable", {}, att.params.sessionId);
      out.worker = await heap(att.params.sessionId);
      // WASM linear memory (ORT heap incl. model weights) as seen from inside the worker
      const r = await c.send("Runtime.evaluate", { expression: "0", returnByValue: true }, att.params.sessionId);
      void r;
    }
    return out;
  }
  report.memoryAtStart = await memoryMB();

  // Sustained run: underruns, overloads, inference timing, CPU
  const before = await stats();
  const cpuActive = await cpuOver(SECONDS * 1000);
  const after = await stats();
  report.cpuWithSeparation = cpuActive;
  report.memoryAfterRun = await memoryMB();
  report.inference = after?.inference;
  const underrunMs = +(after.underrunMs - before.underrunMs).toFixed(1);
  check(`no audible fallbacks over ${SECONDS} s of playback (underruns and overload events)`,
    underrunMs === 0 && after.overloadEvents === before.overloadEvents && after.status === "running",
    { underrunMs, overloadEvents: after.overloadEvents - before.overloadEvents, status: after.status, headroomMs: +after.headroomMs.toFixed(1), minHeadroomMs: +(after.minHeadroomMs ?? NaN).toFixed?.(1) });
  check("inference keeps up with real time in the extension (p95 < 10 ms per 10 ms hop)", after.inference?.p95Ms < 10,
    { p50Ms: +after.inference?.p50Ms.toFixed(2), p95Ms: +after.inference?.p95Ms.toFixed(2), maxMs: +after.inference?.maxMs.toFixed(2), droppedMs: after.inference?.droppedMs });

  // Level relations (median over blocks with signal)
  async function relation(fn, n = 16) {
    const xs = [];
    for (let i = 0; i < n; i++) {
      const st = await stats();
      if (await videoOk() && Number.isFinite(st.levels.referenceDb) && st.levels.referenceDb > -55 && st.levels.outputPeakDb < -2) xs.push(fn(st.levels));
      await sleep(150);
    }
    xs.sort((a, b) => a - b);
    return xs.length ? +xs[Math.floor(xs.length / 2)].toFixed(2) : NaN;
  }
  await msg({ type: "SET_MIX", mix: { speechGain: 1, musicGain: 1, masterGain: 1 } });
  await sleep(400);
  const unity = await relation((l) => l.outputDb - l.referenceDb);
  check("speech 100% + music 100% reproduces the original level (stems sum to the original)", Math.abs(unity) < 0.5 && (await stats()).status === "running", { outputMinusReferenceDb: unity });

  await msg({ type: "SET_BYPASS", on: true });
  await sleep(400);
  const byp = await relation((l) => l.outputDb - l.referenceDb);
  check("A/B original is level-matched to the latency-matched original", Math.abs(byp) < 0.5, { outputMinusReferenceDb: byp });
  await msg({ type: "SET_BYPASS", on: false });
  await sleep(400);

  // Independence: mute each stem and look at the stem meters + output
  await msg({ type: "SET_MIX", mix: { speechGain: 0, musicGain: 1 } });
  await sleep(500);
  const sMuted = await stats();
  await msg({ type: "SET_MIX", mix: { speechGain: 1, musicGain: 0 } });
  await sleep(500);
  const mMuted = await stats();
  await msg({ type: "SET_MIX", mix: { speechGain: 1, musicGain: 1 } });
  const silent = (db) => db === null || db === -Infinity || db < -100;
  const audible = (db) => Number.isFinite(db) && db > -70;
  check("speech 0% silences the speech stem while the music stem keeps playing (separation running)",
    sMuted.status === "running" && silent(sMuted.levels.speechDb) && audible(sMuted.levels.musicDb),
    { status: sMuted.status, speechDb: sMuted.levels.speechDb, musicDb: sMuted.levels.musicDb, outputDb: sMuted.levels.outputDb });
  check("music 0% silences the music stem while the speech stem keeps playing (separation running)",
    mMuted.status === "running" && silent(mMuted.levels.musicDb) && audible(mMuted.levels.speechDb),
    { status: mMuted.status, speechDb: mMuted.levels.speechDb, musicDb: mMuted.levels.musicDb, outputDb: mMuted.levels.outputDb });

  // Overload fallback: stall the inference worker's thread for 6 s (CDP can't CPU-throttle workers),
  // check that audio keeps playing via the latency-matched original, and that separation recovers.
  {
    const off = (await pages()).find((t) => t.url === `chrome-extension://${ID}/offscreen.html`);
    const O = await attach(off.targetId);
    const mark = c.events.length;
    await c.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, O);
    await sleep(500);
    const att = c.events.slice(mark).find((e) => e.method === "Target.attachedToTarget" && e.params.targetInfo.type === "worker");
    if (!att) {
      check("overload fallback (worker stalled)", false, "worker target not found");
    } else {
      const W = att.params.sessionId;
      await c.send("Runtime.enable", {}, W);
      const before = await stats();
      const stall = c.send("Runtime.evaluate", { expression: "(()=>{const t=performance.now(); while(performance.now()-t<6000){} return 1})()" }, W);
      const seen = new Set();
      let minOut = Infinity;
      for (let i = 0; i < 25; i++) {
        await sleep(200);
        const st = await stats();
        seen.add(st.status);
        if (await videoOk()) minOut = Math.min(minOut, st.levels.outputDb);
      }
      await stall;
      let back = null;
      const tRel = Date.now();
      for (let i = 0; i < 60 && back !== "running"; i++) { await sleep(200); back = (await stats()).status; }
      const after = await stats();
      check("stalled inference falls back to the original audio (keeps playing) and recovers automatically",
        seen.has("overloaded") && Number.isFinite(minOut) && minOut > -60 && back === "running",
        { statusesDuringStall: [...seen], minOutputDbDuringStall: +minOut.toFixed(1), recoveredAfterMs: Date.now() - tRel,
          statusAfter: back, overloadEvents: after.overloadEvents - before.overloadEvents, droppedMs: after.inference?.droppedMs });
    }
  }

  // How much of the programme the model assigns to speech vs music over time (diagnostic only)
  const split = [];
  for (let i = 0; i < 20; i++) {
    const st = await stats();
    const f = (x) => (Number.isFinite(x) ? +x.toFixed(1) : null);
    if (Number.isFinite(st.levels.inputDb) && st.levels.inputDb > -55) split.push([f(st.levels.speechDb), f(st.levels.musicDb)]);
    await sleep(250);
  }
  report.speechMusicLevelSamples = split;

  const r2 = await msg({ type: "STOP_CAPTURE" });
  await sleep(800);
  check("stop releases the engine (worker, worklets, context, offscreen document)", r2?.ok && !(await pages()).some((t) => t.url.endsWith("/offscreen.html")) && !(await pages()).some((t) => t.type === "worker" && t.url.includes(ID)));

  const errs = c.events.filter((e) => e.sessionId !== Y && (e.method === "Runtime.exceptionThrown" || (e.method === "Runtime.consoleAPICalled" && e.params.type === "error")));
  check("no exceptions or console errors in extension contexts", errs.length === 0, errs.map((e) => JSON.stringify(e.params).slice(0, 300)));
  console.log("\nREPORT", JSON.stringify(report, null, 1));
} finally {
  console.log(`\n${h.results.filter((r) => r.pass).length}/${h.results.length} checks passed`);
  await h.close();
  process.exitCode = h.results.every((r) => r.pass) ? 0 : 1;
}
