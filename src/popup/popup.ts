/** Phase A popup: the starter UI, ported to TypeScript. The two-stem mixer replaces it in Phase C. */
import { gainToPercent, percentToGain } from "../shared/gain";
import type { PopupRequest, PublicState, Response } from "../shared/messages";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const toggleButton = $<HTMLButtonElement>("toggle-button");
const buttonLabel = $("button-label");
const buttonIcon = $("button-icon");
const statusPill = $("status-pill");
const statusText = $("status-text");
const message = $("message");
const masterSlider = $<HTMLInputElement>("master-slider");
const masterValue = $("master-value");

let state: PublicState = { active: false, activeTabId: null, masterGain: 1 };
let volumeTimer: number | undefined;

function setMessage(text: string, isError = false): void {
  message.textContent = text;
  message.classList.toggle("error", isError);
}

function updateSliderTrack(): void {
  masterSlider.style.setProperty("--fill", `${(Number(masterSlider.value) / Number(masterSlider.max)) * 100}%`);
}

function render(next: Partial<PublicState>): void {
  state = { ...state, ...next };
  statusPill.classList.toggle("active", state.active);
  statusText.textContent = state.active ? "Active" : "Inactive";
  buttonLabel.textContent = state.active ? "Disable MixPilot" : "Enable MixPilot";
  buttonIcon.textContent = state.active ? "■" : "▶";
  masterSlider.value = String(gainToPercent(state.masterGain));
  masterValue.textContent = `${masterSlider.value}%`;
  updateSliderTrack();
}

function send(req: PopupRequest): Promise<Response> {
  return chrome.runtime.sendMessage(req);
}

toggleButton.addEventListener("click", async () => {
  toggleButton.disabled = true;
  const wasActive = state.active;
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

masterSlider.addEventListener("input", () => {
  masterValue.textContent = `${masterSlider.value}%`;
  updateSliderTrack();
  clearTimeout(volumeTimer);
  volumeTimer = window.setTimeout(async () => {
    try {
      const res = await send({ type: "SET_MASTER_GAIN", value: percentToGain(Number(masterSlider.value)) });
      if (!res.ok) setMessage(res.error, true);
    } catch {
      setMessage("Could not update volume.", true);
    }
  }, 30);
});

send({ type: "GET_STATE" })
  .then((res) => res.ok && render(res.state))
  .catch(() => setMessage("Could not read MixPilot state. Reload the extension.", true));
