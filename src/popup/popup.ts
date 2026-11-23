/** Interim Phase B popup: real stem controls wired to the engine. Phase C replaces the design. */
import { gainToPercent, percentToGain } from "../shared/gain";
import type { EngineSnapshot, MixUpdate, PopupRequest, PublicState, Response } from "../shared/messages";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const toggleButton = $<HTMLButtonElement>("toggle-button");
const buttonLabel = $("button-label");
const buttonIcon = $("button-icon");
const statusPill = $("status-pill");
const statusText = $("status-text");
const message = $("message");
const abButton = $<HTMLButtonElement>("ab-button");
const sepStatus = $("sep-status");
const sepDetail = $("sep-detail");
const sliders = {
  speechGain: { input: $<HTMLInputElement>("speech-slider"), out: $("speech-value") },
  musicGain: { input: $<HTMLInputElement>("music-slider"), out: $("music-value") },
  masterGain: { input: $<HTMLInputElement>("master-slider"), out: $("master-value") },
} as const;
type GainKey = keyof typeof sliders;

let state: PublicState | null = null;
const timers: Partial<Record<GainKey, number>> = {};

const STATUS_LABEL: Record<EngineSnapshot["status"], string> = {
  loading: "Loading model",
  priming: "Starting",
  running: "Separating",
  overloaded: "Too slow — original",
  unavailable: "Unavailable",
  error: "Error",
};

function setMessage(text: string, isError = false): void {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function paintSlider(key: GainKey): void {
  const { input, out } = sliders[key];
  out.textContent = `${input.value}%`;
  input.style.setProperty("--fill", `${(Number(input.value) / Number(input.max)) * 100}%`);
}

function render(next: PublicState): void {
  state = next;
  statusPill.classList.toggle("active", next.active);
  statusText.textContent = next.active ? "Active" : "Inactive";
  buttonLabel.textContent = next.active ? "Disable MixPilot" : "Enable MixPilot";
  buttonIcon.textContent = next.active ? "■" : "▶";
  for (const key of Object.keys(sliders) as GainKey[]) {
    if (document.activeElement !== sliders[key].input) sliders[key].input.value = String(gainToPercent(next[key]));
    paintSlider(key);
  }
  abButton.disabled = !next.active;
  abButton.setAttribute("aria-pressed", String(next.bypass));
  abButton.textContent = next.bypass ? "Listening to original — back to mix" : "Hear original (A/B)";
  if (!next.active) sepStatus.textContent = "Off";
}

function send<T = PublicState>(req: PopupRequest): Promise<Response<T>> {
  return chrome.runtime.sendMessage(req);
}

toggleButton.addEventListener("click", async () => {
  toggleButton.disabled = true;
  const wasActive = state?.active ?? false;
  setMessage(wasActive ? "Stopping…" : "Starting…");
  try {
    const res = await send({ type: wasActive ? "STOP_CAPTURE" : "START_CAPTURE" });
    if (res.state) render(res.state);
    if (!res.ok) throw new Error(res.error);
    setMessage(res.message ?? "");
  } catch (e) {
    setMessage(e instanceof Error ? e.message : "Unable to change audio state.", true);
  } finally {
    toggleButton.disabled = false;
  }
});

for (const key of Object.keys(sliders) as GainKey[]) {
  const { input } = sliders[key];
  input.addEventListener("input", () => {
    paintSlider(key);
    clearTimeout(timers[key]);
    timers[key] = window.setTimeout(async () => {
      const mix: MixUpdate = { [key]: percentToGain(Number(input.value)) };
      const res = await send({ type: "SET_MIX", mix }).catch(() => null);
      if (!res?.ok) setMessage(res?.error ?? "Could not update the mix.", true);
    }, 25);
  });
}

abButton.addEventListener("click", async () => {
  if (!state) return;
  const res = await send({ type: "SET_BYPASS", on: !state.bypass });
  if (res.state) render(res.state);
  if (!res.ok) setMessage(res.error, true);
});

async function pollEngine(): Promise<void> {
  if (state?.active) {
    const res = await send<EngineSnapshot | null>({ type: "GET_ENGINE_STATS" }).catch(() => null);
    const snap = res?.ok ? res.state : null;
    if (snap) {
      sepStatus.textContent = STATUS_LABEL[snap.status];
      sepDetail.textContent = snap.statusDetail
        ?? `Processing delay ${snap.processingLatencyMs.toFixed(0)} ms` + (snap.inference ? ` · inference ${snap.inference.p50Ms.toFixed(1)} ms per 10 ms` : "");
    }
  }
  setTimeout(pollEngine, 500);
}

send({ type: "GET_STATE" })
  .then((res) => res.ok && render(res.state))
  .catch(() => setMessage("Could not read MixPilot state. Reload the extension.", true));
void pollEngine();
