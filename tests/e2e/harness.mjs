// Shared helpers for E2E tests: launch an isolated Chrome, talk CDP, load the extension.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const DIST = join(ROOT, "dist");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CHROME = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

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

/** Launches Chrome with a throwaway profile. Returns a session object with helpers. */
export async function launch({ port = 9334, extraArgs = [] } = {}) {
  // Refuse to reuse a browser left over from an earlier run: we must drive the one we spawn.
  const stale = await fetch(`http://127.0.0.1:${port}/json/version`).then(() => true).catch(() => false);
  if (stale) throw new Error(`Port ${port} is already in use (a Chrome from an earlier run?). Close it and retry.`);
  const profile = mkdtempSync(join(tmpdir(), "mixpilot-e2e-"));
  const proc = spawn(CHROME, [
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, "--enable-unsafe-extension-debugging",
    "--no-first-run", "--no-default-browser-check", "--autoplay-policy=no-user-gesture-required", ...extraArgs, "about:blank",
  ], { stdio: "ignore" });
  let version;
  for (let i = 0; i < 40 && !version; i++) {
    await sleep(250);
    version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => undefined);
  }
  if (!version) throw new Error("Chrome did not start with remote debugging");
  const c = await connect(version.webSocketDebuggerUrl);

  const ev = async (sess, expr, userGesture = false, timeoutMs = 15000) => {
    const r = await Promise.race([
      c.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture }, sess),
      sleep(timeoutMs).then(() => ({ error: { message: `evaluate timed out after ${timeoutMs} ms` } })),
    ]);
    if (r.error) return { __err: r.error.message };
    if (r.result?.exceptionDetails) return { __err: r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text };
    return r.result?.result?.value;
  };
  const attach = async (targetId) => {
    const s = (await c.send("Target.attachToTarget", { targetId, flatten: true })).result.sessionId;
    await c.send("Runtime.enable", {}, s);
    return s;
  };
  const pages = async () => (await c.send("Target.getTargets")).result.targetInfos;
  const tabTargets = async () => (await c.send("Target.getTargets", { filter: [{ type: "tab" }] })).result.targetInfos;
  const loadExtension = async (path) => {
    const r = await c.send("Extensions.loadUnpacked", { path });
    if (r.error) throw new Error(`loadUnpacked failed: ${r.error.message}`);
    return r.result.id;
  };
  const close = async () => {
    await c.send("Browser.close").catch(() => undefined);
    c.close();
    await sleep(1000);
    try { proc.kill(); } catch { /* exited */ }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* temp dir */ }
  };

  const results = [];
  const check = (name, pass, detail) => {
    results.push({ name, pass });
    const fmt = (_k, v) => (v === -Infinity ? "-inf" : v === Infinity ? "inf" : v);
    console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail !== undefined ? "  — " + JSON.stringify(detail, fmt) : ""}`);
  };
  return { c, ev, attach, pages, tabTargets, loadExtension, close, check, results };
}
