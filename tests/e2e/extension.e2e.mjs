// End-to-end lifecycle + audio-flow test for the built extension (dist/).
//
//   npm run build && node tests/e2e/extension.e2e.mjs
//
// Launches an isolated, throwaway Chrome profile with remote debugging, loads dist/ via
// CDP Extensions.loadUnpacked (needs --enable-unsafe-extension-debugging), simulates a toolbar
// click with Extensions.triggerAction (grants activeTab like a real click), and drives a
// Creative Commons YouTube video (Big Buck Bunny, Blender Foundation, CC BY 3.0).
// Requires network access to youtube.com. Set CHROME_PATH to override the Chrome binary.
// Note: this verifies signal flow and levels numerically; it cannot judge audible quality.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const EXT = join(ROOT, "dist");
const PORT = 9334;
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const VIDEO = "https://www.youtube.com/watch?v=aqz-KE-bpKQ";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- tiny CDP client
async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0;
  const pending = new Map();
  const events = [];
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else events.push(d);
  };
  const send = (method, params = {}, sessionId) => new Promise((r) => {
    const i = ++id; pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  return { send, events, close: () => ws.close() };
}

// ---------------------------------------------------------------- launch
const profile = mkdtempSync(join(tmpdir(), "mixpilot-e2e-"));
const chrome = spawn(CHROME, [
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`, "--enable-unsafe-extension-debugging",
  "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required", "about:blank",
], { stdio: "ignore" });
let version;
for (let i = 0; i < 40 && !version; i++) {
  await sleep(250);
  version = await fetch(`http://127.0.0.1:${PORT}/json/version`).then((r) => r.json()).catch(() => undefined);
}
if (!version) throw new Error("Chrome did not start with remote debugging");
const c = await connect(version.webSocketDebuggerUrl);

const results = [];
const check = (name, pass, detail) => {
  results.push({ name, pass });
  const fmt = (k, v) => (v === -Infinity ? "-inf" : v);
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? "  — " + JSON.stringify(detail, fmt) : ""}`);
};
const ev = async (sess, expr, userGesture = false, timeoutMs = 10000) => {
  const r = await Promise.race([
    c.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture }, sess),
    sleep(timeoutMs).then(() => ({ error: { message: `evaluate timed out after ${timeoutMs} ms` } })),
  ]);
  if (r.error) return { __err: r.error.message };
  if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description };
  return r.result?.result?.value;
};
const attach = async (targetId) => {
  const s = (await c.send("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
  await c.send("Runtime.enable", {}, s);
  return s;
};
const pages = async () => (await c.send("Target.getTargets")).result.targetInfos;
const tabTargets = async () => (await c.send("Target.getTargets", { filter: [{ type: "tab" }] })).result.targetInfos;

try {
  const load = await c.send("Extensions.loadUnpacked", { path: EXT });
  if (load.error) throw new Error(`loadUnpacked failed: ${load.error.message}`);
  const ID = load.result.id;
  check("extension loads (manifest accepted)", !!ID, ID);

  const ctl = (await c.send("Target.createTarget", { url: `chrome-extension://${ID}/popup.html`, background: true })).result.targetId;
  const controlPages = new Set([ctl]);
  await sleep(1000);
  const C = await attach(ctl);
  const msg = (m) => ev(C, `chrome.runtime.sendMessage(${JSON.stringify(m)})`);
  await ev(C, `window.__log=[]; chrome.storage.onChanged.addListener((c,a)=>{ if (a==='local') window.__log.push({t:Date.now(), c:Object.fromEntries(Object.entries(c).map(([k,v])=>[k,v.newValue]))}) })`);
  const step = (name) => ev(C, `window.__log.push({t:Date.now(), step:${JSON.stringify(name)}})`);
  const swTarget = async () => (await pages()).find((t) => t.type === "service_worker" && t.url.includes(ID));
  const sw = await attach((await swTarget()).targetId);
  const captured = () => ev(sw, `chrome.tabCapture.getCapturedTabs().then(x=>x.filter(t=>t.status==="active").length)`);
  const offscreenOpen = async () => (await pages()).some((t) => t.url === `chrome-extension://${ID}/offscreen.html`);

  // stale state reconciliation
  await ev(sw, `chrome.storage.session.set({active:true, activeTabId:424242})`);
  check("stale 'active' session without an engine is reconciled to inactive",
    (await msg({ type: "GET_STATE" })).state.active === false);

  // YouTube tab
  const ytId = (await c.send("Target.createTarget", { url: VIDEO })).result.targetId;
  await sleep(6000);
  let Y = await attach(ytId);
  if (String(await ev(Y, "location.href")).includes("consent.")) {
    // privacy-preserving choice on the cookie interstitial of this throwaway profile
    await ev(Y, `[...document.querySelectorAll('button')].find(b=>/reject all/i.test(b.innerText))?.click()`, true);
    await sleep(6000);
    Y = await attach(ytId);
  }
  const play = () => ev(Y, `(async()=>{const v=document.querySelector('video'); if(!v) return 'no-video'; v.muted=false; v.volume=1; await v.play().catch(()=>{}); await new Promise(r=>setTimeout(r,800)); return {paused:v.paused,t:+v.currentTime.toFixed(1)}})()`, true);

  // non-YouTube error (control page is the active tab of its own? use explicit check through SW URL logic)
  async function enable() {
    await c.send("Target.activateTarget", { targetId: ytId });
    const tabT = (await tabTargets()).find((t) => t.url.includes("youtube.com/watch"));
    for (const t of await pages()) if (t.url === `chrome-extension://${ID}/popup.html` && !controlPages.has(t.targetId)) await c.send("Target.closeTarget", { targetId: t.targetId });
    const trig = await c.send("Extensions.triggerAction", { id: ID, targetId: tabT.targetId });
    if (trig.error) return { ok: false, error: `triggerAction: ${trig.error.message}` };
    await sleep(800);
    const popT = (await pages()).find((t) => t.url === `chrome-extension://${ID}/popup.html` && !controlPages.has(t.targetId));
    if (!popT) return { ok: false, error: "popup did not open" };
    return ev(await attach(popT.targetId), `chrome.runtime.sendMessage({type:"START_CAPTURE"})`, true);
  }
  const videoState = () => ev(Y, `(()=>{const v=document.querySelector('video'); const p=document.querySelector('#movie_player'); return v ? {paused:v.paused, t:+v.currentTime.toFixed(1), ad: !!p?.classList.contains('ad-showing')} : null})()`);
  async function levels(n = 6, requirePlaying = false) {
    const xs = [];
    let skipped = 0;
    for (let i = 0; i < n; i++) {
      const st = (await msg({ type: "GET_ENGINE_STATS" })).state;
      if (requirePlaying) {
        const vs = await videoState();
        if (!vs || vs.paused || vs.ad) { skipped++; await sleep(250); continue; }
      }
      xs.push(st);
      await sleep(250);
    }
    const finite = xs.map((s) => s?.levels?.outputDb).filter(Number.isFinite);
    return { state: xs.at(-1), rmsDb: finite.length ? +(finite.reduce((a, b) => a + b, 0) / finite.length).toFixed(1) : -Infinity, frames: xs.length, skipped, video: await videoState() };
  }

  console.log("video:", JSON.stringify(await play()));
  const r1 = await enable();
  await sleep(1500);
  check("toolbar action + Enable starts capture and the engine", r1?.ok === true && (await captured()) === 1 && (await offscreenOpen()), r1?.message ?? r1);
  console.log("video:", JSON.stringify(await play()));

  const L1 = await levels(8, true);
  check("audio flows through the graph while the video plays", L1.state?.contextState === "running" && L1.rmsDb > -60,
    { rmsDb: L1.rmsDb, sampleRate: L1.state?.sampleRate, processingLatencyMs: L1.state?.processingLatencyMs, outputLatencyMs: +(L1.state?.outputLatencyMs ?? 0).toFixed(1), separation: L1.state?.status });

  await ev(Y, `document.querySelector('video').pause()`);
  await sleep(800);
  const L0 = await levels(4);
  check("pausing the video silences the processed output (output really is the tab audio)", L0.rmsDb === -Infinity || L0.rmsDb < -80, L0.rmsDb);
  await play();

  // gain = output level - input level, measured on the same window (independent of programme loudness).
  // Only blocks below the limiter threshold are used so peak protection does not skew the ratio.
  async function appliedGainDb(n = 10) {
    const d = [];
    for (let i = 0; i < n; i++) {
      const st = (await msg({ type: "GET_ENGINE_STATS" })).state;
      if (Number.isFinite(st?.levels?.referenceDb) && st.levels.referenceDb > -60 && st.levels.outputPeakDb < -3) d.push(st.levels.outputDb - st.levels.referenceDb);
      await sleep(150);
    }
    d.sort((a, b) => a - b);
    return d.length ? +d[Math.floor(d.length / 2)].toFixed(2) : NaN;
  }
  await step("gain test start");
  await msg({ type: "SET_MIX", mix: { masterGain: 1 } }); await sleep(400);
  const g100 = await appliedGainDb();
  await msg({ type: "SET_MIX", mix: { masterGain: 0.5 } }); await sleep(400);
  const g50 = await appliedGainDb();
  await msg({ type: "SET_MIX", mix: { masterGain: 1.5 } }); await sleep(400);
  const g150 = await appliedGainDb();
  check("master gain applies the set level (output - latency-matched original: 100% = 0 dB, 50% = -6.0 dB, 150% = +3.5 dB)",
    Math.abs(g100) < 0.5 && Math.abs(g50 + 6.02) < 0.5 && Math.abs(g150 - 3.52) < 0.5, { g100, g50, g150, video: await videoState() });
  await msg({ type: "SET_MIX", mix: { masterGain: 0 } }); await sleep(500);
  const Lmute = await levels(4);
  check("master 0% is an exact mute", Lmute.rmsDb === -Infinity, Lmute.rmsDb);
  await msg({ type: "SET_MIX", mix: { masterGain: 1 } }); await sleep(300);

  await ev(Y, `(()=>{ const a=[...document.querySelectorAll('a[href*="/watch?v="]')].find(a=>!a.href.includes('aqz-KE-bpKQ')); if(a){a.click(); return a.href} history.pushState({},'','/watch?v=YE7VzlLtp-4'); return 'pushState' })()`, true);
  await sleep(3500);
  check("YouTube in-app (SPA) navigation keeps capture running", (await captured()) === 1 && (await msg({ type: "GET_STATE" })).state.active === true);

  await c.send("Page.enable", {}, Y);
  await c.send("Page.navigate", { url: "https://example.com/" }, Y);
  await sleep(3000);
  const st = (await msg({ type: "GET_STATE" })).state;
  check("navigating away from YouTube stops capture and closes the engine", st.active === false && (await captured()) === 0 && !(await offscreenOpen()), st);

  await c.send("Page.navigate", { url: VIDEO }, Y);
  await sleep(6000);
  Y = await attach(ytId);
  await play();
  const r2 = await enable();
  await sleep(1200);
  check("re-enable after an automatic stop", r2?.ok === true && (await captured()) === 1, r2?.error);

  let cycleOk = true;
  const cycleLog = [];
  for (let i = 0; i < 5; i++) {
    const s = await msg({ type: "STOP_CAPTURE" });
    const a = await enable();
    await sleep(600);
    const n = await captured();
    cycleLog.push([s.ok, a?.ok, n]);
    if (!s.ok || !a?.ok || n !== 1) cycleOk = false;
  }
  await play();
  const Lc = await levels(6, true);
  check("5 rapid stop/start cycles leave exactly one live capture, with audio", cycleOk && Lc.rmsDb > -60, { cycles: cycleLog, rmsDb: Lc.rmsDb });

  if (process.env.E2E_DEBUG_STORAGE) console.log("STORAGE LOG", JSON.stringify(await ev(C, "window.__log")));
  // reload the extension while capturing
  await c.send("Extensions.loadUnpacked", { path: EXT });
  await sleep(2000);
  const ctl2 = (await c.send("Target.createTarget", { url: `chrome-extension://${ID}/popup.html`, background: true })).result.targetId;
  controlPages.add(ctl2);
  await sleep(1000);
  const C2 = await attach(ctl2);
  const sw2 = await attach((await swTarget()).targetId);
  const capAfter = await ev(sw2, `chrome.tabCapture.getCapturedTabs().then(x=>x.filter(t=>t.status==="active").length)`);
  const stAfterRes = await ev(C2, `chrome.runtime.sendMessage({type:"GET_STATE"})`);
  const stAfter = stAfterRes?.state ?? stAfterRes;
  check("extension reload during capture releases the capture and reports inactive", capAfter === 0 && stAfter.active === false, { capAfter, stAfter });

  // close the captured tab
  const C2msg = (m) => ev(C2, `chrome.runtime.sendMessage(${JSON.stringify(m)})`);
  Y = await attach(ytId);
  await play();
  const r3 = await enable();
  await sleep(1200);
  await c.send("Target.closeTarget", { targetId: ytId });
  await sleep(1500);
  const st2Res = await C2msg({ type: "GET_STATE" });
  const st2 = st2Res?.state ?? { error: st2Res };
  check("closing the captured tab stops capture and closes the engine", r3?.ok === true && st2.active === false && !(await pages()).some((t) => t.url.endsWith("/offscreen.html")), { r3, st2 });

  const errs = c.events.filter((e) => e.sessionId !== Y && (e.method === "Runtime.exceptionThrown" || (e.method === "Runtime.consoleAPICalled" && e.params.type === "error")));
  check("no exceptions or console errors in extension contexts", errs.length === 0, errs.map((e) => JSON.stringify(e.params).slice(0, 200)));
} finally {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await c.send("Browser.close").catch(() => undefined);
  c.close();
  await sleep(1000);
  try { chrome.kill(); } catch { /* exited */ }
  try { rmSync(profile, { recursive: true, force: true }); } catch { /* locked; temp dir */ }
  process.exitCode = results.every((r) => r.pass) ? 0 : 1;
}
