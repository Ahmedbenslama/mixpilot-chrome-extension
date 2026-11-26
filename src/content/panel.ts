/** Minimal YouTube mixer. Tab capture is started/stopped only by the browser toolbar action. */
import { gainToPercent, percentToGain } from "../shared/gain";
import type { EngineSnapshot } from "../engine/engine";
import type { MixUpdate, PopupRequest, PublicState, Response } from "../shared/messages";

type GainKey = "speechGain" | "musicGain" | "masterGain";
const HOST_ID = "mixpilot-panel-host";
const KEYS: GainKey[] = ["speechGain", "musicGain", "masterGain"];
const LABELS: Record<GainKey, string> = {
  speechGain: "Speech",
  musicGain: "Music / other sounds",
  masterGain: "Master",
};
const CSS = `
:host{display:block;margin:10px 0;color:#fff;font:14px/1.4 Arial,Helvetica,sans-serif;color-scheme:dark}
*{box-sizing:border-box}.panel{background:#080808;color:#fff;border:1px solid #fff;padding:14px 18px;max-width:100%;user-select:none}
.top,.row-head{display:flex;align-items:center;justify-content:space-between;gap:16px}.top{margin-bottom:12px}.title{font-size:14px;font-weight:700;letter-spacing:.04em}.status,.notice{font-size:12px;color:#fff}.status{white-space:nowrap;text-align:right}.notice{min-height:0;margin-top:8px}.notice:empty{display:none}
.controls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px}.control{min-width:0}.row-head{margin-bottom:10px;font-weight:700}.label{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.value{font-variant-numeric:tabular-nums;font-weight:700;white-space:nowrap}
input[type=range]{display:block;width:100%;height:12px;margin:7px 0 4px;padding:0;appearance:none;background:linear-gradient(to right,#fff 0%,#fff var(--fill,50%),#555 var(--fill,50%),#555 100%);border:0;border-radius:0;cursor:pointer}
input[type=range]:focus-visible,button:focus-visible{outline:3px solid #fff;outline-offset:4px}
input[type=range]::-webkit-slider-thumb{appearance:none;width:24px;height:24px;border:3px solid #080808;border-radius:0;background:#fff;box-shadow:0 0 0 2px #fff}
input[type=range]::-moz-range-thumb{width:18px;height:18px;border:3px solid #080808;border-radius:0;background:#fff;box-shadow:0 0 0 2px #fff}
.actions{display:flex;justify-content:flex-end;margin-top:14px;padding-top:11px;border-top:1px solid #fff}
button{background:transparent;color:#fff;border:2px solid #fff;border-radius:0;padding:7px 13px;font:700 12px Arial,Helvetica,sans-serif;cursor:pointer}
button:hover{background:#fff;color:#080808}
@media(max-width:640px){.panel{padding:12px}.controls{grid-template-columns:1fr;gap:12px}.top{align-items:flex-start;flex-direction:column;gap:4px}.status{text-align:left}}
`;

let state: PublicState | null = null;
let snapshot: EngineSnapshot | null = null;
let host: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let noticeEl: HTMLElement | null = null;
let alive = true;
let refreshTimer = 0;
let statsTimer = 0;
const inputs = new Map<GainKey, HTMLInputElement>();
const values = new Map<GainKey, HTMLOutputElement>();
const sendTimers = new Map<GainKey, number>();

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

async function send<T = PublicState>(request: PopupRequest): Promise<Response<T> | null> {
  try {
    if (!chrome.runtime?.id) { teardown(); return null; }
    return await chrome.runtime.sendMessage(request) as Response<T>;
  } catch { return null; }
}

function paint(key: GainKey): void {
  const input = inputs.get(key);
  const output = values.get(key);
  if (!input || !output) return;
  output.value = `${input.value}%`;
  input.style.setProperty("--fill", `${Number(input.value) / Number(input.max) * 100}%`);
  input.setAttribute("aria-valuetext", `${input.value} percent`);
}

function statusText(): string {
  if (!state?.active) return "Inactive — click MixPilot in the browser toolbar to enable";
  if (!snapshot) return "Starting";
  const labels: Record<EngineSnapshot["status"], string> = {
    loading: "Loading model",
    priming: "Starting separation",
    running: `Separating · ${snapshot.processingLatencyMs.toFixed(0)} ms`,
    overloaded: "Device too slow — original audio playing",
    unavailable: "Separation unavailable — original audio playing",
    error: "Engine error — original audio playing",
  };
  return labels[snapshot.status];
}

function render(next: PublicState): void {
  state = next;
  for (const key of KEYS) {
    const input = inputs.get(key);
    if (input && document.activeElement !== input) input.value = String(gainToPercent(next[key]));
    paint(key);
  }
  if (statusEl) statusEl.textContent = statusText();
}

function notify(text: string): void {
  if (noticeEl) noticeEl.textContent = text;
  window.setTimeout(() => { if (noticeEl?.textContent === text) noticeEl.textContent = ""; }, 6000);
}

function buildPanel(): HTMLElement {
  const rootHost = element("div");
  rootHost.id = HOST_ID;
  host = rootHost;
  const shadow = rootHost.attachShadow({ mode: "open" });
  const style = element("style");
  style.textContent = CSS;
  const panel = element("section", "panel");
  panel.setAttribute("aria-label", "MixPilot audio sliders");

  const top = element("header", "top");
  const title = element("div", "title");
  title.textContent = "MIXPILOT";
  statusEl = element("div", "status");
  statusEl.setAttribute("role", "status");
  statusEl.setAttribute("aria-live", "polite");
  top.append(title, statusEl);

  const controls = element("div", "controls");
  for (const key of KEYS) {
    const section = element("section", "control");
    const heading = element("div", "row-head");
    const label = element("label", "label");
    const id = `mixpilot-${key}`;
    label.htmlFor = id;
    label.textContent = LABELS[key];
    const output = element("output", "value");
    output.htmlFor = id;
    const input = element("input");
    input.type = "range";
    input.id = id;
    input.min = "0";
    input.max = "200";
    input.step = "1";
    input.value = "100";
    input.setAttribute("aria-label", LABELS[key]);
    input.addEventListener("input", () => {
      paint(key);
      if (state) state[key] = percentToGain(Number(input.value));
      window.clearTimeout(sendTimers.get(key));
      sendTimers.set(key, window.setTimeout(async () => {
        const response = await send({ type: "SET_MIX", mix: { [key]: percentToGain(Number(input.value)) } });
        if (!response?.ok) notify(response?.error ?? "Could not update the mix.");
      }, 25));
    });
    heading.append(label, output);
    section.append(heading, input);
    controls.append(section);
    inputs.set(key, input);
    values.set(key, output);
    paint(key);
  }

  const actions = element("div", "actions");
  const restore = element("button");
  restore.type = "button";
  restore.textContent = "Restore";
  restore.title = "Restore the original balanced mix";
  restore.addEventListener("click", async () => {
    for (const key of KEYS) {
      const input = inputs.get(key)!;
      input.value = "100";
      paint(key);
    }
    const response = await send({ type: "SET_MIX", mix: { speechGain: 1, musicGain: 1, masterGain: 1 } });
    if (state?.active && state.bypass) await send({ type: "SET_BYPASS", on: false });
    if (!response?.ok) notify(response?.error ?? "Could not restore the mix.");
  });
  actions.append(restore);
  noticeEl = element("div", "notice");
  noticeEl.setAttribute("role", "status");
  noticeEl.setAttribute("aria-live", "polite");
  panel.append(top, controls, actions, noticeEl);
  shadow.append(style, panel);
  for (const type of ["keydown", "keyup", "keypress"] as const) rootHost.addEventListener(type, event => event.stopPropagation());
  if (state) render(state);
  return rootHost;
}

function findAnchor(): HTMLElement | null {
  return document.querySelector<HTMLElement>("ytd-watch-flexy #below")
    ?? document.querySelector<HTMLElement>("#below")
    ?? document.querySelector<HTMLElement>("ytd-watch-flexy #primary-inner");
}

function maintain(): void {
  if (!alive) return;
  const existing = document.getElementById(HOST_ID);
  if (location.pathname !== "/watch") { existing?.remove(); return; }
  const anchor = findAnchor();
  if (!anchor) return;
  if (existing?.parentElement === anchor && anchor.firstElementChild === existing) return;
  anchor.prepend(existing ?? host ?? buildPanel());
}

async function refresh(): Promise<void> {
  const response = await send({ type: "GET_STATE" });
  if (response?.ok) render(response.state);
}

async function pollStats(): Promise<void> {
  if (state?.active) {
    const response = await send<EngineSnapshot | null>({ type: "GET_ENGINE_STATS" });
    if (response?.ok && response.state) {
      snapshot = response.state;
      if (statusEl) statusEl.textContent = statusText();
    }
  } else {
    snapshot = null;
    if (statusEl) statusEl.textContent = statusText();
  }
}

function teardown(): void {
  alive = false;
  window.clearInterval(refreshTimer);
  window.clearInterval(statsTimer);
  document.getElementById(HOST_ID)?.remove();
}

chrome.runtime.onMessage.addListener((raw: unknown) => {
  const message = raw as { type?: string; state?: PublicState; text?: string } | null;
  if (message?.type === "MIXPILOT_STATE" && message.state) render(message.state);
  else if (message?.type === "MIXPILOT_NOTICE" && message.text) notify(message.text);
});

document.addEventListener("yt-navigate-finish", () => { snapshot = null; maintain(); void refresh(); });
maintain();
refreshTimer = window.setInterval(() => void refresh(), 2000);
statsTimer = window.setInterval(() => void pollStats(), 600);
void refresh();
