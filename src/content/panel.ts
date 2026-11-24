/**
 * Content script: three minimal sliders (Speech, Music, Master) injected directly under the YouTube player.
 * Text only, no icons, no accent colours: white in YouTube's dark theme, black in the light theme.
 *
 * This script only draws UI and talks to the service worker. Audio capture and processing stay in the
 * offscreen document. Chrome only allows tab capture after an explicit extension action (clicking the
 * toolbar icon), so the sliders always work (their values are saved and applied) but audio processing
 * starts after that one click.
 */
import { gainToPercent, percentToGain } from "../shared/gain";
import type { MixUpdate, PopupRequest, PublicState, Response } from "../shared/messages";

type GainKey = "speechGain" | "musicGain" | "masterGain";

const SLIDERS: readonly { key: GainKey; label: string }[] = [
  { key: "speechGain", label: "Speech" },
  { key: "musicGain", label: "Music" },
  { key: "masterGain", label: "Master" },
];

const HOST_ID = "mixpilot-panel-host";
const SEND_DEBOUNCE_MS = 25;
const LOCAL_CHANGE_GRACE_MS = 500;
const NOTICE_MS = 7000;

const CSS = `
  :host { display: block; margin: 12px 0 4px; }
  .panel { color: #fff; font: 400 12px/1.4 Roboto, Arial, sans-serif; user-select: none; }
  .panel.light { color: #000; }
  .head { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; margin-bottom: 10px;
          font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; }
  .status { opacity: 0.6; text-align: right; text-transform: none; letter-spacing: 0; }
  .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
  @media (max-width: 720px) { .grid { grid-template-columns: 1fr; gap: 10px; } }
  .row { display: flex; flex-direction: column; gap: 4px; }
  .meta { display: flex; justify-content: space-between; }
  .value { opacity: 0.6; font-variant-numeric: tabular-nums; }
  input[type="range"] {
    -webkit-appearance: none; appearance: none; width: 100%; height: 16px; margin: 0; padding: 0;
    background: transparent; color: inherit; cursor: pointer; outline: none;
  }
  input[type="range"]::-webkit-slider-runnable-track {
    height: 2px; border-radius: 1px;
    background: linear-gradient(to right, currentColor var(--fill, 50%), color-mix(in srgb, currentColor 30%, transparent) var(--fill, 50%));
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none; width: 12px; height: 12px; margin-top: -5px;
    border: 0; border-radius: 50%; background: currentColor;
  }
  input[type="range"]:focus-visible::-webkit-slider-thumb { box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 40%, transparent); }
`;

let state: PublicState | null = null;
let host: HTMLElement | null = null;
let panel: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let noticeText = "";
let noticeUntil = 0;
let lastLocalChange = 0;
let alive = true;
const inputs = new Map<GainKey, HTMLInputElement>();
const outputs = new Map<GainKey, HTMLElement>();
const sendTimers = new Map<GainKey, number>();
let maintainTimer = 0;
let pollTimer = 0;

function extensionAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

async function send<T = PublicState>(req: PopupRequest): Promise<Response<T> | null> {
  if (!extensionAlive()) {
    teardown();
    return null;
  }
  try {
    return (await chrome.runtime.sendMessage(req)) as Response<T>;
  } catch {
    return null;
  }
}

function isDarkTheme(): boolean {
  // YouTube sets a `dark` attribute on <html> in its dark theme (including "use device theme").
  return document.documentElement.hasAttribute("dark");
}

function applyTheme(): void {
  panel?.classList.toggle("light", !isDarkTheme());
}

function paint(key: GainKey): void {
  const input = inputs.get(key);
  const out = outputs.get(key);
  if (!input || !out) return;
  out.textContent = `${input.value}%`;
  input.style.setProperty("--fill", `${(Number(input.value) / Number(input.max)) * 100}%`);
  input.setAttribute("aria-valuetext", `${input.value} percent`);
}

function renderStatus(): void {
  if (!statusEl) return;
  if (noticeText && Date.now() < noticeUntil) {
    statusEl.textContent = noticeText;
  } else if (!state?.active) {
    statusEl.textContent = "Off · click the MixPilot toolbar icon to turn on";
  } else {
    statusEl.textContent = "On";
  }
}

function render(next: PublicState): void {
  state = next;
  const recentlyEdited = Date.now() - lastLocalChange < LOCAL_CHANGE_GRACE_MS;
  for (const { key } of SLIDERS) {
    const input = inputs.get(key);
    if (!input) continue;
    const root = input.getRootNode();
    const focused = root instanceof ShadowRoot && root.activeElement === input;
    if (!recentlyEdited && !focused) input.value = String(gainToPercent(next[key]));
    paint(key);
  }
  renderStatus();
}

function showNotice(text: string): void {
  noticeText = text;
  noticeUntil = Date.now() + NOTICE_MS;
  renderStatus();
  window.setTimeout(renderStatus, NOTICE_MS + 50);
}

function onInput(key: GainKey, input: HTMLInputElement): void {
  lastLocalChange = Date.now();
  paint(key);
  window.clearTimeout(sendTimers.get(key));
  sendTimers.set(
    key,
    window.setTimeout(async () => {
      const mix: MixUpdate = { [key]: percentToGain(Number(input.value)) };
      const res = await send({ type: "SET_MIX", mix });
      if (res && !res.ok) showNotice(res.error);
    }, SEND_DEBOUNCE_MS),
  );
}

function buildPanel(): HTMLElement {
  const el = document.createElement("div");
  el.id = HOST_ID;
  host = el;
  const shadow = el.attachShadow({ mode: "open" });

  const style = document.createElement("style");
  style.textContent = CSS;

  panel = document.createElement("div");
  panel.className = "panel";

  const head = document.createElement("div");
  head.className = "head";
  const title = document.createElement("span");
  title.textContent = "MixPilot";
  statusEl = document.createElement("span");
  statusEl.className = "status";
  statusEl.setAttribute("role", "status");
  head.append(title, statusEl);

  const grid = document.createElement("div");
  grid.className = "grid";
  inputs.clear();
  outputs.clear();
  for (const { key, label } of SLIDERS) {
    const row = document.createElement("div");
    row.className = "row";
    const meta = document.createElement("div");
    meta.className = "meta";
    const name = document.createElement("label");
    const id = `mixpilot-${key}`;
    name.htmlFor = id;
    name.textContent = label;
    const out = document.createElement("span");
    out.className = "value";
    const input = document.createElement("input");
    input.type = "range";
    input.id = id;
    input.min = "0";
    input.max = "200";
    input.step = "1";
    input.value = "100";
    input.addEventListener("input", () => onInput(key, input));
    input.addEventListener("dblclick", () => {
      input.value = "100"; // double-click resets to the original level
      onInput(key, input);
    });
    meta.append(name, out);
    row.append(meta, input);
    grid.append(row);
    inputs.set(key, input);
    outputs.set(key, out);
    paint(key);
  }

  panel.append(head, grid);
  shadow.append(style, panel);

  // Keep arrow keys etc. on the slider instead of YouTube's seek/volume shortcuts.
  for (const type of ["keydown", "keyup", "keypress"] as const) el.addEventListener(type, (e) => e.stopPropagation());

  applyTheme();
  if (state) render(state);
  else renderStatus();
  return el;
}

function findAnchor(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>("ytd-watch-flexy #below") ??
    document.querySelector<HTMLElement>("#below") ??
    document.querySelector<HTMLElement>("ytd-watch-flexy #primary-inner")
  );
}

/** Keep exactly one panel at the top of the area under the player on watch pages; remove it elsewhere. */
function maintain(): void {
  if (!alive) return;
  const existing = document.getElementById(HOST_ID);
  if (location.pathname !== "/watch") {
    existing?.remove();
    return;
  }
  const anchor = findAnchor();
  if (!anchor) return;
  if (existing && existing.parentElement === anchor && anchor.firstElementChild === existing) return;
  const el = existing ?? host ?? buildPanel();
  anchor.prepend(el);
}

async function refresh(): Promise<void> {
  const res = await send({ type: "GET_STATE" });
  if (res?.ok) render(res.state);
}

function teardown(): void {
  alive = false;
  window.clearInterval(maintainTimer);
  window.clearInterval(pollTimer);
  document.getElementById(HOST_ID)?.remove();
  themeObserver.disconnect();
}

const themeObserver = new MutationObserver(applyTheme);
themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["dark"] });

chrome.runtime.onMessage.addListener((msg: unknown) => {
  const m = msg as { type?: string; state?: PublicState; text?: string } | null;
  if (m?.type === "MIXPILOT_STATE" && m.state) render(m.state);
  else if (m?.type === "MIXPILOT_NOTICE" && typeof m.text === "string") showNotice(m.text);
});

document.addEventListener("yt-navigate-finish", maintain);
maintain();
maintainTimer = window.setInterval(maintain, 1000);
pollTimer = window.setInterval(() => void refresh(), 2000);
void refresh();
