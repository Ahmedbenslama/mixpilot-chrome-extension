/** YouTube-native MixPilot mixer. UI only: capture and DSP remain in the offscreen engine. */
import { gainToPercent, percentToGain } from "../shared/gain";
import type { EngineSnapshot } from "../engine/engine";
import { channelProfileKey, resolveProfile, videoProfileKey, type ProfileMap, type ProfileScope } from "../shared/profiles";
import { isSupportedYouTubeUrl } from "../shared/youtube";
import type { MixUpdate, PopupRequest, PublicState, RecognitionHistoryEntry, RecognitionResult, Response } from "../shared/messages";

type GainKey = "speechGain" | "musicGain" | "masterGain";
const HOST_ID = "mixpilot-panel-host";
const SEND_DEBOUNCE_MS = 25;
const KEYS: GainKey[] = ["speechGain", "musicGain", "masterGain"];
const LABEL: Record<GainKey, string> = { speechGain: "Speech", musicGain: "Music & other sounds", masterGain: "Master" };
const PRESETS: Record<string, Pick<PublicState, "speechGain" | "musicGain" | "masterGain">> = {
  Balanced: { speechGain: 1, musicGain: 1, masterGain: 1 },
  Dialogue: { speechGain: 1.5, musicGain: 0.55, masterGain: 1 },
  Music: { speechGain: 0.65, musicGain: 1.35, masterGain: 1 },
  Lecture: { speechGain: 1.35, musicGain: 0.35, masterGain: 1 },
};
const CSS = `
:host{display:block;margin:12px 0 8px;color:#e8edf2;font:13px/1.45 Inter,Roboto,Arial,sans-serif;--mint:#8de5bd;--muted:#8b96a4;--line:#29323c;--panel:#10151b;--card:#151c23}
*{box-sizing:border-box}.wrap{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px;box-shadow:0 8px 28px #0002;user-select:none}
.head,.head-left,.head-right,.section-head,.control-top,.actions,.footer,.preset-row{display:flex;align-items:center}.head,.section-head,.control-top,.footer{justify-content:space-between}.head{gap:16px;padding-bottom:13px;border-bottom:1px solid var(--line)}.head-left{gap:10px}.brand-icon{width:28px;height:28px;border-radius:8px;background:#1b2b24;color:var(--mint);display:grid;place-items:center;font-weight:900}.brand{font-size:15px;font-weight:800;letter-spacing:-.4px}.tag{color:var(--muted);font-size:10px;margin-top:1px}.head-right{gap:12px}.status{display:flex;align-items:center;gap:7px;color:#aeb7c2;font-size:11px}.dot{height:7px;width:7px;border-radius:50%;background:#66717e}.dot.on{background:var(--mint);box-shadow:0 0 10px #8de5bd88}.toggle{border:0;border-radius:8px;background:var(--mint);color:#07140d;font-weight:750;padding:8px 12px;cursor:pointer}.toggle[disabled]{opacity:.55;cursor:wait}.section-head{margin:14px 0 9px}.eyebrow{font-size:9px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);font-weight:800}.note{font-size:10px;color:var(--muted)}.channels{display:grid;grid-template-columns:1fr 1fr;gap:10px}.channel,.master-card{background:var(--card);border:1px solid #26303a;border-radius:10px;padding:12px}.channel-head{display:flex;align-items:center;gap:8px}.glyph{width:26px;height:26px;border-radius:8px;background:#1d2a25;color:var(--mint);display:grid;place-items:center;font-weight:800}.channel:nth-child(2) .glyph{background:#242637;color:#c4b5fd}.channel-name{min-width:0;flex:1;font-size:12px;font-weight:750}.mute{border:1px solid #3a444f;background:transparent;color:#c8d0d9;border-radius:6px;padding:4px 7px;font-size:10px;cursor:pointer}.mute[aria-pressed=true]{color:#111;background:var(--mint);border-color:var(--mint)}.value{font-variant-numeric:tabular-nums;color:var(--mint);font-size:11px;font-weight:750}.slider{width:100%;height:4px;margin:16px 0 9px;appearance:none;border-radius:8px;background:linear-gradient(90deg,var(--mint) 0%,var(--mint) var(--fill,50%),#35404b var(--fill,50%),#35404b 100%);cursor:pointer}.slider:focus-visible,button:focus-visible,select:focus-visible{outline:2px solid var(--mint);outline-offset:3px}.slider::-webkit-slider-thumb{appearance:none;width:14px;height:14px;border:3px solid var(--card);border-radius:50%;background:var(--mint);box-shadow:0 0 0 1px var(--mint)}.slider::-moz-range-thumb{width:10px;height:10px;border:3px solid var(--card);border-radius:50%;background:var(--mint)}.meter{height:4px;background:#222b34;border-radius:5px;overflow:hidden}.meter-fill{height:100%;width:0;background:linear-gradient(90deg,#64c995,var(--mint));transition:width .12s linear}.meter-label{display:flex;justify-content:space-between;color:#778391;font-size:9px;margin-top:5px}.master-card{margin-top:10px}.master-row{display:flex;align-items:center;gap:12px}.master-title{font-weight:700;font-size:12px;min-width:52px}.master-row .slider{flex:1;margin:0}.preset-row{gap:7px;margin-top:11px;flex-wrap:wrap}.preset-label{color:var(--muted);font-size:10px;margin-right:2px}.preset{border:1px solid #35414c;border-radius:6px;background:transparent;color:#c9d1da;padding:5px 9px;font-size:10px;cursor:pointer}.preset[aria-pressed=true]{border-color:#558c71;color:var(--mint);background:#18251e}.actions{gap:8px;margin-top:12px}.action{border:1px solid #36414c;border-radius:7px;background:#141a21;color:#d8e0e7;padding:7px 11px;font-size:10px;font-weight:700;cursor:pointer}.action[aria-pressed=true]{border-color:#558c71;color:var(--mint);background:#18251e}.action:disabled{opacity:.45;cursor:not-allowed}.identify{margin-left:auto}.message{min-height:15px;color:var(--muted);font-size:10px;padding-top:8px}.message.error{color:#ff9999}.footer{border-top:1px solid var(--line);padding-top:9px;margin-top:5px;color:#697582;font-size:9px}.status-detail{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:560px}.recognition{margin-top:10px;border-top:1px solid var(--line);padding-top:9px}.recognition summary{cursor:pointer;color:#b8c2cd;font-size:10px}.token-row{display:flex;gap:7px;margin-top:9px}.token-input{min-width:0;flex:1;background:#0b1015;border:1px solid #39444f;border-radius:6px;color:#e7edf3;padding:7px 8px;font-size:10px}.small{font-size:9px;color:var(--muted);line-height:1.5;margin:7px 0}.history{display:grid;gap:6px;margin-top:8px}.history-item{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#11171d;border-radius:6px;padding:7px}.track{font-size:10px;min-width:0}.track strong{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.track span{color:var(--muted)}.seek{border:1px solid #3a4651;background:transparent;color:var(--mint);border-radius:5px;padding:5px 7px;font-size:9px;cursor:pointer;white-space:nowrap}.consent{width:min(420px,calc(100vw - 32px));border:1px solid #44514c;border-radius:12px;background:#11181e;color:#e8edf2;padding:20px;box-shadow:0 18px 50px #0009}.consent::backdrop{background:#000a}.consent h3{font-size:16px;margin:0 0 10px}.consent p{font-size:12px;line-height:1.6;color:#b5bec8}.consent .actions{justify-content:flex-end}.sr{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
@media(max-width:640px){.wrap{padding:12px}.channels{grid-template-columns:1fr}.head{align-items:flex-start}.head-right{flex-direction:column;align-items:flex-end;gap:6px}.status-detail{max-width:280px}}
`;
let state: PublicState | null = null;
let snapshot: EngineSnapshot | null = null;
let alive = true;
let lastEdit = 0;
let messageText = "";
let messageUntil = 0;
const timers = new Map<GainKey, number>();
const inputs = new Map<GainKey, HTMLInputElement>();
const outputs = new Map<GainKey, HTMLElement>();
const meterFills = new Map<"speechGain" | "musicGain" | "masterGain", HTMLElement>();
const muted = new Map<"speechGain" | "musicGain", number>();
let host: HTMLElement | null = null;
let statusNode: HTMLElement | null = null;
let detailNode: HTMLElement | null = null;
let messageNode: HTMLElement | null = null;
let presetButtons = new Map<string, HTMLButtonElement>();
let maintainTimer = 0;
let pollTimer = 0;

function extensionAlive(): boolean { try { return Boolean(chrome.runtime?.id); } catch { return false; } }
async function send<T = PublicState>(req: PopupRequest): Promise<Response<T> | null> {
  if (!extensionAlive()) { teardown(); return null; }
  try { return await chrome.runtime.sendMessage(req) as Response<T>; } catch { return null; }
}
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = ""): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag); if (cls) node.className = cls; return node;
}
function paint(key: GainKey): void {
  const input = inputs.get(key); const out = outputs.get(key); if (!input || !out) return;
  out.textContent = `${input.value}%`;
  input.style.setProperty("--fill", `${Number(input.value) / Number(input.max) * 100}%`);
  input.setAttribute("aria-valuetext", `${input.value} percent`);
}
function syncMuteButton(key: "speechGain" | "musicGain"): void {
  const button = host?.shadowRoot?.querySelector<HTMLButtonElement>(`[data-mute-key="${key}"]`);
  const mutedNow = Number(inputs.get(key)?.value ?? 100) === 0;
  if (button) { button.setAttribute("aria-pressed", String(mutedNow)); button.textContent = mutedNow ? "Restore" : "Mute"; }
}
function notify(text: string, error = false): void {
  messageText = text; messageUntil = Date.now() + 6000;
  if (messageNode) { messageNode.textContent = text; messageNode.classList.toggle("error", error); }
  window.setTimeout(() => { if (Date.now() >= messageUntil && messageNode) messageNode.textContent = ""; }, 6100);
}
function statusText(): string {
  if (!state?.active) return "Inactive";
  if (!snapshot) return "Starting";
  return ({ loading: "Loading model", priming: "Starting separation", running: "Separating", overloaded: "Device too slow · original audio", unavailable: "Separation unavailable · passthrough", error: "Engine error · passthrough" })[snapshot.status];
}
function render(next: PublicState): void {
  const wasActive = state?.active ?? false;
  if (activeProfileKey && profiles[activeProfileKey]) next = { ...next, ...profiles[activeProfileKey] };
  state = next;
  if (next.active && !wasActive && activeProfileKey && activeProfileKey !== "global" && profiles[activeProfileKey]) {
    const mix = profiles[activeProfileKey]!;
    window.setTimeout(() => { if (state?.active) void send({ type: "SET_RUNTIME_MIX", mix }); }, 120);
  }
  for (const key of KEYS) {
    const input = inputs.get(key); if (!input) continue;
    if (Date.now() - lastEdit > 500 && document.activeElement !== input) input.value = String(gainToPercent(next[key]));
    paint(key);
  }
  statusNode?.replaceChildren();
  if (statusNode) {
    const dot = el("span", "dot"); dot.classList.toggle("on", next.active && snapshot?.status === "running");
    statusNode.append(dot, document.createTextNode(statusText()));
  }
  const toggle = host?.shadowRoot?.querySelector<HTMLButtonElement>(".toggle");
  if (toggle) { toggle.textContent = next.active ? "Disable MixPilot" : "Enable MixPilot"; toggle.setAttribute("aria-pressed", String(next.active)); }
  const ab = host?.shadowRoot?.querySelector<HTMLButtonElement>("#ab");
  if (ab) { ab.disabled = !next.active; ab.setAttribute("aria-pressed", String(next.bypass)); ab.textContent = next.bypass ? "Return to mix" : "Hear original · A/B"; }
  const reset = host?.shadowRoot?.querySelector<HTMLButtonElement>("#reset"); if (reset) reset.disabled = false;
  renderPreset();
  for (const key of ["speechGain", "musicGain"] as const) syncMuteButton(key);
  if (messageNode && Date.now() < messageUntil) messageNode.textContent = messageText;
}
function renderPreset(): void {
  const custom = !state || !Object.values(PRESETS).some(p => KEYS.every(k => Math.abs(p[k] - state![k]) < .005));
  for (const [name, button] of presetButtons) button.setAttribute("aria-pressed", String(name === "Custom" ? custom : !custom && KEYS.every(k => Math.abs(PRESETS[name]![k] - state![k]) < .005)));
}
function onInput(key: GainKey, input: HTMLInputElement): void {
  lastEdit = Date.now(); paint(key); renderPreset(); if (key !== "masterGain") syncMuteButton(key);
  if (state) state[key] = percentToGain(Number(input.value));
  if (activeProfileKey) profiles[activeProfileKey] = Object.fromEntries(KEYS.map(k => [k, state?.[k] ?? 1])) as Pick<PublicState, GainKey>;
  clearTimeout(timers.get(key));
  timers.set(key, window.setTimeout(async () => {
    const res = await sendMixForProfile({ [key]: percentToGain(Number(input.value)) }, activeProfileKey);
    if (res && !res.ok) notify(res.error, true);
  }, SEND_DEBOUNCE_MS));
}
let profiles: ProfileMap = {};
let activeProfileKey: string | null = null;
let baseMix: Pick<PublicState, GainKey> | null = null;
function sendMixForProfile(mix: MixUpdate, key: string | null): Promise<Response | null> {
  if (state) {
    state = { ...state, ...mix };
    if (key && key !== "global") profiles[key] = { speechGain: state.speechGain, musicGain: state.musicGain, masterGain: state.masterGain };
  }
  return send(key && key !== "global" ? { type: "SET_RUNTIME_MIX", mix } : { type: "SET_MIX", mix });
}
function currentChannelKey(): string | null {
  const link = document.querySelector<HTMLAnchorElement>("ytd-video-owner-renderer a[href^='/'], ytd-channel-name a[href^='/']");
  return channelProfileKey(link?.getAttribute("href") ?? null);
}
function scopeKey(scope: ProfileScope): string | null {
  if (scope === "global") return "global";
  if (scope === "video") return videoProfileKey(location.href);
  return currentChannelKey();
}
async function applyProfiles(): Promise<void> {
  const stored = await chrome.storage.local.get("mixProfiles") as { mixProfiles?: ProfileMap };
  profiles = stored.mixProfiles && typeof stored.mixProfiles === "object" ? stored.mixProfiles : {};
  const resolved = resolveProfile(profiles, videoProfileKey(location.href), currentChannelKey());
  const previous = activeProfileKey;
  if (!resolved) {
    activeProfileKey = null;
    if (previous && baseMix) { const result = await sendMixForProfile(baseMix, null); if (result?.ok && result.state) render(result.state); }
    return;
  }
  activeProfileKey = resolved.key;
  const select = host?.shadowRoot?.querySelector<HTMLSelectElement>("#profile-scope");
  if (select) select.value = resolved.key === "global" ? "global" : resolved.key.startsWith("video:") ? "video" : "channel";
  if (previous === resolved.key && state && KEYS.every(k => Math.abs(state![k] - resolved.mix[k]) < .001)) return;
  const result = await sendMixForProfile(resolved.mix, resolved.key);
  if (result?.ok && result.state) render(result.state);
}
async function saveSelectedProfile(): Promise<void> {
  const scope = host?.shadowRoot?.querySelector<HTMLSelectElement>("#profile-scope")?.value as ProfileScope | undefined;
  if (!scope) return;
  const key = scopeKey(scope);
  if (!key) { notify(scope === "video" ? "Open a YouTube video to save a video profile." : "Could not identify this channel for a channel profile.", true); return; }
  const mix = Object.fromEntries(KEYS.map(k => [k, Number(inputs.get(k)?.value ?? 100) / 100])) as Pick<PublicState, GainKey>;
  profiles[key] = mix; activeProfileKey = key;
  await chrome.storage.local.set({ mixProfiles: profiles });
  await sendMixForProfile(mix, key);
  notify(`Saved ${scope} mix profile.`);
}
async function chooseProfileScope(scope: ProfileScope): Promise<void> {
  const key = scopeKey(scope);
  if (!key) { notify(scope === "video" ? "This page is not a YouTube video." : "Channel identity is not available on this video.", true); return; }
  const chosen = profiles[key];
  if (!chosen) { activeProfileKey = key; notify(`No saved ${scope} profile yet. Adjust the mix, then save it.`); return; }
  activeProfileKey = key;
  const response = await sendMixForProfile(chosen, key);
  if (response?.ok && response.state) render(response.state);
}
async function loadHistory(target?: HTMLElement): Promise<void> {
  const container = target ?? host?.shadowRoot?.querySelector<HTMLElement>(".history");
  if (!container) return;
  const response = await send<RecognitionHistoryEntry[]>({ type: "GET_RECOGNITION_HISTORY" });
  if (!response?.ok) return;
  container.replaceChildren();
  for (const entry of response.state) {
    const row = el("div", "history-item"); const copy = el("div", "track"); const title = el("strong"); title.textContent = `${entry.title} — ${entry.artist}`;
    const sub = el("span"); const clock = `${Math.floor(entry.timestamp / 60)}:${String(Math.floor(entry.timestamp % 60)).padStart(2, "0")}`; sub.textContent = `${clock} · ${new Date(entry.createdAt).toLocaleDateString()} · ${entry.provider}`; copy.append(title, sub);
    if (entry.songUrl) { try { const url = new URL(entry.songUrl); if (url.protocol === "https:") { const link = el("a"); link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; link.textContent = "Open track"; link.style.color = "#8de5bd"; link.style.fontSize = "9px"; copy.append(link); } } catch { /* ignore malformed provider link */ } }
    const seek = el("button", "seek"); seek.type = "button"; seek.textContent = "Seek to video"; seek.addEventListener("click", () => {
      if (!isSupportedYouTubeUrl(entry.videoUrl)) { notify("This saved video link is invalid.", true); return; }
      const video = document.querySelector<HTMLVideoElement>("video.html5-main-video");
      const target = new URL(entry.videoUrl);
      const sameVideo = target.searchParams.get("v") === new URL(location.href).searchParams.get("v");
      if (sameVideo && video) { video.currentTime = entry.timestamp; void video.play(); }
      else { target.searchParams.set("t", `${Math.floor(entry.timestamp)}s`); window.location.href = target.href; }
    });
    const remove = el("button", "seek"); remove.type = "button"; remove.textContent = "Remove"; remove.setAttribute("aria-label", `Remove ${entry.title} from recognition history`);
    remove.addEventListener("click", async () => { await send({ type: "DELETE_RECOGNITION_HISTORY", id: entry.id }); await loadHistory(container); });
    row.append(copy, seek, remove); container.append(row);
  }
  if (!response.state.length) { const empty = el("p", "small"); empty.textContent = "No identified tracks yet."; container.append(empty); }
}
function makeControl(key: GainKey): HTMLElement {
  const channel = el("section", key === "masterGain" ? "master-card" : "channel");
  const input = el("input", "slider"); input.type = "range"; input.min = "0"; input.max = "200"; input.step = "1"; input.value = "100";
  input.id = `mixpilot-${key}`; input.setAttribute("aria-label", LABEL[key]);
  const out = el("output", "value"); out.htmlFor = input.id;
  input.addEventListener("input", () => onInput(key, input));
  inputs.set(key, input); outputs.set(key, out);
  if (key === "masterGain") {
    const row = el("div", "master-row"); const name = el("label", "master-title"); name.htmlFor = input.id; name.textContent = "Master";
    row.append(name, input, out); channel.append(row);
  } else {
    const head = el("div", "channel-head"); const glyph = el("span", "glyph"); glyph.setAttribute("aria-hidden", "true"); glyph.textContent = key === "speechGain" ? "V" : "♪";
    const name = el("label", "channel-name"); name.htmlFor = input.id; name.textContent = LABEL[key];
    const mute = el("button", "mute"); mute.type = "button"; mute.dataset.muteKey = key; mute.textContent = "Mute"; mute.setAttribute("aria-pressed", "false"); mute.setAttribute("aria-label", `Mute ${LABEL[key]}`);
    mute.addEventListener("click", () => {
      const current = state?.[key] ?? 1;
      if (current > 0) { muted.set(key, current); input.value = "0"; mute.setAttribute("aria-pressed", "true"); mute.textContent = "Restore"; }
      else { input.value = String(gainToPercent(muted.get(key) ?? 1)); mute.setAttribute("aria-pressed", "false"); mute.textContent = "Mute"; }
      onInput(key, input);
    });
    head.append(glyph, name, out, mute);
    const meter = el("div", "meter"); meter.setAttribute("role", "meter"); meter.setAttribute("aria-label", `${LABEL[key]} audio level`); meter.setAttribute("aria-valuemin", "0"); meter.setAttribute("aria-valuemax", "100");
    const fill = el("div", "meter-fill"); meter.append(fill); meterFills.set(key, fill);
    const meterLabel = el("div", "meter-label"); meterLabel.innerHTML = "<span>LEVEL</span><span class=level-db>— dBFS</span>";
    channel.append(head, input, meter, meterLabel);
  }
  paint(key); return channel;
}
function buildPanel(): HTMLElement {
  const hostEl = el("div"); hostEl.id = HOST_ID; host = hostEl;
  const root = hostEl.attachShadow({ mode: "open" }); const style = el("style"); style.textContent = CSS;
  const wrap = el("div", "wrap");
  const header = el("header", "head"); const lockup = el("div", "head-left"); const icon = el("span", "brand-icon"); icon.textContent = "M";
  const brandBox = el("div"); const brand = el("div", "brand"); brand.textContent = "mixpilot"; const tag = el("div", "tag"); tag.textContent = "LOCAL SPEECH + SOUND MIXER"; brandBox.append(brand, tag); lockup.append(icon, brandBox);
  const right = el("div", "head-right"); statusNode = el("div", "status"); statusNode.setAttribute("role", "status"); statusNode.setAttribute("aria-live", "polite");
  const toggle = el("button", "toggle"); toggle.type = "button"; toggle.addEventListener("click", async () => {
    if (!state) return; toggle.disabled = true; toggle.textContent = state.active ? "Stopping…" : "Starting…";
    const res = await send({ type: state.active ? "STOP_CAPTURE" : "START_CAPTURE" });
    if (res?.state) render(res.state); if (!res?.ok) notify(res?.error ?? "MixPilot could not start.", true);
    toggle.disabled = false;
  }); right.append(statusNode, toggle); header.append(lockup, right);
  const stemHead = el("div", "section-head"); const title = el("strong"); title.textContent = "Independent channels"; const explainer = el("span", "note"); explainer.textContent = "Music = everything except speech"; stemHead.append(title, explainer);
  const channels = el("div", "channels"); channels.append(makeControl("speechGain"), makeControl("musicGain"));
  const master = makeControl("masterGain");
  const presetRow = el("div", "preset-row"); const presetLabel = el("span", "preset-label"); presetLabel.textContent = "PRESETS"; presetRow.append(presetLabel);
  for (const name of [...Object.keys(PRESETS), "Custom"]) { const btn = el("button", "preset"); btn.type = "button"; btn.textContent = name; btn.setAttribute("aria-pressed", "false"); btn.addEventListener("click", () => { const p = PRESETS[name]; if (!p) return; for (const key of KEYS) { const input = inputs.get(key)!; input.value = String(gainToPercent(p[key])); paint(key); } void sendMixForProfile(p, activeProfileKey).then(res => { if (!res?.ok) notify(res?.error ?? "Preset failed.", true); else if (res.state) render(res.state); }); }); presetButtons.set(name, btn); presetRow.append(btn); }
  const profileRow = el("div", "token-row"); const profileLabel = el("span", "preset-label"); profileLabel.textContent = "SAVE MIX AS";
  const scopeSelect = el("select", "token-input"); scopeSelect.id = "profile-scope"; scopeSelect.setAttribute("aria-label", "Mix profile scope");
  for (const [value, text] of [["global", "Global default"], ["channel", "This channel"], ["video", "This video"]] as [ProfileScope, string][]) { const option = el("option"); option.value = value; option.textContent = text; scopeSelect.append(option); }
  const saveProfile = el("button", "action"); saveProfile.type = "button"; saveProfile.textContent = "Save profile"; saveProfile.addEventListener("click", () => void saveSelectedProfile());
  const clearProfile = el("button", "action"); clearProfile.type = "button"; clearProfile.textContent = "Clear"; clearProfile.title = "Delete the selected saved profile";
  clearProfile.addEventListener("click", async () => { const key = scopeKey(scopeSelect.value as ProfileScope); if (!key || !profiles[key]) { notify("No saved profile exists for this scope."); return; } delete profiles[key]; await chrome.storage.local.set({ mixProfiles: profiles }); await applyProfiles(); notify("Profile removed; the next matching profile now applies."); });
  scopeSelect.addEventListener("change", () => void chooseProfileScope(scopeSelect.value as ProfileScope)); profileRow.append(profileLabel, scopeSelect, saveProfile, clearProfile);
  const actions = el("div", "actions"); const ab = el("button", "action"); ab.id = "ab"; ab.type = "button"; ab.setAttribute("aria-pressed", "false"); ab.addEventListener("click", async () => { if (!state) return; const res = await send({ type: "SET_BYPASS", on: !state.bypass }); if (res?.state) render(res.state); if (!res?.ok) notify(res?.error ?? "A/B switch failed.", true); });
  const reset = el("button", "action"); reset.id = "reset"; reset.type = "button"; reset.textContent = "Reset mix"; reset.addEventListener("click", () => { for (const k of KEYS) { const i = inputs.get(k)!; i.value = "100"; paint(k); } void sendMixForProfile({ speechGain: 1, musicGain: 1, masterGain: 1 }, activeProfileKey).then(r => r?.state && render(r.state)); });
  const identify = el("button", "action identify"); identify.type = "button"; identify.textContent = "Identify music"; identify.title = "Identify an eight-second excerpt from the isolated music stem.";
  const recognition = el("details", "recognition"); const summary = el("summary"); summary.textContent = "Recognition setup & local history";
  const disclosure = el("p", "small"); disclosure.textContent = "Optional: enter your own AudD API token. MixPilot stores it locally in Chrome storage; use Remove to delete it. Each identification uploads only an 8-second excerpt from the isolated Music stem to AudD for matching; MixPilot does not save the excerpt. Your video URL, timestamp, and match are kept in local history.";
  const tokenRow = el("div", "token-row"); const token = el("input", "token-input"); token.type = "password"; token.autocomplete = "off"; token.placeholder = "AudD API token (user-managed)"; token.setAttribute("aria-label", "AudD API token");
  const saveToken = el("button", "action"); saveToken.type = "button"; saveToken.textContent = "Save token";
  const removeToken = el("button", "action"); removeToken.type = "button"; removeToken.textContent = "Remove"; removeToken.title = "Remove the locally stored AudD token";
  removeToken.addEventListener("click", async () => { await chrome.storage.local.remove("auddToken"); token.value = ""; notify("Stored AudD token removed."); });
  tokenRow.append(token, saveToken, removeToken);
  const historyHead = el("div", "token-row"); const historyLabel = el("span", "small"); historyLabel.textContent = "Saved matches are stored only on this device."; const clearHistory = el("button", "action"); clearHistory.type = "button"; clearHistory.textContent = "Clear history"; historyHead.append(historyLabel, clearHistory);
  const historyList = el("div", "history"); historyList.setAttribute("aria-live", "polite");
  recognition.append(summary, disclosure, tokenRow, historyHead, historyList);
  const consent = el("dialog", "consent"); consent.setAttribute("aria-labelledby", "mixpilot-consent-title");
  const consentTitle = el("h3"); consentTitle.id = "mixpilot-consent-title"; consentTitle.textContent = "Send a music excerpt to AudD?";
  const consentText = el("p"); consentText.textContent = "MixPilot will record up to eight seconds from the separated Music stem and send it to AudD (api.audd.io) to identify the track. The video URL and playback timestamp are saved locally with a match. No excerpt is stored by MixPilot. Continue only if you agree to this third-party upload.";
  const consentActions = el("div", "actions"); const cancelConsent = el("button", "action"); cancelConsent.type = "button"; cancelConsent.textContent = "Cancel"; const acceptConsent = el("button", "toggle"); acceptConsent.type = "button"; acceptConsent.textContent = "Record & identify";
  cancelConsent.addEventListener("click", () => consent.close());
  acceptConsent.addEventListener("click", async () => {
    consent.close(); acceptConsent.disabled = true; notify("Recording an eight-second music-stem excerpt…");
    const video = document.querySelector<HTMLVideoElement>("video.html5-main-video");
    const result = await send<RecognitionResult>({ type: "IDENTIFY_MUSIC", videoUrl: location.href, timestamp: video?.currentTime ?? 0 });
    acceptConsent.disabled = false;
    if (!result?.ok) { notify(result?.error ?? "Recognition failed.", true); return; }
    notify(`Identified: ${result.state.title} — ${result.state.artist}`); void loadHistory();
  });
  consentActions.append(cancelConsent, acceptConsent); consent.append(consentTitle, consentText, consentActions);
  identify.addEventListener("click", async () => {
    const stored = await chrome.storage.local.get("auddToken") as { auddToken?: string };
    if (!stored.auddToken) { recognition.open = true; token.focus(); notify("Add your own AudD API token in Recognition setup."); return; }
    consent.showModal();
  });
  saveToken.addEventListener("click", async () => {
    const value = token.value.trim();
    if (!value) { notify("Enter an AudD token, or clear the field to remove it.", true); return; }
    await chrome.storage.local.set({ auddToken: value }); token.value = ""; notify("AudD token saved in local Chrome storage.");
  });
  clearHistory.addEventListener("click", async () => { await send({ type: "DELETE_RECOGNITION_HISTORY" }); historyList.replaceChildren(); notify("Recognition history cleared."); });
  void chrome.storage.local.get("auddToken").then((v: { auddToken?: string }) => { if (v.auddToken) identify.title = "Consent is requested before every recognition."; });
  actions.append(ab, reset, identify);
  messageNode = el("div", "message"); messageNode.setAttribute("role", "status"); messageNode.setAttribute("aria-live", "polite");
  detailNode = el("div", "footer"); const detail = el("span", "status-detail"); detail.textContent = "Audio is processed on this device. Enable MixPilot to begin."; const privacy = el("span"); privacy.textContent = "No audio upload unless requested"; detailNode.append(detail, privacy);
  wrap.append(header, stemHead, channels, master, presetRow, profileRow, actions, recognition, consent, messageNode, detailNode); root.append(style, wrap);
  void loadHistory(historyList);
  for (const type of ["keydown", "keyup", "keypress"] as const) hostEl.addEventListener(type, e => e.stopPropagation());
  if (state) render(state); return hostEl;
}
function findAnchor(): HTMLElement | null { return document.querySelector<HTMLElement>("ytd-watch-flexy #below") ?? document.querySelector<HTMLElement>("#below") ?? document.querySelector<HTMLElement>("ytd-watch-flexy #primary-inner"); }
function maintain(): void {
  if (!alive) return; const existing = document.getElementById(HOST_ID);
  if (location.pathname !== "/watch") { existing?.remove(); return; }
  const anchor = findAnchor(); if (!anchor) return;
  if (existing?.parentElement === anchor && anchor.firstElementChild === existing) return;
  anchor.prepend(existing ?? host ?? buildPanel());
}
async function refresh(): Promise<void> {
  const res = await send({ type: "GET_STATE" });
  if (res?.ok) {
    if (!baseMix) baseMix = { speechGain: res.state.speechGain, musicGain: res.state.musicGain, masterGain: res.state.masterGain };
    render(res.state);
    if (!activeProfileKey) await applyProfiles();
  }
}
async function pollEngine(): Promise<void> {
  if (state?.active) {
    const res = await send<EngineSnapshot | null>({ type: "GET_ENGINE_STATS" });
    if (res?.ok && res.state) {
      snapshot = res.state; render(state);
      const levels = snapshot.levels;
      for (const [key, db] of [["speechGain", levels.speechDb], ["musicGain", levels.musicDb], ["masterGain", levels.outputDb]] as const) {
        const fill = meterFills.get(key); if (!fill) continue;
        const percent = Number.isFinite(db) ? Math.max(0, Math.min(100, (db + 60) / 60 * 100)) : 0;
        fill.style.width = `${percent}%`;
        fill.parentElement?.setAttribute("aria-valuenow", String(Math.round(percent)));
        const label = fill.parentElement?.nextElementSibling?.querySelector(".level-db"); if (label) label.textContent = `${Number.isFinite(db) ? db.toFixed(0) : "−∞"} dBFS`;
      }
      const detail = detailNode?.querySelector(".status-detail"); if (detail) detail.textContent = snapshot.statusDetail ?? (snapshot.status === "running" ? `Separating · ${snapshot.processingLatencyMs.toFixed(0)} ms processing delay` : statusText());
    }
  } else { snapshot = null; if (state) render(state); }
}
function teardown(): void { alive = false; clearInterval(maintainTimer); clearInterval(pollTimer); document.getElementById(HOST_ID)?.remove(); }
chrome.runtime.onMessage.addListener((raw: unknown) => {
  const msg = raw as { type?: string; state?: PublicState; text?: string } | null;
  if (msg?.type === "MIXPILOT_STATE" && msg.state) render(msg.state);
  else if (msg?.type === "MIXPILOT_NOTICE" && msg.text) notify(msg.text, true);
});
document.addEventListener("yt-navigate-finish", () => { snapshot = null; maintain(); void refresh(); window.setTimeout(() => void applyProfiles(), 900); });
maintain(); maintainTimer = window.setInterval(maintain, 1000); pollTimer = window.setInterval(() => void pollEngine(), 600); void refresh();
