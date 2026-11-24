const toggleButton = document.getElementById("toggle-button");
const buttonLabel = document.getElementById("button-label");
const buttonIcon = document.getElementById("button-icon");
const statusPill = document.getElementById("status-pill");
const statusText = document.getElementById("status-text");
const message = document.getElementById("message");
const masterSlider = document.getElementById("master-slider");
const masterValue = document.getElementById("master-value");

let state = { active: false, masterGain: 1 };
let volumeUpdateTimer = null;

function setMessage(text, isError = false) {
  message.textContent = text;
  message.style.color = isError ? "#ff9b9b" : "#7f8998";
}

function render(nextState) {
  state = { ...state, ...nextState };
  statusPill.classList.toggle("active", Boolean(state.active));
  statusText.textContent = state.active ? "Active" : "Inactive";
  buttonLabel.textContent = state.active ? "Disable MixPilot" : "Enable MixPilot";
  buttonIcon.textContent = state.active ? "■" : "▶";
  masterSlider.value = String(Math.round((state.masterGain ?? 1) * 100));
  masterValue.textContent = `${masterSlider.value}%`;
  updateSliderTrack();
}

function updateSliderTrack() {
  const value = Number(masterSlider.value);
  const percentage = (value / 200) * 100;
  masterSlider.style.background = `linear-gradient(90deg, #8de5bd 0%, #8de5bd ${percentage}%, #303945 ${percentage}%, #303945 100%)`;
}

async function sendMessage(payload) {
  return chrome.runtime.sendMessage(payload);
}

async function refreshState() {
  try {
    const response = await sendMessage({ type: "GET_STATE" });
    if (response?.ok) render(response.state);
  } catch {
    setMessage("Could not read MixPilot state. Reload the extension.", true);
  }
}

toggleButton.addEventListener("click", async () => {
  toggleButton.disabled = true;
  setMessage(state.active ? "Stopping audio processing…" : "Starting audio processing…");

  try {
    const response = await sendMessage({
      type: state.active ? "STOP_CAPTURE" : "START_CAPTURE"
    });

    if (!response?.ok) throw new Error(response?.error || "Something went wrong.");
    render(response.state);
    setMessage(response.message || (state.active ? "Audio controls enabled." : "Audio controls disabled."));
  } catch (error) {
    setMessage(error.message || "Unable to change audio state.", true);
  } finally {
    toggleButton.disabled = false;
  }
});

masterSlider.addEventListener("input", () => {
  masterValue.textContent = `${masterSlider.value}%`;
  updateSliderTrack();
  clearTimeout(volumeUpdateTimer);
  volumeUpdateTimer = setTimeout(async () => {
    try {
      const response = await sendMessage({
        type: "SET_MASTER_GAIN",
        value: Number(masterSlider.value) / 100
      });
      if (response?.ok) render(response.state);
    } catch {
      setMessage("Could not update volume.", true);
    }
  }, 35);
});

refreshState();
